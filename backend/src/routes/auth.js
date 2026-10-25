import { Router } from 'express';
import { validate } from '../validation.js';
import { registerSchema, sessionDataMaxBytes } from '../schemas.js';
import { isUniqueViolation } from '../db.js';
import { parseTime } from '../auth.js';

const invalid = (res, issues) => res.status(422).json({ detail: issues });

export function authRoutes({ db, auth }) {
  const router = Router();

  router.post('/register', async (req, res) => {
    const { value, issues } = validate(registerSchema, req.body);
    if (issues) return invalid(res, issues);
    try {
      await db.createUser({
        username: value.username,
        email: value.email,
        fullName: value.full_name,
        hashedPassword: await auth.hashPassword(value.password),
      });
    } catch (err) {
      if (isUniqueViolation(err)) return res.status(409).json({ detail: 'Username or email is already registered' });
      throw err;
    }
    res.status(201).json({ message: 'User registered successfully' });
  });

  // Accepts JSON or application/x-www-form-urlencoded: { username, password }.
  router.post('/token', async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const issues = [];
    for (const key of ['username', 'password']) {
      if (body[key] === undefined) issues.push({ type: 'missing', loc: ['body', key], msg: 'Field required' });
      else if (typeof body[key] !== 'string') issues.push({ type: 'string_type', loc: ['body', key], msg: 'Input should be a valid string' });
    }
    if (issues.length) return invalid(res, issues);

    const user = await auth.authenticateUser(body.username, body.password);
    if (!user) {
      return res.status(401).set('WWW-Authenticate', 'Bearer').json({ detail: 'Incorrect username or password' });
    }
    const accessToken = await auth.startSession(user);
    auth.setAuthCookie(res, accessToken);
    res.json({ access_token: accessToken, token_type: 'bearer' });
  });

  router.post('/logout', async (req, res) => {
    const sessionId = auth.sessionIdFromToken(auth.getTokenFromRequest(req));
    if (sessionId) await db.revokeSession(sessionId);
    auth.clearAuthCookie(res);
    res.status(204).end();
  });

  router.get('/me', auth.requireAuth, (req, res) => {
    res.json({ username: req.user.username, full_name: req.user.full_name });
  });

  router.get('/session-info', auth.requireAuth, async (req, res) => {
    const session = (await db.getSession(req.sessionId)) ?? {};
    res.json({
      status: 'active',
      username: req.user.username,
      login_time: session.login_time ?? null,
      last_activity: session.last_activity ?? null,
      session_duration: session.login_time
        ? Math.floor((Date.now() - parseTime(session.login_time).getTime()) / 60_000)
        : 0,
      user_data: session.user_data ?? {},
    });
  });

  router.get('/session-data', auth.requireAuth, async (req, res) => {
    const session = (await db.getSession(req.sessionId)) ?? {};
    res.json({
      recommendations: (await db.listRecommendations(req.user.id)).length,
      user_data: session.user_data ?? {},
    });
  });

  /** Merge small key/value preferences into the current session. */
  router.post('/session-data', auth.requireAuth, async (req, res) => {
    const data = req.body;
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return invalid(res, [{ type: 'dict_type', loc: ['body'], msg: 'Input should be a valid dictionary' }]);
    }
    if (Buffer.byteLength(JSON.stringify(data), 'utf8') > sessionDataMaxBytes) {
      return res.status(413).json({ detail: 'Session data is too large' });
    }
    const merged = await db.updateSessionData(req.sessionId, data);
    res.json({ message: 'Session data updated', data: merged });
  });

  return router;
}
