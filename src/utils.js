import fs from 'node:fs';
import path from 'node:path';
import { downloadContentFromMessage } from './baileys.js';
import { DB_TEMPLATE_DIR, OWNER_NUMBER } from './config.js';

/* ------------------------------------------------------------------ */
/* Umum                                                                */
/* ------------------------------------------------------------------ */

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJson(file, fallback) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data ?? fallback;
  } catch {
    return fallback;
  }
}

// Tulis atomik: tulis ke file sementara lalu rename, jadi file tidak rusak
// kalau proses mati di tengah penulisan.
export function writeJson(file, data) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// Salin template database/ ke folder session nomor baru (kalau belum ada).
export function initSessionFiles(dir) {
  ensureDir(dir);
  const defaults = { 'selfmode.json': { selfmode: false }, 'welcome.json': {} };
  for (const [name, fallback] of Object.entries(defaults)) {
    const target = path.join(dir, name);
    if (fs.existsSync(target)) continue;
    const template = path.join(DB_TEMPLATE_DIR, name);
    if (fs.existsSync(template)) fs.copyFileSync(template, target);
    else writeJson(target, fallback);
  }
}

// Kode negara default Indonesia: 08xx menjadi 628xx.
export function normalizeNumber(input) {
  let digits = String(input ?? '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

/* ------------------------------------------------------------------ */
/* Parsing pesan                                                       */
/* ------------------------------------------------------------------ */

const WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
];
const IGNORED_KEYS = new Set(['messageContextInfo', 'senderKeyDistributionMessage']);

// Buka pembungkus (ephemeral, view once, dst) sampai ketemu isi pesan aslinya.
export function unwrap(message) {
  let msg = message;
  for (let i = 0; i < 6 && msg; i += 1) {
    const key = WRAPPERS.find((k) => msg[k]);
    if (!key) break;
    msg = msg[key].message;
  }
  return msg || null;
}

export function getMessageType(msg) {
  return msg ? Object.keys(msg).find((k) => !IGNORED_KEYS.has(k)) : undefined;
}

export function getText(message) {
  const msg = unwrap(message);
  if (!msg) return '';
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.documentMessage?.caption ||
    ''
  );
}

export function getContextInfo(message) {
  const msg = unwrap(message);
  const type = getMessageType(msg);
  return type ? msg[type]?.contextInfo : undefined;
}

// Isi pesan yang di-reply (sudah dibuka pembungkusnya).
export function getQuoted(m) {
  const ctx = getContextInfo(m.message);
  return ctx?.quotedMessage ? unwrap(ctx.quotedMessage) : null;
}

// Cari media di pesan itu sendiri (caption) atau di pesan yang di-reply.
export function findMedia(m, types = ['imageMessage', 'videoMessage']) {
  const own = unwrap(m.message);
  for (const type of types) {
    if (own?.[type]) return { type, media: own[type], quoted: false };
  }
  const quoted = getQuoted(m);
  for (const type of types) {
    if (quoted?.[type]) return { type, media: quoted[type], quoted: true };
  }
  return null;
}

export async function downloadMedia(found) {
  const kind = found.type.replace('Message', '');
  const stream = await downloadContentFromMessage(found.media, kind);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Teks setelah nama perintah, newline tetap utuh (dipasang handler di args.raw).
export function argText(args) {
  return typeof args?.raw === 'string' ? args.raw : (args || []).join(' ');
}

export function reply(sock, m, text, extra = {}) {
  return sock.sendMessage(m.key.remoteJid, { text, ...extra }, { quoted: m });
}

/* ------------------------------------------------------------------ */
/* Identitas & owner                                                   */
/* ------------------------------------------------------------------ */

export const isGroupJid = (jid) => String(jid || '').endsWith('@g.us');

// "62831xxx:12@s.whatsapp.net" -> "62831xxx"
export const numberOf = (jid) => String(jid || '').split('@')[0].split(':')[0];

export function getBotNumbers(sock, sessionDir) {
  const numbers = [sock.user?.id, sock.user?.lid].filter(Boolean).map(numberOf);
  if (sessionDir) numbers.push(path.basename(sessionDir));
  return numbers;
}

export function getSenderNumbers(m) {
  const key = m.key || {};
  return [key.participant, key.participantAlt, key.remoteJid, key.remoteJidAlt]
    .filter((jid) => jid && !/@(g\.us|broadcast|newsletter)$/.test(jid))
    .map(numberOf);
}

// Owner bot = akun WhatsApp pemilik session (nomor yang menautkan bot).
// Pesan dari akun itu sendiri selalu punya key.fromMe = true.
export function isOwner(sock, m, sessionDir) {
  if (m.key?.fromMe) return true;
  const bots = getBotNumbers(sock, sessionDir);
  return getSenderNumbers(m).some((n) => bots.includes(n));
}

// Pemilik platform (OWNER_NUMBER di .env). Hanya dipakai untuk melewati selfmode.
export const isPlatformOwner = (m) => getSenderNumbers(m).includes(OWNER_NUMBER);

export async function ensureOwner(sock, m, sessionDir) {
  if (isOwner(sock, m, sessionDir)) return true;
  await reply(sock, m, 'Perintah ini khusus owner bot (pemilik nomor yang menautkan bot).');
  return false;
}

/* ------------------------------------------------------------------ */
/* Peserta grup (Baileys v7 bisa memakai LID atau nomor telepon)       */
/* ------------------------------------------------------------------ */

export const participantNumbers = (p) =>
  [p?.id, p?.lid, p?.phoneNumber].filter(Boolean).map(numberOf);

export function isBotParticipant(sock, p) {
  const bots = getBotNumbers(sock);
  return participantNumbers(p).some((n) => bots.includes(n));
}
