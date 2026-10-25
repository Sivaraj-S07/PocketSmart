import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { isUniqueViolation, poolOptions } from '../src/db.js';
import { startTestApp } from './helpers.js';

describe('configuration', () => {
  test('production refuses to start without SECRET_KEY', () => {
    assert.throws(() => loadConfig({ ENVIRONMENT: 'production' }), /SECRET_KEY must be set/);
    assert.throws(() => loadConfig({ RENDER: 'true' }), /SECRET_KEY must be set/);
    assert.doesNotThrow(() => loadConfig({ ENVIRONMENT: 'production', SECRET_KEY: 'x'.repeat(40) }));
  });

  test('development generates a throwaway key; production defaults are secure', () => {
    assert.ok(loadConfig({}).secretKey.length >= 32);
    const prod = loadConfig({ ENVIRONMENT: 'production', SECRET_KEY: 'k' });
    assert.equal(prod.cookieSecure, true);
    assert.equal(prod.host, '0.0.0.0');
    assert.equal(loadConfig({}).cookieSecure, false);
    assert.equal(loadConfig({}).host, '127.0.0.1');
  });

  test('SameSite=None forces Secure; wildcard CORS origins are dropped', () => {
    const c = loadConfig({ COOKIE_SAMESITE: 'none', CORS_ORIGINS: '*, https://a.example/ ,https://b.example' });
    assert.equal(c.cookieSecure, true);
    assert.deepEqual(c.corsOrigins, ['https://a.example', 'https://b.example']);
  });

  test('Gemini model chain is de-duplicated and ordered', () => {
    const c = loadConfig({ GEMINI_MODEL: 'a', GEMINI_FALLBACK_MODELS: 'b, a ,c' });
    assert.deepEqual(c.geminiModels, ['a', 'b', 'c']);
  });
});

describe('database connection options', () => {
  const opts = (url) => poolOptions({ databaseUrl: url, dbPoolSize: 5, dbMaxOverflow: 5, dbConnectTimeout: 10 });

  test('a missing DATABASE_URL gives an actionable error', () => {
    assert.throws(() => opts(''), /DATABASE_URL is not set/);
  });

  test('Supabase pooler URLs parse (encoded passwords) and enable SSL', () => {
    const o = opts('postgresql://postgres.abcd:p%40ss%23w%2Frd@aws-0-ap-south-1.pooler.supabase.com:5432/postgres');
    assert.equal(o.user, 'postgres.abcd');
    assert.equal(o.password, 'p@ss#w/rd');
    assert.equal(o.host, 'aws-0-ap-south-1.pooler.supabase.com');
    assert.equal(o.port, 5432);
    assert.deepEqual(o.ssl, { rejectUnauthorized: false });
    assert.equal(o.max, 10);
  });

  test('postgres:// scheme, sslmode and local hosts are handled', () => {
    assert.deepEqual(opts('postgres://u:p@db.example.com/app?sslmode=require').ssl, { rejectUnauthorized: false });
    assert.equal(opts('postgresql://u:p@localhost:5432/app').ssl, false);
    assert.equal(opts('postgresql://u:p@x.supabase.co/app?sslmode=disable').ssl, false);
  });

  test('unique violations are recognised', () => {
    assert.equal(isUniqueViolation({ code: '23505' }), true);
    assert.equal(isUniqueViolation(new Error('x')), false);
  });
});

describe('serving the built React app', () => {
  let ctx, dist;
  before(async () => {
    dist = fs.mkdtempSync(path.join(os.tmpdir(), 'pocketsmart-dist-'));
    fs.mkdirSync(path.join(dist, 'assets'));
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><div id="root">SPA</div>');
    fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log(1)');
    ctx = await startTestApp({ env: { FRONTEND_DIST: dist } });
  });
  after(async () => {
    await ctx.close();
    fs.rmSync(dist, { recursive: true, force: true });
  });

  test('index, deep links and assets are served; API 404s stay JSON', async () => {
    const c = ctx.client();
    for (const p of ['/', '/dashboard', '/history', '/login', '/some/deep/link']) {
      const r = await c.get(p);
      assert.equal(r.status, 200, p);
      assert.match(r.text, /SPA/);
    }
    const asset = await c.get('/assets/app.js');
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type'), /javascript/);
    const missing = await c.get('/assets/old-hash.js');
    assert.equal(missing.status, 404);
    assert.doesNotMatch(missing.text, /SPA/);
    const api = await c.get('/api/nope');
    assert.equal(api.status, 404);
    assert.deepEqual(api.data, { detail: 'Not Found' });
    assert.equal((await c.get('/health')).data.status, 'ok');
  });
});

describe('without a frontend build', () => {
  test('the root explains how to build or run the frontend', async () => {
    const ctx = await startTestApp();
    try {
      const r = await ctx.client().get('/');
      assert.equal(r.status, 200);
      assert.match(r.data.message, /npm run build/);
    } finally {
      await ctx.close();
    }
  });
});
