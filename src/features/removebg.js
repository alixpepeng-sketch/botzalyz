import axios from 'axios';
import { logger } from '../logger.js';
import { downloadMedia, findMedia, reply } from '../utils.js';

const API_URL = 'https://api.remove.bg/v1.0/removebg';

function readApiError(err) {
  const data = err?.response?.data;
  if (data) {
    try {
      const text = Buffer.from(data).toString('utf8');
      const title = JSON.parse(text)?.errors?.[0]?.title;
      if (title) return title;
    } catch {
      /* abaikan, pakai pesan umum */
    }
  }
  if (err?.code === 'ECONNABORTED') return 'Permintaan ke remove.bg melewati batas waktu.';
  return 'Gagal menghubungi remove.bg.';
}

// .removebg - reply foto (atau upload foto dengan caption .removebg).
export default async function removebg(sock, m) {
  const apiKey = process.env.REMOVE_BG_API_KEY;
  if (!apiKey) {
    return reply(sock, m, 'Fitur removebg belum aktif: REMOVEBG_API_KEY belum diisi di server.');
  }

  const found = findMedia(m, ['imageMessage']);
  if (!found) {
    return reply(sock, m, 'Reply foto dengan .removebg atau upload foto dengan caption .removebg');
  }

  await reply(sock, m, 'Menghapus background, mohon tunggu...');
  const input = await downloadMedia(found);

  let output;
  try {
    const { data } = await axios.post(
      API_URL,
      { image_file_b64: input.toString('base64'), size: 'auto', format: 'png' },
      {
        headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
        responseType: 'arraybuffer',
        timeout: 60_000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      },
    );
    output = Buffer.from(data);
  } catch (err) {
    logger.warn({ status: err?.response?.status }, 'removebg gagal');
    return reply(sock, m, `Gagal: ${readApiError(err)}`);
  }

  const jid = m.key.remoteJid;
  await sock.sendMessage(jid, { image: output, caption: 'Background berhasil dihapus.' }, { quoted: m });
  // PNG asli dikirim sebagai dokumen supaya transparansinya tidak hilang.
  await sock.sendMessage(
    jid,
    { document: output, mimetype: 'image/png', fileName: 'removebg.png' },
    { quoted: m },
  );
  return undefined;
}
