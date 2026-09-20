import { downloadMedia, findMedia, reply } from '../utils.js';

// .toptv - kirim video sebagai video bulat (PTV).
// Pakai sebagai caption saat upload video, atau reply sebuah video.
export default async function toptv(sock, m) {
  const found = findMedia(m, ['videoMessage']);
  if (!found) {
    return reply(sock, m, 'Upload video dengan caption .toptv atau reply video dengan .toptv');
  }

  const buffer = await downloadMedia(found);
  await sock.sendMessage(
    m.key.remoteJid,
    { video: buffer, mimetype: 'video/mp4', ptv: true },
    { quoted: m },
  );
}
