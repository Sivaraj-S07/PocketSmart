import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { createAuth } from './auth.js';
import { HttpError } from './image.js';
import { createPlanner } from './planner.js';
import { createRecommender } from './recommendations.js';
import { authRoutes } from './routes/auth.js';
import { historyRoutes } from './routes/history.js';
import { plannerRoutes } from './routes/planners.js';

const SESSION_CLEANUP_INTERVAL_MS = 5 * 60_000;

/**
 * Build the Express app.  Everything environment-specific is injected, which keeps the
 * app testable: { config, db, recommend? }.
 */
export function createApp({ config, db, recommend, logger = console }) {
  const app = express();
  const auth = createAuth(config, db);
  const createPlan = createPlanner({ db, recommend: recommend ?? createRecommender(config, { logger }) });

  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
    });
    next();
  });

  // CORS: explicit origins only (never "*" together with credentials).  The built app is served
  // from the same origin, so this only matters for a separately hosted frontend.
  app.use(
    cors({
      origin: (origin, cb) => cb(null, Boolean(origin) && config.corsOrigins.includes(origin.replace(/\/+$/, ''))),
      credentials: true,
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'Accept'],
    }),
  );
  app.use(express.json({ limit: '8mb' })); // outfit photos arrive as base64 (<= 7 MB of text)
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  // ------------------------------------------------------------------ status
  const startup = async (req, res) => {
    const databaseOk = await db.ping();
    res.json({
      status: databaseOk ? 'running' : 'degraded',
      message: databaseOk ? 'PocketSmart AI is operational' : 'Database unavailable',
      ai_enabled: Boolean(config.geminiApiKey),
      database: { backend: db.backendName(), ok: databaseOk },
      environment: config.production ? 'production' : 'development',
      timestamp: new Date().toISOString(),
    });
  };
  // Lightweight liveness probe (no database access) for uptime pingers; also answers HEAD.
  const health = (req, res) => res.json({ status: 'ok' });
  app.get('/startup', startup);
  app.get('/health', health);
  app.get('/api/startup', startup);
  app.get('/api/health', health);

  // --------------------------------------------------------------------- API
  const api = express.Router();
  api.use(authRoutes({ db, auth }));
  api.use(historyRoutes({ db, auth }));
  api.use(plannerRoutes({ auth, createPlan }));
  api.use((req, res) => res.status(404).json({ detail: 'Not Found' }));
  app.use('/api', api);

  // ---------------------------------------------------------------- frontend
  app.get('/favicon.ico', (req, res) => res.redirect('/favicon.svg'));
  if (config.hasFrontendBuild) {
    app.use(express.static(config.distDir, { index: false, maxAge: '1h' }));
    // React Router owns every other GET path.
    // Paths with a file extension (a stale /assets/*.js after a redeploy, a missing image ...) must
    // 404 instead of being answered with index.html, or the browser fails with a cryptic parse error.
    app.get('/{*splat}', (req, res) => {
      if (path.extname(req.path)) return res.status(404).type('text/plain').send('Not Found');
      res.sendFile(path.join(config.distDir, 'index.html'));
    });
  } else {
    app.get('/', (req, res) =>
      res.status(200).json({
        message: 'PocketSmart AI API is running. The React frontend is not built here - run `npm run build` ' +
          '(production) or `npm run dev` (development, http://localhost:5173).',
      }),
    );
  }

  // ------------------------------------------------------------------ errors
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof HttpError) return res.status(err.status).json({ detail: err.detail });
    if (err?.type === 'entity.parse.failed')
      return res.status(422).json({ detail: [{ type: 'json_invalid', loc: ['body'], msg: 'JSON decode error' }] });
    if (err?.type === 'entity.too.large') return res.status(413).json({ detail: 'Request body is too large' });
    logger.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);
    res.status(500).json({ detail: 'Internal Server Error' });
  });

  /** Background task: remove sessions idle for SESSION_IDLE_MINUTES (SRS 3.4). */
  app.startBackgroundTasks = () => {
    const timer = setInterval(async () => {
      try {
        const removed = await db.cleanupSessions(config.sessionIdleMinutes);
        if (removed) logger.info(`Removed ${removed} expired session(s)`);
      } catch (err) {
        logger.error('Session cleanup failed', err);
      }
    }, SESSION_CLEANUP_INTERVAL_MS);
    timer.unref();
    return () => clearInterval(timer);
  };

  app.locals.auth = auth;
  return app;
}
