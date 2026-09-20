import sharp from 'sharp';
import { buildBratSvg } from '../lib/brat-svg.js';
import { argText, getQuoted, reply } from '../utils.js';

const MAX_LENGTH = 200;

// .brat <teks> - sticker brat: latar putih, teks hitam tebal, watermark ALYZ BOT.
// Kalau teks kosong, teks diambil dari pesan yang di-reply.
export default async function brat(sock, m, args) {
  let text = argText(args);

  if (!text) {
    const quoted = getQuoted(m);
    text = quoted?.conversation || quoted?.extendedTextMessage?.text || '';
  }

  text = text.replace(/\s+/g, ' ').trim();
  if (!text) {
    return reply(sock, m, 'Masukkan teksnya. Contoh: .brat halo semuanya');
  }
  if (text.length > MAX_LENGTH) {
    return reply(sock, m, `Teks terlalu panjang. Maksimal ${MAX_LENGTH} karakter.`);
  }

  const webp = await sharp(Buffer.from(buildBratSvg(text)))
    .resize(512, 512)
    .webp({ quality: 90 })
    .toBuffer();

  return sock.sendMessage(m.key.remoteJid, { sticker: webp }, { quoted: m });
}
