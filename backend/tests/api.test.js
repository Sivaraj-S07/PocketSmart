import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import jwt from 'jsonwebtoken';
import { PASSWORD, PNG_1PX, GIF_1PX, registerAndLogin, startTestApp, uniqueName } from './helpers.js';

let ctx;
before(async () => { ctx = await startTestApp(); });
after(async () => { await ctx.close(); });

const sum = (list, key) => list.reduce((s, x) => s + x[key], 0);
const plan = (res) => JSON.parse(res.data.recommendations);

describe('status, static and access control', () => {
  test('health GET/HEAD, startup, favicon redirect, security headers', async () => {
    const c = ctx.client();
    assert.deepEqual((await c.get('/health')).data, { status: 'ok' });
    assert.equal((await c.request('HEAD', '/health')).status, 200);
    const startup = await c.get('/startup');
    assert.equal(startup.status, 200);
    assert.equal(startup.data.status, 'running');
    assert.equal(startup.data.ai_enabled, false);
    assert.deepEqual(startup.data.database, { backend: 'postgresql', ok: true });
    assert.equal((await c.get('/api/startup')).data.status, 'running');
    const fav = await c.get('/favicon.ico');
    assert.equal(fav.status, 302);
    assert.equal(fav.headers.get('location'), '/favicon.svg');
    assert.equal(startup.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(startup.headers.get('x-frame-options'), 'DENY');
  });

  test('private endpoints return 401 JSON; unknown API routes 404', async () => {
    const c = ctx.client();
    for (const path of ['/api/history', '/api/me', '/api/session-info', '/api/session-data']) {
      const r = await c.get(path);
      assert.equal(r.status, 401, path);
      assert.equal(r.data.detail, 'Authentication required');
      assert.equal(r.headers.get('www-authenticate'), 'Bearer');
    }
    assert.equal((await c.post('/api/generate-home', { budget: 1000, rooms: '1' })).status, 401);
    assert.equal((await c.get('/api/nope')).status, 404);
  });

  test('CORS allows only configured origins', async () => {
    const c = ctx.client();
    const allowed = await c.get('/health', { headers: { origin: 'http://localhost:3000' } });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:3000');
    assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true');
    const denied = await c.get('/health', { headers: { origin: 'https://evil.example' } });
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
    const preflight = await c.request('OPTIONS', '/api/token', {
      headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'POST' },
    });
    assert.ok([200, 204].includes(preflight.status));
  });
});

describe('accounts and sessions', () => {
  test('registration validation, duplicates, login, logout', async () => {
    const c = ctx.client();
    const username = uniqueName();
    assert.equal((await c.post('/api/register', { username, password: PASSWORD })).status, 201);
    assert.equal((await c.post('/api/register', { username, password: PASSWORD })).status, 409);
    assert.equal((await c.post('/api/register', { username: 'x', password: 'short' })).status, 422);
    assert.equal((await c.post('/api/register', { username: 'bad name!', password: PASSWORD })).status, 422);
    assert.equal((await c.post('/api/register', { username: uniqueName(), password: 'é'.repeat(37) })).status, 422); // 74 bytes
    assert.equal((await c.post('/api/register', { username: uniqueName(), password: 'a'.repeat(72) })).status, 201);

    assert.equal((await c.request('POST', '/api/token', { form: { username, password: 'not-the-password' } })).status, 401);
    const login = await c.request('POST', '/api/token', { form: { username, password: PASSWORD } });
    assert.equal(login.status, 200);
    assert.equal(login.data.token_type, 'bearer');
    assert.match(c.cookie, /access_token=/);
    assert.equal((await c.get('/api/me')).data.username, username);
    assert.equal((await c.get('/api/session-info')).data.username, username);
    assert.equal((await c.get('/api/session-data')).data.recommendations, 0);
    assert.equal((await c.post('/api/logout', {})).status, 204);
    assert.equal((await c.get('/api/me')).status, 401);
  });

  test('login accepts JSON too, and the cookie is HttpOnly', async () => {
    const username = uniqueName();
    const c = ctx.client();
    await c.post('/api/register', { username, password: PASSWORD });
    const r = await c.post('/api/token', { username, password: PASSWORD });
    assert.equal(r.status, 200);
    assert.match(r.headers.getSetCookie().join(';').toLowerCase(), /httponly/);
    assert.equal((await c.request('POST', '/api/token', { form: { username } })).status, 422);
  });

  test('registration errors keep the FastAPI-style detail array', async () => {
    const r = await ctx.client().post('/api/register', { username: 'ab', password: 'short' });
    assert.ok(Array.isArray(r.data.detail));
    assert.deepEqual(r.data.detail[0].loc, ['body', 'username']);
    assert.ok(r.data.detail[0].msg);
    const bad = await ctx.client().request('POST', '/api/register', { raw: '{not json' });
    assert.equal(bad.status, 422);
  });

  test('usernames are unique case-insensitively but login ignores case', async () => {
    const username = uniqueName('CaseUser');
    const c = ctx.client();
    assert.equal((await c.post('/api/register', { username, password: PASSWORD })).status, 201);
    assert.equal((await c.post('/api/register', { username: username.toLowerCase(), password: PASSWORD })).status, 409);
    assert.equal((await c.request('POST', '/api/token', { form: { username: username.toUpperCase(), password: PASSWORD } })).status, 200);
  });

  test('duplicate email is rejected, blank emails are not', async () => {
    const email = `${uniqueName('mail')}@example.com`;
    const c = ctx.client();
    assert.equal((await c.post('/api/register', { username: uniqueName(), password: PASSWORD, email })).status, 201);
    assert.equal((await c.post('/api/register', { username: uniqueName(), password: PASSWORD, email: email.toUpperCase() })).status, 409);
    assert.equal((await c.post('/api/register', { username: uniqueName(), password: PASSWORD, email: '' })).status, 201);
    assert.equal((await c.post('/api/register', { username: uniqueName(), password: PASSWORD, email: '  ' })).status, 201); // trimmed to blank -> stored as NULL, like the original
  });

  test('Bearer auth works and history is isolated between accounts', async () => {
    const a = await registerAndLogin(ctx);
    const b = await registerAndLogin(ctx);
    const created = await a.c.post('/api/generate-home', { budget: 5000, rooms: '1', style: 'Modern' });
    assert.equal(created.status, 200);
    assert.equal((await b.c.get('/api/history')).data.total, 0);
    const viaBearer = await ctx.client().get('/api/history', { headers: { authorization: `Bearer ${a.token}` } });
    assert.equal(viaBearer.data.total, 1);
  });

  test('session-info / session-data merge and size limit', async () => {
    const { c, username } = await registerAndLogin(ctx);
    const info = (await c.get('/api/session-info')).data;
    for (const key of ['status', 'username', 'login_time', 'last_activity', 'session_duration', 'user_data']) assert.ok(key in info, key);
    assert.equal(info.username, username);
    const updated = await c.post('/api/session-data', { theme: 'dark' });
    assert.deepEqual(updated.data.data, { theme: 'dark' });
    await c.post('/api/session-data', { lang: 'en' });
    assert.deepEqual((await c.get('/api/session-info')).data.user_data, { theme: 'dark', lang: 'en' });
    assert.equal((await c.post('/api/session-data', { x: 'y'.repeat(20000) })).status, 413);
  });

  test('logout revokes the token server-side', async () => {
    const { c, token } = await registerAndLogin(ctx);
    assert.equal((await c.post('/api/logout', {})).status, 204);
    const stolen = await ctx.client().get('/api/me', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(stolen.status, 401);
  });

  test('tampered, unsessioned and foreign-secret tokens are rejected', async () => {
    const { username } = await registerAndLogin(ctx);
    const noJti = jwt.sign({ sub: username }, 'test-secret-key', { expiresIn: 600 });
    const wrongSecret = jwt.sign({ sub: username, jti: 'abc' }, 'other-secret', { expiresIn: 600 });
    const expired = jwt.sign({ sub: username, jti: 'abc' }, 'test-secret-key', { expiresIn: -10 });
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(`{"sub":"${username}","jti":"x"}`).toString('base64url')}.`;
    for (const token of [noJti, wrongSecret, expired, none, 'garbage']) {
      const r = await ctx.client().get('/api/me', { headers: { authorization: `Bearer ${token}` } });
      assert.equal(r.status, 401);
    }
  });

  test('idle sessions are removed by the cleanup task', async () => {
    const { c, token } = await registerAndLogin(ctx);
    const sessionId = jwt.decode(token).jti;
    assert.ok(await ctx.db.getSession(sessionId));
    await ctx.db.cleanupSessions(30);
    assert.ok(await ctx.db.getSession(sessionId));
    assert.ok((await ctx.db.cleanupSessions(-1)) >= 1);
    assert.equal(await ctx.db.getSession(sessionId), null);
    assert.equal((await c.get('/api/me')).status, 401);
  });

  test('sliding session re-issues the cookie once half the lifetime is used', async () => {
    const { c, token } = await registerAndLogin(ctx);
    const sessionId = jwt.decode(token).jti;
    // Fresh session: no refresh.
    const fresh = await c.get('/api/me');
    assert.equal(fresh.headers.getSetCookie().length, 0);
    // Pretend 20 of 30 minutes are gone.
    const soon = new Date(Date.now() + 10 * 60_000);
    await ctx.db.touchSession(sessionId, soon);
    const refreshed = await c.get('/api/me');
    assert.equal(refreshed.status, 200);
    assert.ok(refreshed.headers.getSetCookie().some((s) => s.startsWith('access_token=')));
    const session = await ctx.db.getSession(sessionId);
    assert.ok(new Date(session.expires_at) - Date.now() > 25 * 60_000);
  });
});

describe('planners', () => {
  test('all planners fall back offline, add up to the budget, save history, and can be cleared', async () => {
    const { c } = await registerAndLogin(ctx);
    const requests = [
      ['/api/generate-home', { budget: 50000, rooms: '2', style: 'Minimalist', room_types: ['Living Room', 'Bedroom'] }, 'categories'],
      ['/api/generate-party', { budget: 30000, event_type: 'Birthday Party', guests: 40, location: 'Home', includes: ['Catering', 'Decoration'] }, 'categories'],
      ['/api/generate-jewelry', { budget: 20000, occasion: 'Wedding', jewelry_types: ['Earrings', 'Necklace'], metal_preference: 'Gold' }, 'jewelry'],
    ];
    for (const [path, body, key] of requests) {
      const res = await c.post(path, body);
      assert.equal(res.status, 200, res.text);
      assert.equal(res.data.source, 'fallback');
      assert.equal(res.data.budget, body.budget);
      assert.ok(res.data.id);
      const result = plan(res);
      if (key === 'categories') assert.equal(sum(result.categories, 'allocation'), body.budget);
      else assert.ok(sum(result.jewelry, 'price') <= body.budget);
    }
    const history = (await c.get('/api/history')).data;
    assert.equal(history.total, 3);
    assert.deepEqual(new Set(history.history.map((h) => h.category)), new Set(['home', 'party', 'jewelry']));
    // newest first
    const times = history.history.map((h) => h.timestamp);
    assert.deepEqual(times, [...times].sort().reverse());
    const cleared = await c.del('/api/history');
    assert.equal(cleared.status, 200);
    assert.equal(cleared.data.deleted, 3);
    assert.equal((await c.get('/api/history')).data.total, 0);
  });

  test('party plan with no selected services still uses the full budget', async () => {
    const { c } = await registerAndLogin(ctx);
    const res = await c.post('/api/generate-party', { budget: 10001, event_type: 'Birthday', guests: 10, includes: [] });
    assert.equal(res.status, 200);
    assert.equal(sum(plan(res).categories, 'allocation'), 10001);
  });

  test('numeric strings are coerced like the original Pydantic models (guests from a form)', async () => {
    const { c } = await registerAndLogin(ctx);
    const res = await c.post('/api/generate-party', { budget: '12000', event_type: 'Birthday', guests: '50' });
    assert.equal(res.status, 200);
    assert.match(plan(res).categories[0].items[0].name, /for 50 guests/);
  });

  test('home quantities are honoured and the budget adds up', async () => {
    const { c } = await registerAndLogin(ctx);
    const res = await c.post('/api/generate-home', {
      budget: 100000, rooms: '3', style: 'Modern', room_types: ['Living Room', 'Bedroom'],
      num_lights: 5, num_fans: 4, num_furniture: 2, num_dining_tables: 1,
      platforms: ['Amazon', 'IKEA', 'Myntra', 'Ajio', 'Evil'],
    });
    const p = plan(res);
    const quantities = Object.fromEntries(p.categories.flatMap((cat) => cat.items.map((i) => [i.name, i.quantity])));
    assert.equal(quantities['LED light fixtures'], 5);
    assert.equal(quantities['Energy-efficient ceiling fans'], 4);
    assert.equal(quantities['Furniture pieces'], 2);
    assert.equal(quantities['Dining tables'], 1);
    assert.equal(sum(p.categories, 'allocation'), 100000);
    assert.equal(p.remaining_budget, 0);
    assert.equal(p.total_budget, 100000);
    assert.equal(p.calculation_table.length, p.categories.length);
    const links = p.categories[0].items[0].shopping_links;
    assert.deepEqual(new Set(Object.keys(links)), new Set(['Amazon', 'IKEA', 'Myntra', 'Ajio']));
    assert.ok(Object.values(links).every((u) => u.startsWith('https://')));
  });

  test('home without quantities and with defaults still works', async () => {
    const { c } = await registerAndLogin(ctx);
    const res = await c.post('/api/generate-home', { budget: 50000, rooms: '1' });
    assert.equal(sum(plan(res).categories, 'allocation'), 50000);
  });

  test('party links follow the category rules; venues get search links', async () => {
    const { c } = await registerAndLogin(ctx);
    const p = plan(await c.post('/api/generate-party', {
      budget: 40000, event_type: 'Wedding Reception', guests: 80, location: 'Banquet Hall',
      includes: ['Catering', 'Decoration', 'Entertainment'],
    }));
    const byCategory = Object.fromEntries(p.categories.map((cat) => [cat.name, new Set(Object.keys(cat.items[0].shopping_links))]));
    assert.deepEqual(byCategory.Catering, new Set(['Swiggy', 'Zomato']));
    assert.ok(byCategory.Decoration.has('Meesho'));
    assert.ok(byCategory.Entertainment.has('BookMyShow'));
    const links = p.venues[0].search_links;
    for (const k of ['OYO', 'Booking', 'MakeMyTrip']) assert.ok(k in links);
  });

  test('jewelry links honour the chosen platforms and remaining budget is exact', async () => {
    const { c } = await registerAndLogin(ctx);
    const p = plan(await c.post('/api/generate-jewelry', {
      budget: 20000, occasion: 'Gift', jewelry_types: ['Earrings', 'Ring'], platforms: ['tanishq', 'Caratlane'],
    }));
    for (const item of p.jewelry) assert.deepEqual(new Set(Object.keys(item.shopping_links)), new Set(['Tanishq', 'CaratLane']));
    assert.ok(Math.abs(p.remaining_budget - (20000 - sum(p.jewelry, 'price'))) < 0.005);
  });

  test('unknown platforms never become links', async () => {
    const { c } = await registerAndLogin(ctx);
    const p = plan(await c.post('/api/generate-home', {
      budget: 10000, rooms: '1', platforms: ['Amazon', 'javascript:alert(1)', 'http://evil.example'],
    }));
    assert.deepEqual(Object.keys(p.categories[0].items[0].shopping_links), ['Amazon']);
  });

  test('invalid inputs are rejected with 422', async () => {
    const { c } = await registerAndLogin(ctx);
    assert.equal((await c.post('/api/generate-home', { budget: 0, rooms: '1', style: 'Modern' })).status, 422);
    assert.equal((await c.post('/api/generate-home', { budget: 100, rooms: '1', num_fans: 501 })).status, 422);
    assert.equal((await c.post('/api/generate-home', { budget: 100, rooms: '1', num_fans: 1.5 })).status, 422);
    assert.equal((await c.post('/api/generate-home', { budget: 100, rooms: '' })).status, 422);
    assert.equal((await c.post('/api/generate-home', { budget: 100000000, rooms: '1' })).status, 422);
    assert.equal((await c.post('/api/generate-party', { budget: 1000, event_type: 'Birthday', guests: 0 })).status, 422);
    assert.equal((await c.post('/api/generate-jewelry', { budget: 1000, occasion: '' })).status, 422);
    assert.equal((await c.post('/api/generate-jewelry', { budget: 1000, occasion: 'Gift', jewelry_types: Array(9).fill('Ring') })).status, 422);
    assert.equal((await c.request('POST', '/api/generate-home', { raw: '[]' })).status, 422);
  });

  test('outfit images: valid PNG accepted; bad data, wrong type and oversize rejected', async () => {
    const { c } = await registerAndLogin(ctx);
    const base = { budget: 8000, occasion: 'Wedding', jewelry_types: ['Earrings'] };
    const ok = await c.post('/api/generate-jewelry', { ...base, image: PNG_1PX });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.data.source, 'fallback');
    const p = plan(ok);
    assert.equal(p.outfit_analysis, null);
    assert.ok(p.tips.some((t) => t.includes('unavailable in offline mode')));
    assert.equal((await c.post('/api/generate-jewelry', { ...base, image: 'not base64!!' })).status, 422);
    assert.equal((await c.post('/api/generate-jewelry', { ...base, image: Buffer.from('plain text file').toString('base64') })).status, 422);
    assert.equal((await c.post('/api/generate-jewelry', { ...base, image: GIF_1PX })).status, 415);
    const big = Buffer.concat([Buffer.from(PNG_1PX, 'base64'), Buffer.alloc(5 * 1024 * 1024 + 10)]).toString('base64');
    const tooBig = await c.post('/api/generate-jewelry', { ...base, image: big });
    assert.equal(tooBig.status, 413);
    assert.match(tooBig.data.detail, /5 MB/);
    assert.equal((await c.post('/api/generate-jewelry', { ...base, image: null })).status, 200);
  });

  test('generic /recommendations-details endpoint', async () => {
    const { c } = await registerAndLogin(ctx);
    const res = await c.post('/api/recommendations-details', { category: 'home', budget: 20000, preferences: { rooms: '1' } });
    assert.equal(res.status, 200);
    assert.equal(res.data.source, 'fallback');
    assert.equal((await c.post('/api/recommendations-details', { category: 'cars', budget: 20000 })).status, 422);
    assert.equal((await c.post('/api/recommendations-details', { budget: 20000 })).status, 200); // category defaults to home
    const party = await c.post('/api/recommendations-details', { category: 'party', budget: 9000, preferences: { guests: 5, includes: ['Cake & Sweets'] } });
    assert.equal(sum(plan(party).categories, 'allocation'), 9000);
    const jewel = await c.post('/api/recommendations-details', { category: 'jewelry', budget: 9000 });
    assert.ok(plan(jewel).jewelry.length > 0);
  });

  test('recommendation details endpoint and ownership', async () => {
    const a = await registerAndLogin(ctx);
    const b = await registerAndLogin(ctx);
    const created = await a.c.post('/api/generate-home', { budget: 15000, rooms: '1' });
    const details = await a.c.get(`/api/recommendation-details/${created.data.id}`);
    assert.equal(details.status, 200);
    assert.equal(details.data.type, 'home');
    assert.ok('categories' in details.data.full_result);
    assert.equal(details.data.input.rooms, '1');
    assert.equal((await a.c.get('/api/recommendation-details/does-not-exist')).status, 404);
    assert.equal((await b.c.get(`/api/recommendation-details/${created.data.id}`)).status, 404);
  });
});

describe('Gemini integration (mocked client)', () => {
  const goodPlan = (allocation = 1000) => JSON.stringify({
    categories: [{ name: 'Lighting', icon: '💡', allocation, items: [{ name: 'LED bulb', description: 'x', price: '₹100', quantity: 2, search_terms: 'led bulb warm white' }] }],
    tips: ['Buy LEDs'],
  });
  const req = { budget: 3000, rooms: '1', style: 'Modern' };

  async function withGemini(handler, run) {
    const factory = (await import('./helpers.js')).fakeGemini(handler);
    const local = await startTestApp({ env: { GEMINI_API_KEY: 'fake-key', GEMINI_MODEL: 'm1', GEMINI_FALLBACK_MODELS: 'm2' }, clientFactory: factory });
    try {
      const { c } = await registerAndLogin(local);
      await run({ c, factory, local });
    } finally {
      await local.close();
    }
  }

  test('valid JSON from the model is used and enriched (string prices tolerated)', async () => {
    await withGemini(() => '```json\n' + goodPlan() + '\n```', async ({ c, factory, local }) => {
      const res = await c.post('/api/generate-home', req);
      assert.equal(res.data.source, 'gemini');
      const p = plan(res);
      const item = p.categories[0].items[0];
      assert.equal(item.price, 100);
      assert.equal(item.quantity, 2);
      assert.match(item.shopping_links.Amazon, /led\+bulb\+warm\+white/);
      assert.equal(p.remaining_budget, 2000);
      assert.equal(factory.calls.length, 1);
      assert.equal(factory.calls[0].model, 'm1');
      assert.equal((await c.get('/startup')).data.ai_enabled, true);
    });
  });

  test('failures fall back to the next model, then offline, and say so', async () => {
    await withGemini(() => { throw new Error('quota exceeded'); }, async ({ c, factory }) => {
      const res = await c.post('/api/generate-home', req);
      assert.equal(res.data.source, 'fallback');
      assert.deepEqual(factory.calls.map((x) => x.model), ['m1', 'm2']);
      assert.ok(plan(res).tips.some((t) => t.includes('unavailable')));
    });
  });

  test('a failing first model is skipped when the second works', async () => {
    await withGemini((model) => { if (model === 'm1') throw new Error('retired'); return goodPlan(); }, async ({ c }) => {
      assert.equal((await c.post('/api/generate-home', req)).data.source, 'gemini');
    });
  });

  test('over-budget or malformed plans are rejected', async () => {
    await withGemini(() => goodPlan(99999), async ({ c }) => {
      assert.equal((await c.post('/api/generate-home', req)).data.source, 'fallback');
    });
    await withGemini(() => 'sorry, I cannot do that', async ({ c }) => {
      assert.equal((await c.post('/api/generate-home', req)).data.source, 'fallback');
    });
  });

  test('outfit image is forwarded to the model as inline data', async () => {
    const jewelry = JSON.stringify({ outfit_analysis: { colors: 'red', style: 'saree', formality: 'formal' }, jewelry: [{ name: 'Studs', type: 'Earrings', description: 'd', style: 's', price: 500 }], tips: [] });
    await withGemini(() => jewelry, async ({ c, factory }) => {
      const res = await c.post('/api/generate-jewelry', { budget: 5000, occasion: 'Wedding', image: PNG_1PX });
      assert.equal(res.data.source, 'gemini');
      assert.equal(plan(res).outfit_analysis.colors, 'red');
      const parts = factory.calls[0].contents[0].parts;
      assert.equal(parts[1].inlineData.mimeType, 'image/png');
      assert.equal(parts[1].inlineData.data, PNG_1PX);
    });
  });
});
