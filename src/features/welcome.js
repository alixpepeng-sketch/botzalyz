import path from 'node:path';
import { argText, ensureOwner, readJson, reply, writeJson } from '../utils.js';

// Pengaturan disimpan di SESSION_DIR/<nomor>/welcome.json, bentuknya:
// { welcomeEnabled, welcomeText, leaveEnabled, leaveText }
const fileOf = (sessionDir) => path.join(sessionDir, 'welcome.json');

function load(sessionDir) {
  const data = readJson(fileOf(sessionDir), {});
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

const TAG_INFO = 'Gunakan @user untuk tag member dan @group untuk nama grup.';

function makeSetter({ key, label, example }) {
  return async function setter(sock, m, args, sessionDir) {
    if (!(await ensureOwner(sock, m, sessionDir))) return undefined;

    const text = argText(args);
    if (!text) {
      return reply(sock, m, `Masukkan teks ${label}.\nContoh: ${example}\n${TAG_INFO}`);
    }

    const data = load(sessionDir);
    data[key] = text;
    writeJson(fileOf(sessionDir), data);
    return reply(sock, m, `Teks ${label} disimpan.`);
  };
}

function makeToggle({ key, label, command }) {
  return async function toggle(sock, m, args, sessionDir) {
    if (!(await ensureOwner(sock, m, sessionDir))) return undefined;

    const option = (args[0] || '').toLowerCase();
    const data = load(sessionDir);

    if (option !== 'on' && option !== 'off') {
      const status = data[key] === true ? 'ON' : 'OFF';
      return reply(sock, m, `Status ${label}: ${status}\nGunakan .${command} on atau .${command} off`);
    }

    data[key] = option === 'on';
    writeJson(fileOf(sessionDir), data);
    return reply(sock, m, `${label} ${option === 'on' ? 'diaktifkan' : 'dimatikan'}.`);
  };
}

// .setwelcome <teks>
export const setwelcome = makeSetter({
  key: 'welcomeText',
  label: 'welcome',
  example: '.setwelcome Halo @user, selamat datang di @group',
});

// .setleave <teks>
export const setleave = makeSetter({
  key: 'leaveText',
  label: 'leave',
  example: '.setleave Sampai jumpa @user',
});

// .welcome on/off
export const welcome = makeToggle({ key: 'welcomeEnabled', label: 'Welcome', command: 'welcome' });

// .leave on/off
export const leave = makeToggle({ key: 'leaveEnabled', label: 'Leave', command: 'leave' });
