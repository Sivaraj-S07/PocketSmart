import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT_DIR = path.resolve(BACKEND_DIR, '..');

// Load backend/.env no matter which directory the process was started from.
dotenv.config({ path: path.join(BACKEND_DIR, '.env'), quiet: true });

const DEFAULT_CORS_ORIGINS =
  'http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000,http://127.0.0.1:8000,http://localhost:3000';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const DEFAULT_GEMINI_FALLBACK_MODELS = 'gemini-3.5-flash-lite,gemini-2.5-flash';

function int(value, fallback) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function isProduction(env = process.env) {
  return (
    ['production', 'prod'].includes((env.ENVIRONMENT || '').trim().toLowerCase()) ||
    (env.RENDER || '').trim().toLowerCase() === 'true'
  );
}

export function loadConfig(env = process.env) {
  const production = isProduction(env);

  let secretKey = (env.SECRET_KEY || '').trim();
  if (!secretKey) {
    if (production) {
      throw new Error(
        'SECRET_KEY must be set in production. Generate one with: ' +
          'node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
      );
    }
    // Local development only: sessions are invalidated on every restart.
    secretKey = crypto.randomBytes(32).toString('base64url');
  }

  const sameSiteRaw = (env.COOKIE_SAMESITE || 'lax').trim().toLowerCase();
  const cookieSameSite = ['lax', 'strict', 'none'].includes(sameSiteRaw) ? sameSiteRaw : 'lax';
  const secureRaw = (env.COOKIE_SECURE || '').trim().toLowerCase();
  let cookieSecure = secureRaw ? secureRaw === 'true' : production;
  if (cookieSameSite === 'none') cookieSecure = true; // browsers reject SameSite=None without Secure

  const geminiPrimary = (env.GEMINI_MODEL || '').trim() || DEFAULT_GEMINI_MODEL;
  const geminiFallbacks = env.GEMINI_FALLBACK_MODELS ?? DEFAULT_GEMINI_FALLBACK_MODELS;
  const geminiModels = [
    ...new Set([geminiPrimary, ...geminiFallbacks.split(',').map((s) => s.trim()).filter(Boolean)]),
  ];

  const distDir = path.resolve(env.FRONTEND_DIST || path.join(ROOT_DIR, 'frontend', 'dist'));

  return {
    production,
    secretKey,
    accessTokenExpireMinutes: int(env.ACCESS_TOKEN_EXPIRE_MINUTES, 30),
    sessionIdleMinutes: int(env.SESSION_IDLE_MINUTES, 30),
    cookieSecure,
    cookieSameSite,
    // Explicit origins only (never "*": cookies are used).
    corsOrigins: (env.CORS_ORIGINS ?? DEFAULT_CORS_ORIGINS)
      .split(',')
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter((o) => o && o !== '*'),
    geminiApiKey: (env.GEMINI_API_KEY || '').trim(),
    geminiModels,
    geminiTimeoutMs: Math.max(5, int(env.GEMINI_TIMEOUT_SECONDS, 25)) * 1000,
    databaseUrl: (env.DATABASE_URL || '').trim(),
    dbAutoCreate: ['1', 'true', 'yes', 'on'].includes((env.DB_AUTO_CREATE || '').trim().toLowerCase()),
    dbPoolSize: int(env.DB_POOL_SIZE, 5),
    dbMaxOverflow: int(env.DB_MAX_OVERFLOW, 5),
    dbConnectTimeout: int(env.DB_CONNECT_TIMEOUT, 10),
    host: (env.HOST || '').trim() || (production ? '0.0.0.0' : '127.0.0.1'),
    port: int(env.PORT, 8000),
    distDir,
    hasFrontendBuild: fs.existsSync(path.join(distDir, 'index.html')),
    schemaFile: path.join(ROOT_DIR, 'supabase', 'schema.sql'),
  };
}
