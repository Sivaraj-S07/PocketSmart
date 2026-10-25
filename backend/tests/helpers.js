import fs from 'node:fs';
import pg from 'pg';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db.js';

const SCHEMA = fs.readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8');
const ROLES = 'DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;' +
  'DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;';

/**
 * Test database: a disposable PostgreSQL.  By default an in-process Postgres (PGlite) is used so
 * `npm test` needs nothing installed.  Set TEST_DATABASE_URL to run against a real, DISPOSABLE
 * Postgres instead (never point it at production: the tables are emptied).
 */
async function makeExecutor() {
  if (process.env.TEST_DATABASE_URL) {
    const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });
    await pool.query(ROLES);
    await pool.query(SCHEMA);
    await pool.query('TRUNCATE sessions, recommendations, users RESTART IDENTITY CASCADE');
    return { query: (t, p) => pool.query(t, p), exec: (s) => pool.query(s), end: () => pool.end() };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const lite = new PGlite();
  await lite.exec(ROLES);
  await lite.exec(SCHEMA);
  return {
    query: async (text, params) => {
      const r = await lite.query(text, params);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    },
    exec: (sql) => lite.exec(sql),
    end: () => lite.close(),
  };
}

const quiet = { log() {}, info() {}, warn() {}, error() {} };

export async function startTestApp({ env = {}, clientFactory, logger = quiet } = {}) {
  const config = loadConfig({
    ENVIRONMENT: 'development',
    SECRET_KEY: 'test-secret-key',
    CORS_ORIGINS: 'http://localhost:3000',
    FRONTEND_DIST: '/nonexistent',
    ...env,
  });
  const executor = await makeExecutor();
  const db = createDb(executor, { logger, dbAutoCreate: false });
  await db.initialize();

  let recommend;
  if (clientFactory) {
    const { createRecommender } = await import('../src/recommendations.js');
    recommend = createRecommender(config, { clientFactory, logger });
  }
  const app = createApp({ config, db, recommend, logger });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  /** A tiny fetch client with its own cookie jar (one browser). */
  function client() {
    let cookie = '';
    const request = async (method, path, { json, form, headers = {}, raw } = {}) => {
      const h = { ...headers };
      if (cookie) h.cookie = cookie;
      let body;
      if (json !== undefined) { h['content-type'] = 'application/json'; body = JSON.stringify(json); }
      else if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
      else if (raw !== undefined) { h['content-type'] = 'application/json'; body = raw; }
      const res = await fetch(base + path, { method, headers: h, body, redirect: 'manual' });
      for (const sc of res.headers.getSetCookie?.() ?? []) {
        const [pair] = sc.split(';');
        const [name, ...rest] = pair.split('=');
        const value = rest.join('=');
        const jar = Object.fromEntries(cookie.split('; ').filter(Boolean).map((p) => [p.split('=')[0], p.split('=').slice(1).join('=')]));
        if (value === '' || /expires=Thu, 01 Jan 1970/i.test(sc)) delete jar[name]; else jar[name] = value;
        cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
      }
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch { /* not JSON */ }
      return { status: res.status, headers: res.headers, text, data };
    };
    return {
      get: (p, o) => request('GET', p, o),
      post: (p, json, o) => request('POST', p, { json, ...o }),
      del: (p, o) => request('DELETE', p, o),
      request,
      get cookie() { return cookie; },
    };
  }

  return {
    config, db, app, base, client,
    async close() {
      await new Promise((r) => server.close(r));
      await db.close();
    },
  };
}

let counter = 0;
export const uniqueName = (prefix = 'user') => `${prefix}_${Date.now().toString(36)}${counter++}`;
export const PASSWORD = 'correct-horse-battery';

export async function registerAndLogin(ctx, username = uniqueName()) {
  const c = ctx.client();
  const reg = await c.post('/api/register', { username, password: PASSWORD });
  if (reg.status !== 201) throw new Error(`register failed: ${reg.status} ${reg.text}`);
  const login = await c.request('POST', '/api/token', { form: { username, password: PASSWORD } });
  if (login.status !== 200) throw new Error(`login failed: ${login.status} ${login.text}`);
  return { c, username, token: login.data.access_token };
}

export const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
export const GIF_1PX = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** Fake Gemini client factory; `handler(model, request)` returns text or throws. */
export function fakeGemini(handler) {
  const calls = [];
  const factory = () => ({
    models: {
      generateContent: async (request) => {
        calls.push(request);
        return { text: await handler(request.model, request) };
      },
    },
  });
  factory.calls = calls;
  return factory;
}
