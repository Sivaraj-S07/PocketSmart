import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export const ALGORITHM = 'HS256';
export const ACCESS_TOKEN_COOKIE = 'access_token';
const ACTIVITY_WRITE_INTERVAL_MS = 60_000;

/** Parse the ISO strings stored in the DB; naive timestamps are treated as UTC. */
export function parseTime(value) {
  const text = String(value);
  return new Date(/(Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`);
}

export function createAuth(config, db) {
  const lifetimeMs = config.accessTokenExpireMinutes * 60_000;

  // bcryptjs reads/writes the same $2b$ hashes that passlib produced.
  const hashPassword = (password) => bcrypt.hash(password, 12);
  async function verifyPassword(plain, hashed) {
    try {
      return await bcrypt.compare(plain, hashed);
    } catch {
      return false;
    }
  }

  async function authenticateUser(username, password) {
    const user = await db.getUserByUsername(username);
    if (!user || user.disabled || !(await verifyPassword(password, user.hashed_password))) return null;
    return user;
  }

  const createAccessToken = (claims, ttlMs) =>
    jwt.sign(claims, config.secretKey, { algorithm: ALGORITHM, expiresIn: Math.max(1, Math.floor(ttlMs / 1000)) });

  /** Create a server-side session and return the signed access token for it. */
  async function startSession(user) {
    const sessionId = crypto.randomUUID().replaceAll('-', '');
    await db.createSession(sessionId, user.id, new Date(Date.now() + lifetimeMs));
    return createAccessToken({ sub: user.username, jti: sessionId }, lifetimeMs);
  }

  function getTokenFromRequest(req) {
    const header = req.headers.authorization || '';
    const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null;
    return req.cookies?.[ACCESS_TOKEN_COOKIE] || bearer || null;
  }

  /** Read the session id from a (possibly expired) token we issued. */
  function sessionIdFromToken(token) {
    if (!token) return null;
    try {
      const claims = jwt.verify(token, config.secretKey, { algorithms: [ALGORITHM], ignoreExpiration: true });
      return typeof claims.jti === 'string' ? claims.jti : null;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------ cookies
  const cookieOptions = () => ({
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
    path: '/',
  });
  const setAuthCookie = (res, token) => res.cookie(ACCESS_TOKEN_COOKIE, token, { ...cookieOptions(), maxAge: lifetimeMs });
  const clearAuthCookie = (res) => res.clearCookie(ACCESS_TOKEN_COOKIE, cookieOptions());

  const unauthorized = (res) =>
    res.status(401).set('WWW-Authenticate', 'Bearer').json({ detail: 'Authentication required' });

  /** Express middleware: resolves the current user from the cookie or a Bearer token. */
  async function requireAuth(req, res, next) {
    const token = getTokenFromRequest(req);
    if (!token) return unauthorized(res);
    let claims;
    try {
      claims = jwt.verify(token, config.secretKey, { algorithms: [ALGORITHM] });
    } catch {
      return unauthorized(res);
    }
    const username = claims.sub;
    const sessionId = claims.jti;
    if (typeof username !== 'string' || !username || typeof sessionId !== 'string') return unauthorized(res);

    const session = await db.getSession(sessionId);
    const now = new Date();
    if (!session || session.revoked || parseTime(session.expires_at) < now) return unauthorized(res);
    const user = await db.getUserByUsername(username);
    if (!user || user.disabled || user.id !== session.user_id) return unauthorized(res);

    req.user = user;
    req.sessionId = sessionId;
    // Sliding session: re-issue the cookie once half of the lifetime is used,
    // so an active user is not signed out in the middle of a form.
    const expiresAt = parseTime(session.expires_at);
    if (expiresAt - now < lifetimeMs / 2) {
      await db.touchSession(sessionId, new Date(now.getTime() + lifetimeMs));
      setAuthCookie(res, createAccessToken({ sub: user.username, jti: sessionId }, lifetimeMs));
    } else if (now - parseTime(session.last_activity) > ACTIVITY_WRITE_INTERVAL_MS) {
      await db.touchSession(sessionId);
    }
    next();
  }

  return {
    hashPassword,
    verifyPassword,
    authenticateUser,
    createAccessToken,
    startSession,
    getTokenFromRequest,
    sessionIdFromToken,
    setAuthCookie,
    clearAuthCookie,
    requireAuth,
  };
}
