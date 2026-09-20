import path from 'node:path';
import { commands } from './features/index.js';
import { logger } from './logger.js';
import { getText, isOwner, isPlatformOwner, readJson, reply } from './utils.js';

// Dipanggil untuk setiap pesan masuk dari satu bot.
// sessionDir = SESSION_DIR/<nomor>, tempat selfmode.json dan welcome.json bot itu.
export async function handleMessage(sock, m, sessionDir) {
  if (!m?.message || !m.key?.remoteJid || m.key.remoteJid === 'status@broadcast') return;

  const text = getText(m.message).trim();
  const match = text.match(/^\.(\S+)([\s\S]*)$/);
  if (!match) return;

  const command = match[1].toLowerCase();
  if (!Object.hasOwn(commands, command)) return;

  // Selfmode: kalau aktif, hanya owner bot (atau pemilik platform) yang dilayani.
  const selfmode = readJson(path.join(sessionDir, 'selfmode.json'), {})?.selfmode === true;
  if (selfmode && !isOwner(sock, m, sessionDir) && !isPlatformOwner(m)) return;

  const raw = match[2].trim();
  const args = raw ? raw.split(/\s+/) : [];
  args.raw = raw; // teks utuh dengan newline, dipakai .brat dan .setwelcome

  try {
    await commands[command](sock, m, args, sessionDir);
  } catch (err) {
    logger.error({ err, command }, 'perintah gagal');
    try {
      await reply(sock, m, 'Terjadi kesalahan saat menjalankan perintah.');
    } catch {
      /* koneksi mungkin sedang putus */
    }
  }
}
