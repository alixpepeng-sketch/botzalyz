import { logger } from '../logger.js';
import { ensureOwner, isBotParticipant, isGroupJid, reply, sleep } from '../utils.js';

const CHUNK_SIZE = 5;
const CHUNK_DELAY_MS = 1500;

// .kickall - keluarkan semua member non-admin. Khusus grup, khusus owner bot,
// dan bot harus admin.
export default async function kickall(sock, m, args, sessionDir) {
  const jid = m.key.remoteJid;

  if (!isGroupJid(jid)) {
    return reply(sock, m, 'Perintah ini hanya bisa dipakai di grup.');
  }
  if (!(await ensureOwner(sock, m, sessionDir))) return undefined;

  const meta = await sock.groupMetadata(jid);
  const self = meta.participants.find((p) => isBotParticipant(sock, p));
  if (!self?.admin) {
    return reply(sock, m, 'Jadikan bot sebagai admin grup terlebih dahulu.');
  }

  const targets = meta.participants
    .filter((p) => !p.admin && !isBotParticipant(sock, p))
    .map((p) => p.id);

  if (!targets.length) {
    return reply(sock, m, 'Tidak ada member non-admin yang bisa dikeluarkan.');
  }

  await reply(sock, m, `Mengeluarkan ${targets.length} member non-admin...`);

  let removed = 0;
  for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
    const chunk = targets.slice(i, i + CHUNK_SIZE);
    try {
      const result = await sock.groupParticipantsUpdate(jid, chunk, 'remove');
      removed += Array.isArray(result)
        ? result.filter((r) => String(r.status) === '200').length
        : chunk.length;
    } catch (err) {
      logger.warn({ err: err?.message }, 'kickall: gagal mengeluarkan sebagian member');
    }
    await sleep(CHUNK_DELAY_MS);
  }

  return reply(sock, m, `Selesai. ${removed} dari ${targets.length} member berhasil dikeluarkan.`);
}
