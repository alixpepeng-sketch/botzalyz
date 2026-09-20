import path from 'node:path';
import { ensureOwner, readJson, reply, writeJson } from '../utils.js';

const fileOf = (sessionDir) => path.join(sessionDir, 'selfmode.json');
const isOn = (sessionDir) => readJson(fileOf(sessionDir), {})?.selfmode === true;

async function setMode(sock, m, sessionDir, value) {
  if (!(await ensureOwner(sock, m, sessionDir))) return;
  writeJson(fileOf(sessionDir), { selfmode: value });
  await reply(
    sock,
    m,
    value
      ? 'Selfmode aktif. Bot hanya merespons owner.'
      : 'Selfmode nonaktif. Bot merespons semua orang.',
  );
}

// .selfmode on / .selfmode off
export default async function selfmode(sock, m, args, sessionDir) {
  const option = (args[0] || '').toLowerCase();

  if (option !== 'on' && option !== 'off') {
    const status = isOn(sessionDir) ? 'ON' : 'OFF';
    return reply(sock, m, `Status selfmode: ${status}\nGunakan .selfmode on atau .selfmode off`);
  }
  return setMode(sock, m, sessionDir, option === 'on');
}

// .self - sama dengan .selfmode on
export function self(sock, m, args, sessionDir) {
  return setMode(sock, m, sessionDir, true);
}

// .public - sama dengan .selfmode off
export function publicMode(sock, m, args, sessionDir) {
  return setMode(sock, m, sessionDir, false);
}
