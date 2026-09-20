// Satu pintu import untuk Baileys.
// Aman untuk build ESM (v7+) maupun CJS lama karena mencari export di
// namespace dan di default export.
import * as ns from '@whiskeysockets/baileys';

const cjs = ns.default && typeof ns.default === 'object' ? ns.default : {};
const get = (name) => ns[name] ?? cjs[name];

export const makeWASocket =
  typeof ns.default === 'function' ? ns.default : get('makeWASocket') ?? cjs.default;

export const useMultiFileAuthState = get('useMultiFileAuthState');
export const makeCacheableSignalKeyStore = get('makeCacheableSignalKeyStore');
export const fetchLatestBaileysVersion = get('fetchLatestBaileysVersion');
export const DisconnectReason = get('DisconnectReason');
export const Browsers = get('Browsers');
export const downloadContentFromMessage = get('downloadContentFromMessage');
export const prepareWAMessageMedia = get('prepareWAMessageMedia');
export const generateWAMessageFromContent = get('generateWAMessageFromContent');
