import './config.js';
import pino from 'pino';

const level = process.env.LOG_LEVEL || 'info';

export const logger = pino({ level });

export const baileysLogger = pino({
  level: ['debug', 'trace'].includes(level) ? level : 'silent',
});

export const log = logger;
export default logger;
