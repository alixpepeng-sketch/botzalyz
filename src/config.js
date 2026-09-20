import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(here, '..');
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
export const DB_TEMPLATE_DIR = path.join(ROOT_DIR, 'database');

export const SESSION_DIR = path.resolve(process.env.SESSION_DIR || './session');
export const OWNER_NUMBER = String(process.env.OWNER_NUMBER || '6283176204764').replace(/\D/g, '');
export const PORT = Number(process.env.PORT) || 3000;

// Batas jumlah bot aktif supaya server publik tidak kehabisan memori.
export const MAX_SESSIONS = Number(process.env.MAX_SESSIONS) || 100;
