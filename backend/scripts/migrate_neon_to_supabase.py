"""Copy existing PocketSmart data from the old (Neon) PostgreSQL into Supabase.

Run it ONCE, after ``supabase/schema.sql`` has been executed in Supabase:

    cd backend
    python scripts/migrate_neon_to_supabase.py --dry-run     # preview row counts
    python scripts/migrate_neon_to_supabase.py               # copy

Connection strings
    SOURCE_DATABASE_URL  old Neon database   (env var or --source)
    DATABASE_URL         new Supabase database (from backend/.env, or --target)

Safe to re-run: rows that already exist in Supabase (same primary key) are
skipped, user ids are preserved (so history keeps pointing at the right user),
and the ``users.id`` identity sequence is moved past the highest copied id.

Sessions are NOT copied by default: they are short-lived login records, and
users simply sign in again.  Pass ``--include-sessions`` to copy them too (this
only keeps people logged in if SECRET_KEY is unchanged).  The source database
is only ever read.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv  # noqa: E402
from sqlalchemy import create_engine, func, select, text  # noqa: E402
from sqlalchemy.dialects.postgresql import insert as pg_insert  # noqa: E402

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

import database  # noqa: E402  (after sys.path / dotenv set-up)

BATCH = 500


def _engine(url: str):
    """Build an engine from a raw URL using the same normalisation as the app."""
    previous = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = url
    try:
        resolved = database.database_url()
    finally:
        if previous is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = previous
    if not resolved.startswith("postgresql"):
        sys.exit("Both source and target must be PostgreSQL connection strings.")
    connect_args = {"connect_timeout": 15}
    if ".pooler.supabase.com" in resolved or ":6543/" in resolved:
        connect_args["prepare_threshold"] = None
    return create_engine(resolved, connect_args=connect_args, pool_pre_ping=True)


def _count(engine, table) -> int:
    with engine.connect() as connection:
        return connection.execute(select(func.count()).select_from(table)).scalar_one()


def _copy_table(source, target, table, *, dry_run: bool) -> tuple[int, int]:
    """Return (rows in source, rows newly inserted into target)."""
    total = _count(source, table)
    if dry_run or total == 0:
        return total, 0
    before = _count(target, table)
    with source.connect() as src, target.begin() as dst:
        result = src.execution_options(stream_results=True).execute(select(table).order_by(*table.primary_key.columns))
        while True:
            rows = result.fetchmany(BATCH)
            if not rows:
                break
            # rowcount is unreliable for batched INSERTs, so counts are taken before/after.
            dst.execute(pg_insert(table).values([dict(row._mapping) for row in rows]).on_conflict_do_nothing())
    return total, _count(target, table) - before


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", default=os.getenv("SOURCE_DATABASE_URL", ""), help="old Neon URL")
    parser.add_argument("--target", default=os.getenv("DATABASE_URL", ""), help="new Supabase URL")
    parser.add_argument("--include-sessions", action="store_true")
    parser.add_argument("--dry-run", action="store_true", help="only count rows, write nothing")
    args = parser.parse_args()

    if not args.source:
        sys.exit("Set SOURCE_DATABASE_URL (your old Neon connection string) or pass --source.")
    if not args.target:
        sys.exit("Set DATABASE_URL (your Supabase connection string) or pass --target.")
    if args.source.strip() == args.target.strip():
        sys.exit("Source and target are the same database - refusing to continue.")

    source, target = _engine(args.source), _engine(args.target)

    tables = [database.users, database.recommendations]
    if args.include_sessions:
        tables.append(database.sessions)

    print("DRY RUN - nothing will be written\n" if args.dry_run else "Copying...\n")
    for table in tables:  # parent table first: foreign keys need users to exist
        total, inserted = _copy_table(source, target, table, dry_run=args.dry_run)
        note = "" if args.dry_run else f", {inserted} new, {total - inserted} already present"
        print(f"  {table.name:16} {total} row(s) in source{note}")

    if not args.dry_run:
        with target.begin() as dst:
            dst.execute(text(
                "SELECT setval(pg_get_serial_sequence('public.users', 'id'), "
                "COALESCE((SELECT MAX(id) FROM public.users), 1), "
                "(SELECT MAX(id) IS NOT NULL FROM public.users))"
            ))
        with target.connect() as dst:
            print("\nTarget now holds:")
            for table in tables:
                count = dst.execute(select(func.count()).select_from(table)).scalar_one()
                print(f"  {table.name:16} {count} row(s)")
        print("\nDone. Verify in Supabase -> Table Editor, then you can retire the Neon database.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
