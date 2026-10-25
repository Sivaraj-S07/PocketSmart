#!/usr/bin/env node
/**
 * Copy existing PocketSmart data from the old (Neon) PostgreSQL into Supabase.
 *
 * Run it ONCE, after supabase/schema.sql has been executed in Supabase:
 *
 *   cd backend
 *   npm run migrate:neon -- --dry-run     # preview row counts
 *   npm run migrate:neon                  # copy
 *
 * Connection strings
 *   SOURCE_DATABASE_URL  old Neon database    (env var or --source)
 *   DATABASE_URL         new Supabase database (backend/.env, or --target)
 *
 * Safe to re-run: rows that already exist in Supabase (same primary key) are skipped, user ids
 * are preserved (history keeps pointing at the right user) and the users.id identity sequence is
 * moved past the highest copied id.  Sessions are NOT copied by default (people just sign in
 * again); --include-sessions copies them (only useful if SECRET_KEY is unchanged).
 * The source database is only ever read.
 */
import pg from 'pg';
import { loadConfig } from '../src/config.js';
import { poolOptions } from '../src/db.js';

const BATCH = 500;
const TABLES = {
  users: ['id', 'username', 'email', 'full_name', 'hashed_password', 'disabled', 'created_at'],
  recommendations: ['id', 'user_id', 'category', 'budget', 'preferences', 'result', 'timestamp'],
  sessions: ['id', 'user_id', 'login_time', 'last_activity', 'expires_at', 'revoked', 'user_data'],
};

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name) => process.argv.includes(name);
const die = (msg) => { console.error(msg); process.exit(1); };

const pool = (url) => new pg.Pool({ ...poolOptions({ databaseUrl: url, dbPoolSize: 2, dbMaxOverflow: 0, dbConnectTimeout: 15 }) });
const quote = (c) => `"${c}"`;
const count = async (db, table) => Number((await db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);

async function copyTable(source, target, table, dryRun) {
  const total = await count(source, table);
  if (dryRun || total === 0) return [total, 0];
  const cols = TABLES[table];
  const before = await count(target, table);
  const pk = quote('id');
  for (let offset = 0; offset < total; offset += BATCH) {
    const { rows } = await source.query(
      `SELECT ${cols.map(quote).join(', ')} FROM ${table} ORDER BY ${pk} LIMIT ${BATCH} OFFSET ${offset}`,
    );
    if (!rows.length) break;
    const params = [];
    const tuples = rows.map((row) => {
      const slots = cols.map((c) => { params.push(row[c]); return `$${params.length}`; });
      return `(${slots.join(', ')})`;
    });
    // users.id is an identity column: keep the original ids so history still points at the right user.
    const override = table === 'users' ? 'OVERRIDING SYSTEM VALUE ' : '';
    await target.query(
      `INSERT INTO ${table} (${cols.map(quote).join(', ')}) ${override}VALUES ${tuples.join(', ')} ON CONFLICT DO NOTHING`,
      params,
    );
  }
  return [total, (await count(target, table)) - before];
}

async function main() {
  const dryRun = flag('--dry-run');
  const sourceUrl = arg('--source') || process.env.SOURCE_DATABASE_URL || '';
  const targetUrl = arg('--target') || loadConfig({ ...process.env, ENVIRONMENT: 'development' }).databaseUrl;
  if (!sourceUrl) die('Set SOURCE_DATABASE_URL (your old Neon connection string) or pass --source.');
  if (!targetUrl) die('Set DATABASE_URL (your Supabase connection string) or pass --target.');
  if (sourceUrl.trim() === targetUrl.trim()) die('Source and target are the same database - refusing to continue.');

  const source = pool(sourceUrl);
  const target = pool(targetUrl);
  const tables = ['users', 'recommendations', ...(flag('--include-sessions') ? ['sessions'] : [])];
  try {
    console.log(dryRun ? 'DRY RUN - nothing will be written\n' : 'Copying...\n');
    for (const table of tables) { // parent table first: foreign keys need users to exist
      const [total, inserted] = await copyTable(source, target, table, dryRun);
      const note = dryRun ? '' : `, ${inserted} new, ${total - inserted} already present`;
      console.log(`  ${table.padEnd(16)} ${total} row(s) in source${note}`);
    }
    if (!dryRun) {
      await target.query(
        "SELECT setval(pg_get_serial_sequence('public.users', 'id'), COALESCE((SELECT MAX(id) FROM public.users), 1), " +
          '(SELECT MAX(id) IS NOT NULL FROM public.users))',
      );
      console.log('\nTarget now holds:');
      for (const table of tables) console.log(`  ${table.padEnd(16)} ${await count(target, table)} row(s)`);
      console.log('\nDone. Verify in Supabase -> Table Editor, then you can retire the Neon database.');
    }
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((err) => die(`Migration failed: ${err.message}`));
