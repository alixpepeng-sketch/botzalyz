import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  port: Number(process.env.PORT) || 3000,
  prefix: '.',
  ownerNumber: (process.env.OWNER_NUMBER || '6283176204764').replace(/\D/g, ''),

  sessionDir: process.env.SESSION_DIR
    ? path.resolve(process.env.SESSION_DIR)
    : path.join(ROOT, 'session'),
  dbDir: path.join(ROOT, 'database'),

  // Koneksi tertutup: tunggu 3 detik sebelum menyambung ulang
  reconnectDelayMs: 3000,
  // Rate limit permintaan pairing code per IP
  pairCooldownMs: 10_000,

  // .kickall: jumlah anggota per batch dan jeda antar batch (mengurangi risiko rate limit WhatsApp)
  kickBatchSize: 5,
  kickBatchDelayMs: 1500,
  // false = admin lain tidak ikut dikeluarkan, true = semua kecuali bot, pengirim, dan pembuat grup
  kickAdmins: false,

  // Batas ukuran video yang diproses (MB)
  maxVideoMb: 40,
  // Pesan yang lebih tua dari ini (detik) diabaikan, mencegah perintah lama terulang setelah restart
  maxMessageAgeSec: 60,

  logLevel: process.env.LOG_LEVEL || 'silent'
};
  
