import './src/config.js';
import express from 'express';
import { PORT, PUBLIC_DIR, SESSION_DIR } from './src/config.js';
import { logger } from './src/logger.js';
import { ensureDir } from './src/utils.js';
import { setupBot, restoreSessions, getStats } from './src/bot.js';

ensureDir(SESSION_DIR);

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));
app.use(express.static(PUBLIC_DIR));

app.get('/health', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, ...getStats() });
});

setupBot(app);

// Penangkap error (mis. JSON body rusak) supaya frontend selalu dapat JSON.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  logger.warn({ err: err?.message }, 'request error');
  res.status(400).json({ ok: false, message: 'Permintaan tidak valid.' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Alyz Bot Web berjalan di port ${PORT}`);
  logger.info(`Folder session: ${SESSION_DIR}`);
  restoreSessions().catch((err) => logger.error({ err }, 'restoreSessions gagal'));
});

// Satu socket yang error tidak boleh menjatuhkan semua bot.
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
process.on('uncaughtException', (err) => logger.error({ err }, 'uncaughtException'));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    logger.info(`${signal} diterima, menutup server`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
