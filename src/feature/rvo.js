import { downloadMedia, getQuoted, reply } from '../utils.js';

const TYPES = ['imageMessage', 'videoMessage', 'audioMessage'];

// .rvo - reply pesan view once untuk mengambil ulang medianya.
export default async function rvo(sock, m) {
  const quoted = getQuoted(m);
  const type = TYPES.find((t) => quoted?.[t]);

  if (!type) {
    return reply(sock, m, 'Reply pesan view once (foto, video, atau audio) dengan perintah .rvo');
  }

  const media = quoted[type];
  const buffer = await downloadMedia({ type, media });
  const jid = m.key.remoteJid;

  if (type === 'imageMessage') {
    return sock.sendMessage(jid, { image: buffer, caption: media.caption || '' }, { quoted: m });
  }
  if (type === 'videoMessage') {
    return sock.sendMessage(
      jid,
      { video: buffer, mimetype: 'video/mp4', caption: media.caption || '' },
      { quoted: m },
    );
  }
  return sock.sendMessage(
    jid,
    { audio: buffer, mimetype: media.mimetype || 'audio/mp4', ptt: Boolean(media.ptt) },
    { quoted: m },
  );
}
