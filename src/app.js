const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { getEnvConfig } = require('./config/env');
const { apiRateLimiter } = require('./middlewares/rateLimiter');
const { sanitizeNoSql } = require('./middlewares/sanitize');
const { errorHandler, notFoundHandler } = require('./middlewares/errorHandler');
const apiRouter = require('./routes');

function createApp(options = {}) {
  const cfg = getEnvConfig();
  const app = express();
  app.set('trust proxy', 1);

  app.use(
    helmet({
      frameguard: false,
      contentSecurityPolicy: false,
    })
  );

  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (cfg.corsOrigins.includes(origin) || !cfg.isProduction) {
          return cb(null, true);
        }
        return cb(new Error('Origin not allowed by CORS'));
      },
      credentials: true,
    })
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(sanitizeNoSql);
  app.use('/api', apiRateLimiter);

  app.get('/api/health', (_req, res) => {
    res.json({ success: true, status: 'ok', service: 'AMANA MongoDB Backend' });
  });

  app.use('/api', apiRouter);

  if (!options.skipNotFound) {
    app.use('/api', notFoundHandler);
  }
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
