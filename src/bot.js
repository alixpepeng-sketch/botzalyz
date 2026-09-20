import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { fileURLToPath } from 'node:url';
import {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeWASocket,
  useMultiFileAuthState,
} from './baileys.js';
import { MAX_SESSIONS, SESSION_DIR } from './config.js';
import { handleMessage } from './handler.js';
import { baileysLogger, logger } from './logger.js';
import {
  ensureDir,
  initSessionFiles,
  isBotParticipant,
  normalizeNumber,
  numberOf,
  readJson,
  sleep,
} from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RATE_LIMIT_MS = 10_000;
const RECONNECT_DELAY_MS = 3_000;
const PAIRING_TTL_MS = 3 * 60_000;
const READY_TIMEOUT_MS = 10_000;
const PAIRING_REQUEST_TIMEOUT_MS = 30_000;

const sessions = new Map();
const starting = new Map();
const reconnectTimers = new Map();
const rateLimit = new Map();
const readyBySock = new WeakMap();

const sessionPath = (number) => path.join(SESSION_DIR, number);
const isLinked = (creds) => Boolean(creds?.registered || creds?.account);

export function getStats() { return { sessions: sessions.size }; }

function dropSession(number, { wipe = false } = {}) {
  const sock = sessions.get(number);
  sessions.delete(number);
  const timer = reconnectTimers.get(number);
  if (timer) clearTimeout(timer);
  reconnectTimers.delete(number);
  try { sock?.end(undefined); } catch {}
  if (wipe) fs.rmSync(sessionPath(number), { recursive: true, force: true });
}
function scheduleReconnect(number) {
  if (reconnectTimers.has(number)) return;
  const timer = setTimeout(async () => {
    reconnectTimers.delete(number);
    if (!sessions.has(number)) return;
    try { await createSocket(number); } catch (err) {
      logger.error({ err, number }, 'reconnect gagal');
      scheduleReconnect(number);
    }
  }, RECONNECT_DELAY_MS);
  reconnectTimers.set(number, timer);
}
function handleClose(number, sock, lastDisconnect) {
  if (sessions.get(number)!== sock) return;
  const statusCode = lastDisconnect?.error?.output?.statusCode;
  if (statusCode === DisconnectReason.loggedOut) return dropSession(number, { wipe: true });
  if (statusCode === DisconnectReason.connectionReplaced) return dropSession(number);
  if (!isLinked(sock.authState?.creds)) return dropSession(number, { wipe: true });
  scheduleReconnect(number);
}
let cachedVersion;
async function getWaVersion() {
  if (cachedVersion) return cachedVersion;
  try { ({ version: cachedVersion } = await fetchLatestBaileysVersion()); } catch {}
  return cachedVersion;
}
async function createSocket(number) {
  const dir = sessionPath(number);
  initSessionFiles(dir);
  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const sock = makeWASocket({
    version: await getWaVersion(),
    logger: baileysLogger,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, baileysLogger) },
    browser: Browsers.ubuntu('Chrome'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  });
  let markReady;
  readyBySock.set(sock, new Promise((resolve) => { markReady = resolve; setTimeout(resolve, READY_TIMEOUT_MS).unref?.(); }));
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr || connection === 'open') markReady();
    if (connection === 'open') logger.info({ number }, 'bot terhubung');
    if (connection === 'close') handleClose(number, sock, lastDisconnect);
  });
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type!== 'notify') return;
    for (const m of messages) {
      handleMessage(sock, m, dir).catch((err) => logger.error({ err }, 'handleMessage gagal'));
    }
  });
  sock.ev.on('group-participants.update', (update) => {
    handleParticipants(sock, update, dir).catch((err) => logger.error({ err }, 'welcome gagal'));
  });
  sessions.set(number, sock);
  if (!isLinked(state.creds)) {
    setTimeout(() => {
      if (sessions.get(number) === sock &&!isLinked(sock.authState?.creds)) dropSession(number, { wipe: true });
    }, PAIRING_TTL_MS).unref?.();
  }
  return sock;
}
function prepareDir(number) {
  const dir = sessionPath(number);
  const credsFile = path.join(dir, 'creds.json');
  if (fs.existsSync(credsFile) &&!isLinked(readJson(credsFile, null))) fs.rmSync(dir, { recursive: true, force: true });
  ensureDir(dir);
}
function getSocket(number) {
  const existing = sessions.get(number);
  if (existing) return Promise.resolve(existing);
  if (starting.has(number)) return starting.get(number);
  prepareDir(number);
  const promise = createSocket(number).finally(() => starting.delete(number));
  starting.set(number, promise);
  return promise;
}
export async function restoreSessions() {
  ensureDir(SESSION_DIR);
  const entries = fs.readdirSync(SESSION_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() ||!/^\d{8,15}$/.test(entry.name)) continue;
    const creds = readJson(path.join(SESSION_DIR, entry.name, 'creds.json'), null);
    if (!isLinked(creds)) { fs.rmSync(sessionPath(entry.name), { recursive: true, force: true }); continue; }
    try { await getSocket(entry.name); } catch {}
    await sleep(1000);
  }
}
function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
async function requestPairing(sock, number) {
  await readyBySock.get(sock);
  const raw = await withTimeout(sock.requestPairingCode(number), PAIRING_REQUEST_TIMEOUT_MS, 'timeout');
  const clean = String(raw).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return clean.match(/.{1,4}/g)?.join('-')?? clean;
}
const DEFAULT_WELCOME = 'Selamat datang @user di @group';
const DEFAULT_LEAVE = 'Sampai jumpa @user';
async function handleParticipants(sock, update, dir) {
  const { id: groupJid, participants, action } = update;
  if (action!== 'add' && action!== 'remove') return;
  const config = readJson(path.join(dir, 'welcome.json'), {});
  const isWelcome = action === 'add';
  if (isWelcome? config.welcomeEnabled!== true : config.leaveEnabled!== true) return;
  const template = (isWelcome? config.welcomeText : config.leaveText) || (isWelcome? DEFAULT_WELCOME : DEFAULT_LEAVE);
  let subject = '';
  try { subject = (await sock.groupMetadata(groupJid)).subject || ''; } catch {}
  for (const participant of participants || []) {
    if (typeof participant === 'object' && isBotParticipant(sock, participant)) continue;
    const jid = typeof participant === 'string'? participant : participant.phoneNumber || participant.id;
    if (!jid) continue;
    const text = template.replace(/@user/gi, `@${numberOf(jid)}`).replace(/@group/gi, subject);
    await sock.sendMessage(groupJid, { text, mentions: [jid] });
  }
}
function rateLimiter(req, res, next) {
  const ip = req.headers['cf-connecting-ip'] || req.ip || 'unknown';
  const now = Date.now();
  const wait = RATE_LIMIT_MS - (now - (rateLimit.get(ip) || 0));
  if (wait > 0) return res.status(429).json({ ok: false, message: `Coba lagi ${Math.ceil(wait/1000)} detik` });
  rateLimit.set(ip, now);
  next();
}
async function pairHandler(req, res) {
  const number = normalizeNumber(req.body?.number);
  if (!number) return res.status(400).json({ ok: false, message: 'Nomor tidak valid' });
  try {
    let sock = sessions.get(number);
    if (!sock) {
      if (sessions.size + starting.size >= MAX_SESSIONS) return res.status(503).json({ ok: false, message: 'Server penuh' });
      sock = await getSocket(number);
    }
    if (isLinked(sock.authState?.creds)) return res.json({ ok: true, connected: true, message: 'Sudah terhubung' });
    const code = await requestPairing(sock, number);
    return res.json({ ok: true, code });
  } catch (err) {
    logger.error({ err }, 'pairing gagal');
    const sock = sessions.get(number);
    if (sock &&!isLinked(sock.authState?.creds)) dropSession(number, { wipe: true });
    return res.status(500).json({ ok: false, message: 'Gagal buat code' });
  }
}
export function setupBot(app) {
  app.post('/pair', rateLimiter, pairHandler);
  app.get('/stats', (req,res)=> res.json(getStats()));
}

// --- SERVER UTAMA ---
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.get('/', (req, res) => {
  const p = path.join(__dirname, '../public/index.html');
  if(fs.existsSync(p)) return res.sendFile(p);
  return res.send('Alyz Bot jalan, tapi public/index.html belum ada');
});
setupBot(app);
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server jalan di port ${PORT}`));
restoreSessions();
