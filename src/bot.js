import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { config } from './config.js';
import { log, baileysLogger } from './logger.js';
import { handleMessage } from './handler.js';

let sock = null;
let currentStatus = 'disconnected';

export function getStatus() {
  return { status: currentStatus, connected: currentStatus === 'open' };
}

export function normalizeNumber(input) {
  const n = String(input || '').replace(/[^0-9]/g, '');
  if (n.length < 8) throw new PairError('Nomor tidak valid');
  return n;
}

export class PairError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function requestPairing(number) {
  if (!sock) throw new PairError('Bot belum siap, tunggu 10 detik', 503);
  if (currentStatus !== 'connecting' && currentStatus !== 'close') {
    // kalau udah konek gak perlu pairing lagi
    if (currentStatus === 'open') throw new PairError('Bot sudah terhubung');
  }
  try {
    // Baileys butuh nomor tanpa + dan tanpa spasi
    const code = await sock.requestPairingCode(number);
    return code;
  } catch (err) {
    log.error({ err }, 'requestPairing gagal');
    throw new PairError(err.message || 'Gagal meminta pairing code', 500);
  }
}

export async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: baileysLogger,
    printQRInTerminal: false,
    browser: ['Alyz Bot', 'Chrome', '1.0'],
  });

  currentStatus = 'connecting';
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection) {
      currentStatus = connection;
      log.info(`Connection: ${connection}`);
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      log.warn(`Disconnected code ${code}, reconnect=${shouldReconnect}`);
      if (shouldReconnect) {
        setTimeout(() => startBot(), 3000);
      } else {
        currentStatus = 'loggedOut';
      }
    }
    if (connection === 'open') {
      log.info('Bot terhubung!');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      try {
        await handleMessage(sock, m);
      } catch (err) {
        log.error({ err }, 'handleMessage error');
      }
    }
  });

  return sock;
                                 }
