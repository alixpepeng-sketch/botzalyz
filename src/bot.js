import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers
} from '@whiskeysockets/baileys';
import fs from 'node:fs/promises';
import { config } from './config.js';
import { baileysLogger, log } from './logger.js';
import { handleMessage } from './handler.js';

export class PairError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const state = { status: 'idle', pairing: false };
let sock = null;
let starting = false;
let reconnectTimer = null;
let pairReady = false;
let pairWaiters = [];

export function getStatus() {
  return {
    status: state.status,
    connected: state.status === 'open',
    registered: Boolean(sock?.authState?.creds?.registered)
  };
}

export function normalizeNumber(raw) {
  let n = String(raw ?? '').replace(/\D/g, '');
  if (n.startsWith('0')) n = '62' + n.slice(1);
  if (n.length < 8 || n.length > 15) {
    throw new PairError('Nomor tidak valid. Gunakan kode negara, contoh 628123456789.', 400);
  }
  return n;
}

function markPairReady() {
  pairReady = true;
  const waiters = pairWaiters;
  pairWaiters = [];
  waiters.forEach((fn) => fn());
}

function waitForPairReady(timeoutMs = 15_000) {
  if (pairReady) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      pairWaiters = pairWaiters.filter((fn) => fn !== done);
      resolve(false);
    }, timeoutMs);
    pairWaiters.push(done);
  });
}

export async function requestPairing(number) {
  if (!sock) throw new PairError('Bot belum siap, coba lagi sebentar.', 503);
  if (sock.authState.creds.registered) {
    throw new PairError('Bot sudah tersambung ke sebuah akun WhatsApp.', 409);
  }
  if (state.pairing) throw new PairError('Permintaan kode lain sedang diproses.', 429);

  state.pairing = true;
  try {
    const current = sock;
    await waitForPairReady();
    if (current !== sock) throw new PairError('Koneksi sedang dimulai ulang, coba lagi.', 503);
    const code = await current.requestPairingCode(number);
    return String(code).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  } catch (err) {
    if (err instanceof PairError) throw err;
    log.error({ err }, 'requestPairingCode gagal');
    throw new PairError('Gagal meminta kode. Periksa nomor lalu coba lagi.', 500);
  } finally {
    state.pairing = false;
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  log.info(`Menyambung ulang dalam ${config.reconnectDelayMs / 1000} detik`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startBot();
  }, config.reconnectDelayMs);
}

async function onConnectionUpdate(current, update) {
  if (current !== sock) return;
  const { connection, lastDisconnect, qr } = update;

  // Event qr menandakan handshake selesai, socket siap menerima permintaan pairing code
  if (qr) markPairReady();

  if (connection === 'connecting') state.status = 'connecting';

  if (connection === 'open') {
    state.status = 'open';
    markPairReady();
    log.info('WhatsApp tersambung');
  }

  if (connection === 'close') {
    const code = lastDisconnect?.error?.output?.statusCode;
    state.status = 'closed';
    pairReady = false;
    log.warn({ code }, 'Koneksi tertutup');

    if (code === DisconnectReason.loggedOut) {
      // Sesi dicabut dari ponsel: hapus sesi lama supaya bisa pairing ulang lewat web
      state.status = 'logged_out';
      await fs.rm(config.sessionDir, { recursive: true, force: true }).catch(() => {});
      log.warn('Sesi dihapus, silakan pairing ulang lewat web');
    }
    scheduleReconnect();
  }
}

export async function startBot() {
  if (starting) return;
  starting = true;
  try {
    await fs.mkdir(config.sessionDir, { recursive: true });
    const { state: auth, saveCreds } = await useMultiFileAuthState(config.sessionDir);

    let version;
    try {
      ({ version } = await fetchLatestBaileysVersion());
    } catch {
      /* pakai versi bawaan Baileys */
    }

    pairReady = false;
    state.status = 'connecting';

    const current = makeWASocket({
      auth,
      ...(version ? { version } : {}),
      logger: baileysLogger,
      browser: Browsers.ubuntu('Chrome'),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false
    });
    sock = current;

    current.ev.on('creds.update', saveCreds);
    current.ev.on('connection.update', (u) =>
      onConnectionUpdate(current, u).catch((err) => log.error({ err }, 'connection.update error'))
    );
    current.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify' || current !== sock) return;
      for (const m of messages) {
        handleMessage(current, m).catch((err) => log.error({ err }, 'handler error'));
      }
    });
  } catch (err) {
    log.error({ err }, 'startBot gagal');
    scheduleReconnect();
  } finally {
    starting = false;
  }
    }
                        
