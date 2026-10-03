"""Persistence layer.

Production database: **Supabase PostgreSQL**.  Set ``DATABASE_URL`` to the
Supabase connection string (Dashboard -> Connect -> Session pooler, or the
Transaction pooler).  The schema lives in ``supabase/schema.sql`` and must be
run once in the Supabase SQL editor - it also enables Row Level Security.

SQLite remains the zero-configuration default for local development / tests
(leave ``DATABASE_URL`` empty).  Every public function keeps the same
signature on both back ends.
"""
import json
import logging
import os
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from dotenv import load_dotenv
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Float,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    create_engine,
    delete,
    event,
    false,
    func,
    inspect,
    insert,
    select,
    text,
    update,
)
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError

load_dotenv()  # so DATABASE_URL / DATABASE_PATH in .env are honoured

logger = logging.getLogger("pocketsmart.database")

DATABASE_PATH = Path(
    os.getenv("DATABASE_PATH", str(Path(__file__).with_name("pocketsmart.sqlite3")))
)

metadata = MetaData()

users = Table(
    "users",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("username", String(64), nullable=False),
    Column("email", String(254)),
    Column("full_name", String(120)),
    Column("hashed_password", String(255), nullable=False),
    Column("disabled", Boolean, nullable=False, default=False, server_default=false()),
    Column("created_at", String(40), nullable=False),
    CheckConstraint("length(trim(username)) > 0", name="users_username_not_blank"),
    CheckConstraint("email IS NULL OR length(trim(email)) > 0", name="users_email_not_blank"),
)
Index("uq_users_username_lower", func.lower(users.c.username), unique=True)
Index("uq_users_email_lower", func.lower(users.c.email), unique=True)

recommendations = Table(
    "recommendations",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    Column("category", String(20), nullable=False),
    Column("budget", Float, nullable=False),
    Column("preferences", Text, nullable=False),
    Column("result", Text, nullable=False),
    Column("timestamp", String(40), nullable=False),
    CheckConstraint("category IN ('home', 'party', 'jewelry')", name="recommendations_category_valid"),
    CheckConstraint("budget > 0", name="recommendations_budget_positive"),
)
Index("recommendations_user_time", recommendations.c.user_id, recommendations.c.timestamp)

# One row per issued access token (keyed by the JWT "jti" claim).  Gives us
# server-side sessions, token revocation on logout and inactivity cleanup.
sessions = Table(
    "sessions",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    Column("login_time", String(40), nullable=False),
    Column("last_activity", String(40), nullable=False),
    Column("expires_at", String(40), nullable=False),
    Column("revoked", Boolean, nullable=False, default=False, server_default=false()),
    Column("user_data", Text, nullable=False, default="{}", server_default=text("'{}'")),
)
Index("sessions_user", sessions.c.user_id)
Index("sessions_expires_at", sessions.c.expires_at)
Index("sessions_last_activity", sessions.c.last_activity)

_engine: Engine | None = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name, "").strip().lower()
    if not value:
        return default
    return value in {"1", "true", "yes", "on"}


def _is_supabase_host(host: str) -> bool:
    host = (host or "").lower()
    return host.endswith(".supabase.co") or host.endswith(".supabase.com")


def _is_pooler_host(host: str) -> bool:
    return (host or "").lower().endswith(".pooler.supabase.com")


def database_url() -> str:
    """Return the SQLAlchemy URL, normalising Supabase/Render/Heroku style URLs.

    * ``postgres://`` / ``postgresql://`` are mapped to the psycopg 3 driver.
    * Supabase hosts always get ``sslmode=require`` (Supabase rejects plain TCP).
    """
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{DATABASE_PATH.as_posix()}"
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    if url.startswith("postgresql+psycopg://"):
        parts = urlsplit(url)
        if _is_supabase_host(parts.hostname or ""):
            query = dict(parse_qsl(parts.query, keep_blank_values=True))
            query.setdefault("sslmode", "require")
            url = urlunsplit(parts._replace(query=urlencode(query)))
    return url


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        url = database_url()
        if url.startswith("sqlite"):
            _engine = create_engine(url, connect_args={"timeout": 10})

            @event.listens_for(_engine, "connect")
            def _enable_foreign_keys(dbapi_connection, _record):  # pragma: no cover
                cursor = dbapi_connection.cursor()
                cursor.execute("PRAGMA foreign_keys = ON")
                cursor.close()
        else:
            host = urlsplit(url).hostname or ""
            port = urlsplit(url).port
            connect_args: dict[str, Any] = {"connect_timeout": int(os.getenv("DB_CONNECT_TIMEOUT", "10"))}
            if _is_pooler_host(host) or port == 6543:
                # Supabase's Supavisor/pgbouncer pooler (transaction mode) cannot
                # keep server-side prepared statements between requests; psycopg 3
                # would otherwise create them automatically and fail with
                # "prepared statement ... does not exist".
                connect_args["prepare_threshold"] = None
            _engine = create_engine(
                url,
                connect_args=connect_args,
                pool_pre_ping=True,
                pool_recycle=300,
                pool_size=int(os.getenv("DB_POOL_SIZE", "5")),
                max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "5")),
            )
    return _engine


def dispose_engine() -> None:
    global _engine
    if _engine is not None:
        _engine.dispose()
        _engine = None


def backend_name() -> str:
    return get_engine().dialect.name


@contextmanager
def database_connection():
    """Transactional connection: commits on success, rolls back on error."""
    with get_engine().begin() as connection:
        yield connection


def _warn_if_rls_disabled(engine: Engine) -> None:
    """Log (never raise) if any app table is exposed without Row Level Security."""
    from sqlalchemy import bindparam

    query = text(
        "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
        "WHERE n.nspname = 'public' AND c.relname IN :names AND NOT c.relrowsecurity"
    ).bindparams(bindparam("names", expanding=True))
    try:
        with engine.connect() as connection:
            unprotected = [row[0] for row in connection.execute(query, {"names": list(metadata.tables)})]
    except Exception:  # pragma: no cover - advisory check only
        logger.debug("Could not check Row Level Security status", exc_info=True)
        return
    if unprotected:
        logger.warning(
            "Row Level Security is OFF for table(s) %s. Run supabase/schema.sql so the "
            "Supabase Data API (publishable key) cannot read them.",
            ", ".join(sorted(unprotected)),
        )


def initialize_database() -> None:
    """Prepare the database at start-up.

    * SQLite (local/tests): create the tables automatically.
    * PostgreSQL / Supabase: the schema is managed by ``supabase/schema.sql``.
      We only *verify* it, because ``create_all()`` would create tables without
      Row Level Security, leaving ``users.hashed_password`` readable through the
      Supabase Data API.  Set ``DB_AUTO_CREATE=true`` to override (not advised).
    """
    engine = get_engine()
    if engine.dialect.name != "postgresql":
        metadata.create_all(engine)
        return
    try:
        existing = set(inspect(engine).get_table_names(schema="public"))
    except OperationalError as exc:
        raise RuntimeError(
            "Cannot connect to the PostgreSQL database. Check DATABASE_URL: use the Supabase "
            "*Session pooler* string (Dashboard -> Connect), URL-encode special characters in "
            "the password, and note that the direct db.<ref>.supabase.co host is IPv6-only."
        ) from exc
    missing = sorted(set(metadata.tables) - existing)
    if missing:
        if _env_flag("DB_AUTO_CREATE"):
            metadata.create_all(engine)
        else:
            raise RuntimeError(
                f"Database table(s) missing: {', '.join(missing)}. Open the Supabase SQL editor "
                "and run supabase/schema.sql once, then restart the app."
            )
    _warn_if_rls_disabled(engine)


def ping() -> bool:
    try:
        with get_engine().connect() as connection:
            connection.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


# --------------------------------------------------------------------- users
def create_user(
    username: str,
    email: str | None,
    full_name: str | None,
    hashed_password: str,
) -> int:
    """Insert a user. Raises ``sqlalchemy.exc.IntegrityError`` on duplicates."""
    with database_connection() as connection:
        result = connection.execute(
            insert(users).values(
                username=username,
                email=email or None,
                full_name=full_name or None,
                hashed_password=hashed_password,
                disabled=False,
                created_at=_now(),
            )
        )
        return int(result.inserted_primary_key[0])


def get_user_by_username(username: str) -> dict[str, Any] | None:
    with database_connection() as connection:
        row = connection.execute(
            select(users).where(func.lower(users.c.username) == username.lower())
        ).first()
    return dict(row._mapping) if row else None


def get_user_by_id(user_id: int) -> dict[str, Any] | None:
    with database_connection() as connection:
        row = connection.execute(select(users).where(users.c.id == user_id)).first()
    return dict(row._mapping) if row else None


# ----------------------------------------------------------- recommendations
def save_recommendation(
    recommendation_id: str,
    user_id: int,
    category: str,
    budget: float,
    preferences: dict[str, Any],
    result: str,
    timestamp: str,
) -> None:
    with database_connection() as connection:
        connection.execute(
            insert(recommendations).values(
                id=recommendation_id,
                user_id=user_id,
                category=category,
                budget=budget,
                preferences=json.dumps(preferences, ensure_ascii=False),
                result=result,
                timestamp=timestamp,
            )
        )


def _recommendation_entry(row) -> dict[str, Any]:
    entry = dict(row._mapping)
    entry["preferences"] = json.loads(entry["preferences"])
    return entry


def list_recommendations(user_id: int) -> list[dict[str, Any]]:
    """All of a user's plans, newest first."""
    with database_connection() as connection:
        rows = connection.execute(
            select(recommendations)
            .where(recommendations.c.user_id == user_id)
            .order_by(recommendations.c.timestamp.desc(), recommendations.c.id.desc())
        ).all()
    return [_recommendation_entry(row) for row in rows]


def get_recommendation(user_id: int, recommendation_id: str) -> dict[str, Any] | None:
    """One plan, only if it belongs to ``user_id``."""
    with database_connection() as connection:
        row = connection.execute(
            select(recommendations).where(
                recommendations.c.id == recommendation_id,
                recommendations.c.user_id == user_id,
            )
        ).first()
    return _recommendation_entry(row) if row else None


def clear_recommendations(user_id: int) -> int:
    with database_connection() as connection:
        result = connection.execute(
            delete(recommendations).where(recommendations.c.user_id == user_id)
        )
        return int(result.rowcount)


# ------------------------------------------------------------------ sessions
def create_session(session_id: str, user_id: int, expires_at: datetime) -> None:
    now = _now()
    with database_connection() as connection:
        connection.execute(
            insert(sessions).values(
                id=session_id,
                user_id=user_id,
                login_time=now,
                last_activity=now,
                expires_at=expires_at.isoformat(),
                revoked=False,
                user_data="{}",
            )
        )


def get_session(session_id: str) -> dict[str, Any] | None:
    with database_connection() as connection:
        row = connection.execute(select(sessions).where(sessions.c.id == session_id)).first()
    if not row:
        return None
    session = dict(row._mapping)
    try:
        session["user_data"] = json.loads(session["user_data"] or "{}")
    except json.JSONDecodeError:
        session["user_data"] = {}
    return session


def touch_session(session_id: str, expires_at: datetime | None = None) -> None:
    values: dict[str, Any] = {"last_activity": _now()}
    if expires_at is not None:
        values["expires_at"] = expires_at.isoformat()
    with database_connection() as connection:
        connection.execute(update(sessions).where(sessions.c.id == session_id).values(**values))


def update_session_data(session_id: str, data: dict[str, Any]) -> dict[str, Any]:
    session = get_session(session_id)
    merged = {**(session["user_data"] if session else {}), **data}
    with database_connection() as connection:
        connection.execute(
            update(sessions)
            .where(sessions.c.id == session_id)
            .values(user_data=json.dumps(merged, ensure_ascii=False), last_activity=_now())
        )
    return merged


def revoke_session(session_id: str) -> None:
    with database_connection() as connection:
        connection.execute(update(sessions).where(sessions.c.id == session_id).values(revoked=True))


def cleanup_sessions(idle_minutes: int = 30) -> int:
    """Delete expired, revoked-and-expired and idle sessions."""
    now = datetime.now(timezone.utc)
    idle_cutoff = (now - timedelta(minutes=idle_minutes)).isoformat()
    with database_connection() as connection:
        result = connection.execute(
            delete(sessions).where(
                (sessions.c.expires_at < now.isoformat()) | (sessions.c.last_activity < idle_cutoff)
            )
        )
        return int(result.rowcount)
