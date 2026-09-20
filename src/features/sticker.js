import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { logger } from '../logger.js';
import { downloadMedia, findMedia, reply } from '../utils.js';

const SIZE = 512;
const MAX_VIDEO_SECONDS = 6;
const MAX_ANIMATED_BYTES = 950 * 1024;

/* ---------------------------- Foto ---------------------------- */

export function imageToWebp(buffer) {
  return sharp(buffer)
    .resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 80 })
    .toBuffer();
}

/* ---------------------------- Video ---------------------------- */
// sharp tidak bisa membaca video, jadi video diubah ke webp animasi lewat ffmpeg.
// Urutan pencarian: FFMPEG_PATH, paket ffmpeg-static, lalu ffmpeg di PATH sistem.

async function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const mod = await import('ffmpeg-static');
    if (mod.default) return mod.default;
  } catch {
    /* paket opsional tidak terpasang */
  }
  return 'ffmpeg';
}

function runFfmpeg(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-600);
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr || `ffmpeg berhenti dengan kode ${code}`));
    });
  });
}

async function videoToWebp(buffer) {
  const bin = await resolveFfmpeg();
  const id = randomUUID();
  const input = path.join(os.tmpdir(), `alyz-${id}.mp4`);
  const output = path.join(os.tmpdir(), `alyz-${id}.webp`);

  await fs.writeFile(input, buffer);
  try {
    // Percobaan pertama kualitas lebih baik, kedua lebih ringan bila file kebesaran.
    for (const { fps, quality } of [
      { fps: 12, quality: 45 },
      { fps: 8, quality: 28 },
    ]) {
      const filter =
        `fps=${fps},scale=${SIZE}:${SIZE}:force_original_aspect_ratio=decrease,` +
        `format=rgba,pad=${SIZE}:${SIZE}:(ow-iw)/2:(oh-ih)/2:color=black@0`;
      await runFfmpeg(bin, [
        '-y', '-i', input,
        '-t', String(MAX_VIDEO_SECONDS),
        '-an',
        '-vf', filter,
        '-c:v', 'libwebp',
        '-loop', '0',
        '-lossless', '0',
        '-q:v', String(quality),
        '-compression_level', '6',
        output,
      ]);
      const result = await fs.readFile(output);
      if (result.length <= MAX_ANIMATED_BYTES) return result;
      if (fps === 8) return result;
    }
    return null;
  } finally {
    await Promise.allSettled([fs.rm(input, { force: true }), fs.rm(output, { force: true })]);
  }
}

/* ---------------------------- Perintah ---------------------------- */

// .sticker atau .s - foto/video jadi sticker.
export default async function sticker(sock, m) {
  const found = findMedia(m, ['imageMessage', 'videoMessage']);
  if (!found) {
    return reply(
      sock,
      m,
      'Kirim foto/video dengan caption .sticker atau reply foto/video dengan .sticker',
    );
  }

  const isVideo = found.type === 'videoMessage';
  if (isVideo && Number(found.media.seconds) > 60) {
    return reply(sock, m, 'Video terlalu panjang. Gunakan video di bawah 60 detik.');
  }

  const buffer = await downloadMedia(found);
  let webp;
  try {
    webp = isVideo ? await videoToWebp(buffer) : await imageToWebp(buffer);
  } catch (err) {
    logger.warn({ err: err?.message }, 'sticker gagal');
    if (isVideo && err?.code === 'ENOENT') {
      return reply(sock, m, 'Sticker video belum bisa dibuat: ffmpeg tidak tersedia di server.');
    }
    return reply(sock, m, 'Gagal membuat sticker. Coba media lain.');
  }

  return sock.sendMessage(m.key.remoteJid, { sticker: webp }, { quoted: m });
}
