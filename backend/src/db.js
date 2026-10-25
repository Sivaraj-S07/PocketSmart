/**
 * Persistence layer - Supabase PostgreSQL.
 *
 * Connects straight to Postgres with DATABASE_URL (Supabase Dashboard -> Connect ->
 * "Session pooler").  The schema lives in supabase/schema.sql and is run once in the
 * Supabase SQL editor; it also enables Row Level Security.
 *
 * Every function takes/returns plain objects.  The module only needs a
 * `query(text, params) -> { rows, rowCount }` executor, which is what lets the test
 * suite swap in an in-process Postgres.
 */
import fs from 'node:fs';
import pg from 'pg';
import { parse as parseConnectionString } from 'pg-connection-string';

const TABLES = ['users', 'recommendations', 'sessions'];

/** ISO-8601 UTC with microseconds + "+00:00", the exact text format already stored in the tables. */
export function isoNow(date = new Date()) {
  return date.toISOString().replace(/\.(\d{3})Z$/, '.$1000+00:00');
}
export const toIso = isoNow;

const isSupabaseHost = (h) => /\.supabase\.(co|com)$/i.test(h || '');
const isLocalHost = (h) => ['localhost', '127.0.0.1', '::1', ''].includes((h || '').toLowerCase());

/** Build pg.Pool options from DATABASE_URL, normalising Supabase / Render / Heroku style URLs. */
export function poolOptions(config) {
  if (!config.databaseUrl) {
    throw new Error(
      'DATABASE_URL is not set. Copy backend/.env.example to backend/.env and paste your Supabase ' +
        '"Session pooler" connection string (Dashboard -> Connect).',
    );
  }
  const parsed = parseConnectionString(config.databaseUrl.replace(/^postgres:\/\//, 'postgresql://'));
  const wantsSsl = /[?&]sslmode=(require|verify-ca|verify-full|prefer)/i.test(config.databaseUrl);
  const sslDisabled = /[?&]sslmode=disable/i.test(config.databaseUrl);
  let ssl = false;
  if (!sslDisabled && (isSupabaseHost(parsed.host) || wantsSsl || (!isLocalHost(parsed.host) && parsed.ssl))) {
    // Same semantics as libpq's sslmode=require: encrypted, certificate not verified.
    ssl = { rejectUnauthorized: false };
  }
  return {
    host: parsed.host,
    port: parsed.port ? Number(parsed.port) : 5432,
    user: parsed.user,
    password: parsed.password,
    database: parsed.database,
    ssl,
    max: Math.max(1, config.dbPoolSize + config.dbMaxOverflow),
    connectionTimeoutMillis: config.dbConnectTimeout * 1000,
    idleTimeoutMillis: 30_000,
    maxLifetimeSeconds: 300,
  };
}

export function isUniqueViolation(err) {
  return Boolean(err) && err.code === '23505';
}

/**
 * @param {{query: Function, end?: Function}} executor
 * @param {{ dbAutoCreate?: boolean, schemaFile?: string, logger?: Console }} [options]
 */
export function createDb(executor, options = {}) {
  const logger = options.logger ?? console;
  const q = (text, params = []) => executor.query(text, params);

  const parseJson = (text, fallback) => {
    try {
      return JSON.parse(text || '');
    } catch {
      return fallback;
    }
  };

  const recommendationEntry = (row) => ({ ...row, preferences: parseJson(row.preferences, {}) });

  return {
    backendName: () => 'postgresql',

    async ping() {
      try {
        await q('SELECT 1');
        return true;
      } catch {
        return false;
      }
    },

    /**
     * Verify the schema at start-up.  We only *verify* by default: auto-creating tables ad hoc
     * could leave users.hashed_password readable through the Supabase Data API.
     * DB_AUTO_CREATE=true runs supabase/schema.sql instead (it enables RLS).
     */
    async initialize() {
      let existing;
      try {
        const r = await q(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)",
          [TABLES],
        );
        existing = new Set(r.rows.map((row) => row.table_name));
      } catch (err) {
        throw new Error(
          'Cannot connect to the PostgreSQL database. Check DATABASE_URL: use the Supabase ' +
            '*Session pooler* string (Dashboard -> Connect), URL-encode special characters in the ' +
            `password, and note that the direct db.<ref>.supabase.co host is IPv6-only. (${err.message})`,
        );
      }
      const missingTables = TABLES.filter((t) => !existing.has(t));
      if (missingTables.length) {
        if (options.dbAutoCreate && options.schemaFile && fs.existsSync(options.schemaFile)) {
          await executor.exec(fs.readFileSync(options.schemaFile, 'utf8'));
        } else {
          throw new Error(
            `Database table(s) missing: ${missingTables.join(', ')}. Open the Supabase SQL editor ` +
              'and run supabase/schema.sql once, then restart the app.',
          );
        }
      }
      try {
        const r = await q(
          "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
            "WHERE n.nspname = 'public' AND c.relname = ANY($1) AND NOT c.relrowsecurity",
          [TABLES],
        );
        if (r.rows.length)
          logger.warn(
            `Row Level Security is OFF for table(s) ${r.rows.map((x) => x.relname).sort().join(', ')}. ` +
              'Run supabase/schema.sql so the Supabase Data API (publishable key) cannot read them.',
          );
      } catch {
        /* advisory check only */
      }
    },

    // ----------------------------------------------------------------- users
    /** Throws an error with code 23505 on duplicate username/email. */
    async createUser({ username, email, fullName, hashedPassword }) {
      const r = await q(
        'INSERT INTO users (username, email, full_name, hashed_password, disabled, created_at) ' +
          'VALUES ($1, $2, $3, $4, false, $5) RETURNING id',
        [username, email || null, fullName || null, hashedPassword, isoNow()],
      );
      return r.rows[0].id;
    },

    async getUserByUsername(username) {
      const r = await q('SELECT * FROM users WHERE lower(username) = lower($1) LIMIT 1', [username]);
      return r.rows[0] ?? null;
    },

    async getUserById(id) {
      const r = await q('SELECT * FROM users WHERE id = $1', [id]);
      return r.rows[0] ?? null;
    },

    // ------------------------------------------------------- recommendations
    async saveRecommendation({ id, userId, category, budget, preferences, result, timestamp }) {
      await q(
        'INSERT INTO recommendations (id, user_id, category, budget, preferences, result, "timestamp") ' +
          'VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [id, userId, category, budget, JSON.stringify(preferences ?? {}), result, timestamp],
      );
    },

    /** All of a user's plans, newest first. */
    async listRecommendations(userId) {
      const r = await q(
        'SELECT * FROM recommendations WHERE user_id = $1 ORDER BY "timestamp" DESC, id DESC',
        [userId],
      );
      return r.rows.map(recommendationEntry);
    },

    /** One plan, only if it belongs to userId. */
    async getRecommendation(userId, id) {
      const r = await q('SELECT * FROM recommendations WHERE id = $1 AND user_id = $2', [id, userId]);
      return r.rows[0] ? recommendationEntry(r.rows[0]) : null;
    },

    async clearRecommendations(userId) {
      const r = await q('DELETE FROM recommendations WHERE user_id = $1', [userId]);
      return r.rowCount ?? 0;
    },

    // -------------------------------------------------------------- sessions
    async createSession(sessionId, userId, expiresAt) {
      const now = isoNow();
      await q(
        'INSERT INTO sessions (id, user_id, login_time, last_activity, expires_at, revoked, user_data) ' +
          "VALUES ($1, $2, $3, $3, $4, false, '{}')",
        [sessionId, userId, now, isoNow(expiresAt)],
      );
    },

    async getSession(sessionId) {
      const r = await q('SELECT * FROM sessions WHERE id = $1', [sessionId]);
      if (!r.rows[0]) return null;
      const session = r.rows[0];
      const data = parseJson(session.user_data || '{}', {});
      session.user_data = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
      return session;
    },

    async touchSession(sessionId, expiresAt = null) {
      if (expiresAt) {
        await q('UPDATE sessions SET last_activity = $2, expires_at = $3 WHERE id = $1', [sessionId, isoNow(), isoNow(expiresAt)]);
      } else {
        await q('UPDATE sessions SET last_activity = $2 WHERE id = $1', [sessionId, isoNow()]);
      }
    },

    async updateSessionData(sessionId, data) {
      const session = await this.getSession(sessionId);
      const merged = { ...(session ? session.user_data : {}), ...data };
      await q('UPDATE sessions SET user_data = $2, last_activity = $3 WHERE id = $1', [
        sessionId,
        JSON.stringify(merged),
        isoNow(),
      ]);
      return merged;
    },

    async revokeSession(sessionId) {
      await q('UPDATE sessions SET revoked = true WHERE id = $1', [sessionId]);
    },

    /** Delete expired and idle sessions. */
    async cleanupSessions(idleMinutes = 30) {
      const now = new Date();
      const idleCutoff = isoNow(new Date(now.getTime() - idleMinutes * 60_000));
      const r = await q('DELETE FROM sessions WHERE expires_at < $1 OR last_activity < $2', [isoNow(now), idleCutoff]);
      return r.rowCount ?? 0;
    },

    async close() {
      if (executor.end) await executor.end();
    },
  };
}

/** Production executor: a pg connection pool pointed at Supabase. */
export function createPgDb(config, options = {}) {
  const pool = new pg.Pool(poolOptions(config));
  // An idle client dropping (e.g. Supabase pausing) must not crash the process.
  pool.on('error', (err) => (options.logger ?? console).warn(`Idle database client error: ${err.message}`));
  const executor = {
    query: (text, params) => pool.query(text, params),
    exec: (sql) => pool.query(sql),
    end: () => pool.end(),
  };
  return createDb(executor, { dbAutoCreate: config.dbAutoCreate, schemaFile: config.schemaFile, ...options });
}
