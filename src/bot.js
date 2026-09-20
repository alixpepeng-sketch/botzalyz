import fs from 'node:fs';
import path from 'node:path';
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

const RATE_LIMIT_MS = 10_000; // 10 detik per IP
const RECONNECT_DELAY_MS = 3_000; // auto reconnect
const PAIRING_TTL_MS = 3 * 60_000; // sesi yang tidak pernah ditautkan dibuang
const READY_TIMEOUT_MS = 10_000;
const PAIRING_REQUEST_TIMEOUT_MS = 30_000;

// nomor -> sock aktif. Satu entri per bot yang dihosting.
const sessions = new Map();
const starting = new Map(); // nomor -> Promise (mencegah dobel pembuatan)
const reconnectTimers = new Map();
const rateLimit = new Map(); // ip -> waktu request terakhir
const readyBySock = new WeakMap(); // sock -> Promise siap menerima pairing

const sessionPath = (number) => path.join(SESSION_DIR, number);

// Sesi dianggap sudah tertaut kalau pairing pernah berhasil.
const isLinked = (creds) => Boolean(creds?.registered || creds?.account);

export function getStats() {
  return { sessions: sessions.size };
}

/* ------------------------------------------------------------------ */
/* Siklus hidup session                                                */
/* ------------------------------------------------------------------ */

function dropSession(number, { wipe = false } = {}) {
  const sock = sessions.get(number);
  sessions.delete(number);

  const timer = reconnectTimers.get(number);
  if (timer) clearTimeout(timer);
  reconnectTimers.delete(number);

  try {
    sock?.end(undefined);
  } catch {
    /* socket sudah tertutup */
  }
  if (wipe) fs.rmSync(sessionPath(number), { recursive: true, force: true });
}

function scheduleReconnect(number) {
  if (reconnectTimers.has(number)) return;

  const timer = setTimeout(async () => {
    reconnectTimers.delete(number);
    if (!sessions.has(number)) return; // sudah dihapus selama menunggu
    try {
      await createSocket(number);
    } catch (err) {
      logger.error({ err, number }, 'reconnect gagal, coba lagi');
      scheduleReconnect(number);
    }
  }, RECONNECT_DELAY_MS);
  reconnectTimers.set(number, timer);
}

function handleClose(number, sock, lastDisconnect) {
  if (sessions.get(number) !== sock) return; // socket lama yang sudah diganti

  const statusCode = lastDisconnect?.error?.output?.statusCode;
  logger.warn({ number, statusCode }, 'koneksi terputus');

  if (statusCode === DisconnectReason.loggedOut) {
    // Perangkat dikeluarkan dari WhatsApp: hapus session, perlu pairing ulang.
    dropSession(number, { wipe: true });
    return;
  }
  if (statusCode === DisconnectReason.connectionReplaced) {
    // Sesi yang sama dibuka di tempat lain. Reconnect hanya akan saling tendang.
    dropSession(number);
    return;
  }
  if (!isLinked(sock.authState?.creds)) {
    // Pairing tidak pernah diselesaikan.
    dropSession(number, { wipe: true });
    return;
  }
  scheduleReconnect(number);
}

// Versi WhatsApp Web diambil sekali lalu dipakai ulang oleh semua bot.
let cachedVersion;
async function getWaVersion() {
  if (cachedVersion) return cachedVersion;
  try {
    ({ version: cachedVersion } = await fetchLatestBaileysVersion());
  } catch {
    /* pakai versi bawaan Baileys */
  }
  return cachedVersion;
}

async function createSocket(number) {
  const dir = sessionPath(number);
  initSessionFiles(dir);

  const { state, saveCreds } = await useMultiFileAuthState(dir);

  const sock = makeWASocket({
    version: await getWaVersion(),
    logger: baileysLogger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
    },
    browser: Browsers.ubuntu('Chrome'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  });

  // Promise "siap": pairing code baru boleh diminta setelah handshake selesai.
  let markReady;
  readyBySock.set(
    sock,
    new Promise((resolve) => {
      markReady = resolve;
      setTimeout(resolve, READY_TIMEOUT_MS).unref?.();
    }),
  );

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr || connection === 'open') markReady();
    if (connection === 'open') logger.info({ number }, 'bot terhubung');
    if (connection === 'close') handleClose(number, sock, lastDisconnect);
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      // Tanpa await supaya perintah yang lama (mis. kickall) tidak menahan pesan lain.
      handleMessage(sock, m, dir).catch((err) =>
        logger.error({ err, number }, 'handleMessage gagal'),
      );
    }
  });

  sock.ev.on('group-participants.update', (update) => {
    handleParticipants(sock, update, dir).catch((err) =>
      logger.error({ err, number }, 'welcome/leave gagal'),
    );
  });

  sessions.set(number, sock);

  // Buang sesi yang tidak pernah ditautkan supaya tidak menumpuk di memori.
  if (!isLinked(state.creds)) {
    setTimeout(() => {
      if (sessions.get(number) === sock && !isLinked(sock.authState?.creds)) {
        logger.info({ number }, 'pairing kedaluwarsa, sesi dibuang');
        dropSession(number, { wipe: true });
      }
    }, PAIRING_TTL_MS).unref?.();
  }

  return sock;
}

// Kalau folder sisa dari pairing yang gagal, mulai bersih.
function prepareDir(number) {
  const dir = sessionPath(number);
  const credsFile = path.join(dir, 'creds.json');
  if (fs.existsSync(credsFile) && !isLinked(readJson(credsFile, null))) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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

// Saat server restart, hidupkan lagi semua bot yang sudah tertaut.
export async function restoreSessions() {
  ensureDir(SESSION_DIR);
  const entries = fs.readdirSync(SESSION_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d{8,15}$/.test(entry.name)) continue;

    const creds = readJson(path.join(SESSION_DIR, entry.name, 'creds.json'), null);
    if (!isLinked(creds)) {
      fs.rmSync(sessionPath(entry.name), { recursive: true, force: true });
      continue;
    }

    try {
      await getSocket(entry.name);
      logger.info({ number: entry.name }, 'session dipulihkan');
    } catch (err) {
      logger.error({ err, number: entry.name }, 'gagal memulihkan session');
    }
    await sleep(1000); // beri jeda agar tidak membuka puluhan koneksi sekaligus
  }
}

/* ------------------------------------------------------------------ */
/* Pairing code                                                        */
/* ------------------------------------------------------------------ */

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function requestPairing(sock, number) {
  await readyBySock.get(sock);
  const raw = await withTimeout(
    sock.requestPairingCode(number),
    PAIRING_REQUEST_TIMEOUT_MS,
    'requestPairingCode timeout',
  );
  const clean = String(raw).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return clean.match(/.{1,4}/g)?.join('-') ?? clean;
}

/* ------------------------------------------------------------------ */
/* Welcome / leave                                                     */
/* ------------------------------------------------------------------ */

const DEFAULT_WELCOME = 'Selamat datang @user di @group';
const DEFAULT_LEAVE = 'Sampai jumpa @user';

async function handleParticipants(sock, update, dir) {
  const { id: groupJid, participants, action } = update;
  if (action !== 'add' && action !== 'remove') return;

  const config = readJson(path.join(dir, 'welcome.json'), {});
  const isWelcome = action === 'add';
  if (isWelcome ? config.welcomeEnabled !== true : config.leaveEnabled !== true) return;

  const template =
    (isWelcome ? config.welcomeText : config.leaveText) || (isWelcome ? DEFAULT_WELCOME : DEFAULT_LEAVE);

  let subject = '';
  try {
    subject = (await sock.groupMetadata(groupJid)).subject || '';
  } catch {
    /* metadata tidak tersedia, @group jadi kosong */
  }

  for (const participant of participants || []) {
    // Baileys v7 mengirim objek {id, phoneNumber, ...}, versi lama mengirim string.
    if (typeof participant === 'object' && isBotParticipant(sock, participant)) continue;
    const jid =
      typeof participant === 'string' ? participant : participant.phoneNumber || participant.id;
    if (!jid) continue;

    const text = template
      .replace(/@user/gi, `@${numberOf(jid)}`)
      .replace(/@group/gi, subject);

    await sock.sendMessage(groupJid, { text, mentions: [jid] });
  }
}

/* ------------------------------------------------------------------ */
/* Route HTTP                                                          */
/* ------------------------------------------------------------------ */

function rateLimiter(req, res, next) {
  // Render berada di belakang Cloudflare; header ini berisi IP asli pengunjung.
  const ip = req.headers['cf-connecting-ip'] || req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const wait = RATE_LIMIT_MS - (now - (rateLimit.get(ip) || 0));

  if (wait > 0) {
    const retryAfter = Math.ceil(wait / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({
      ok: false,
      message: `Terlalu cepat. Coba lagi dalam ${retryAfter} detik.`,
      retryAfter,
    });
  }
  rateLimit.set(ip, now);
  return next();
}

async function pairHandler(req, res) {
  const number = normalizeNumber(req.body?.number);
  if (!number) {
    return res.status(400).json({
      ok: false,
      message: 'Nomor tidak valid. Gunakan kode negara, contoh 6281234567890.',
    });
  }

  try {
    let sock = sessions.get(number);

    if (!sock) {
      if (sessions.size + starting.size >= MAX_SESSIONS) {
        return res.status(503).json({
          ok: false,
          message: 'Server sedang penuh. Coba lagi beberapa saat lagi.',
        });
      }
      sock = await getSocket(number);
    }

    if (isLinked(sock.authState?.creds)) {
      return res.json({
        ok: true,
        connected: true,
        message: 'Nomor ini sudah terhubung dan bot sudah aktif.',
      });
    }

    const code = await requestPairing(sock, number);
    return res.json({ ok: true, code });
  } catch (err) {
    logger.error({ err, number }, 'pairing gagal');
    const sock = sessions.get(number);
    if (sock && !isLinked(sock.authState?.creds)) dropSession(number, { wipe: true });
    return res.status(500).json({
      ok: false,
      message: 'Gagal membuat kode pairing. Periksa nomor lalu coba lagi.',
    });
  }
}

export function setupBot(app) {
  app.post('/pair', rateLimiter, pairHandler);

  // Bersihkan catatan rate limit yang sudah lewat.
  setInterval(() => {
    const limit = Date.now() - RATE_LIMIT_MS;
    for (const [ip, time] of rateLimit) if (time < limit) rateLimit.delete(ip);
  }, 60_000).unref();
}
