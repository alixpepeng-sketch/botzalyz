import { generateWAMessageFromContent, prepareWAMessageMedia } from '../baileys.js';
import { logger } from '../logger.js';
import { downloadMedia, findMedia, reply } from '../utils.js';

// .fotolive - kirim video sebagai live photo (motion photo).
// Pakai sebagai caption saat upload video, atau reply sebuah video.
//
// Catatan: Baileys belum punya opsi resmi untuk live photo. Di sini video
// diunggah lalu ditandai dengan field motionPhotoPresentationOffsetMs milik
// protokol WhatsApp. Kalau versi WhatsApp penerima tidak mengenalinya, pesan
// tetap terkirim sebagai video biasa.
export default async function fotolive(sock, m) {
  const found = findMedia(m, ['videoMessage']);
  if (!found) {
    return reply(sock, m, 'Upload video dengan caption .fotolive atau reply video dengan .fotolive');
  }

  const jid = m.key.remoteJid;
  const buffer = await downloadMedia(found);

  try {
    const prepared = await prepareWAMessageMedia(
      { video: buffer, mimetype: 'video/mp4' },
      { upload: sock.waUploadToServer },
    );

    const videoMessage = {
      ...prepared.videoMessage,
      gifPlayback: false,
      motionPhotoPresentationOffsetMs: 0,
    };

    const message = generateWAMessageFromContent(
      jid,
      { videoMessage },
      { userJid: sock.user.id, quoted: m },
    );
    await sock.relayMessage(jid, message.message, { messageId: message.key.id });
  } catch (err) {
    logger.warn({ err }, 'fotolive gagal, kirim sebagai video biasa');
    await sock.sendMessage(jid, { video: buffer, mimetype: 'video/mp4' }, { quoted: m });
  }
}
