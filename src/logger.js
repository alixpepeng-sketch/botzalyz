import './config.js';
import pino from 'pino';

const level = process.env.LOG_LEVEL || 'info';

// Logger aplikasi.
export const logger = pino({ level });

// Logger untuk Baileys. Dibuat senyap kecuali LOG_LEVEL=debug/trace.
export const baileysLogger = pino({
  level: ['debug', 'trace'].includes(level) ? level : 'silent',
});
