"""Password authentication and revocable browser sessions."""

import logging
from datetime import timedelta
from hashlib import sha256
from pathlib import Path
from secrets import token_urlsafe
from threading import BoundedSemaphore
from typing import Annotated, Literal

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import APIRouter, HTTPException, Request, Response
from psycopg import Error
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool
from pydantic import BaseModel, Field, SecretStr

router = APIRouter(prefix="/api")
COOKIE = "naanala_session"
SESSION_AGE = timedelta(days=14)
PASSWORDS = PasswordHasher()
PASSWORD_WORKERS = BoundedSemaphore(2)
UNKNOWN_PASSWORD_HASH = PASSWORDS.hash(token_urlsafe(32))
SCHEMA = Path(__file__).resolve().parents[1] / "database" / "001-auth.sql"
SETTINGS_SCHEMA = SCHEMA.with_name("002-settings.sql")
logger = logging.getLogger("uvicorn.error")


class Credentials(BaseModel):
    username: Annotated[str, Field(pattern=r"^[A-Za-z0-9_]{3,40}$")]
    password: Annotated[SecretStr, Field(min_length=1, max_length=128)]


class Preferences(BaseModel, extra="forbid"):
    name: Annotated[str, Field(min_length=1, max_length=60)] | None = None
    theme: Literal["system", "light", "dark"] | None = None
    prefersColorContrast: bool | None = None
    pauseAfterCorrect: bool | None = None
    pauseAfterIncorrect: bool | None = None
    showPitchGraph: bool | None = None


def open_database(url: str) -> ConnectionPool:
    pool = ConnectionPool(url, min_size=1, max_size=4, kwargs={"row_factory": dict_row}, open=False)
    try:
        logger.info("Waiting for the authentication database.")
        pool.open(wait=True, timeout=20)
        with pool.connection() as conn:
            conn.execute("SET LOCAL lock_timeout = '10s'")
            conn.execute("SELECT pg_advisory_xact_lock(712758251)")
            tables = conn.execute("""
                SELECT to_regclass('auth.accounts') IS NOT NULL
                   AND to_regclass('auth.sessions') IS NOT NULL AS ready
            """).fetchone()
            if not tables["ready"]:
                logger.info("Creating missing authentication tables.")
                conn.execute(SCHEMA.read_text(encoding="utf-8"))
            settings = conn.execute("SELECT to_regclass('auth.account_settings') AS table_name").fetchone()
            if settings["table_name"] is None:
                logger.info("Creating account settings table.")
                conn.execute(SETTINGS_SCHEMA.read_text(encoding="utf-8"))
            conn.execute("SELECT 1 FROM auth.accounts, auth.sessions, auth.account_settings LIMIT 0")
        logger.info("Authentication database is ready.")
    except BaseException:
        pool.close()
        raise
    return pool


def check_database(pool: ConnectionPool) -> bool:
    try:
        with pool.connection(timeout=2) as conn:
            conn.execute("SELECT 1")
    except Error:
        return False
    return True


def database(request: Request) -> ConnectionPool:
    pool = request.app.state.auth_db
    if pool is None:
        raise HTTPException(503, "Account sign-in is unavailable.")
    return pool


def session_hash(request: Request) -> bytes | None:
    token = request.cookies.get(COOKIE, "")
    if len(token) != 43 or not token.isascii():
        return None
    return sha256(token.encode()).digest()


def create_session(conn, account_id, previous_hash: bytes | None) -> str:
    if previous_hash:
        conn.execute("DELETE FROM auth.sessions WHERE token_hash = %s", (previous_hash,))
    conn.execute("DELETE FROM auth.sessions WHERE expires_at <= now()")
    token = token_urlsafe(32)
    conn.execute(
        "INSERT INTO auth.sessions (token_hash, account_id, expires_at) VALUES (%s, %s, now() + %s)",
        (sha256(token.encode()).digest(), account_id, SESSION_AGE),
    )
    return token


def set_session(request: Request, response: Response, token: str) -> None:
    response.set_cookie(
        COOKIE, token, max_age=int(SESSION_AGE.total_seconds()), httponly=True,
        samesite="lax", secure=request.app.state.secure_auth_cookie,
    )


def require_json(request: Request) -> None:
    if request.headers.get("content-type", "").split(";", 1)[0].lower() != "application/json":
        raise HTTPException(415, "Use application/json.")


def process_password(password: str, encoded: str | None = None) -> str | bool:
    # Argon2 consumes substantial memory for each concurrent request.
    if not PASSWORD_WORKERS.acquire(blocking=False):
        raise HTTPException(429, "The sign-in service is busy. Try again shortly.")
    try:
        if encoded is None:
            return PASSWORDS.hash(password)
        return PASSWORDS.verify(encoded, password)
    finally:
        PASSWORD_WORKERS.release()


@router.post("/auth/register", status_code=201)
def register(credentials: Credentials, request: Request, response: Response):
    require_json(request)
    pool = database(request)
    password = credentials.password.get_secret_value()
    if len(password) < 12:
        raise HTTPException(422, "Use at least 12 characters for your password.")
    password_hash = process_password(password)
    with pool.connection() as conn:
        account = conn.execute("""
            INSERT INTO auth.accounts (username, password_hash) VALUES (%s, %s)
            ON CONFLICT DO NOTHING RETURNING id, username
        """, (credentials.username, password_hash)).fetchone()
        if account is None:
            raise HTTPException(409, "That username is already in use.")
        token = create_session(conn, account["id"], session_hash(request))
    set_session(request, response, token)
    return account


@router.post("/auth/login")
def login(credentials: Credentials, request: Request, response: Response):
    require_json(request)
    pool = database(request)
    with pool.connection() as conn:
        account = conn.execute(
            """SELECT accounts.id, username, password_hash, account_settings.preferences AS settings
               FROM auth.accounts
               LEFT JOIN auth.account_settings ON account_settings.account_id = accounts.id
               WHERE lower(username) = lower(%s)""",
            (credentials.username,),
        ).fetchone()
    try:
        process_password(credentials.password.get_secret_value(),
                         account["password_hash"] if account else UNKNOWN_PASSWORD_HASH)
    except VerifyMismatchError:
        raise HTTPException(401, "Incorrect username or password.") from None
    if account is None:
        raise HTTPException(401, "Incorrect username or password.")
    with pool.connection() as conn:
        token = create_session(conn, account["id"], session_hash(request))
    del account["password_hash"]
    set_session(request, response, token)
    return account


@router.get("/me")
def me(request: Request):
    if not session_hash(request) or request.app.state.auth_db is None:
        raise HTTPException(401, "Sign in to continue.")
    with database(request).connection() as conn:
        return require_account(conn, request)


def require_account(conn, request: Request):
    token_hash = session_hash(request)
    if token_hash:
        account = conn.execute("""
            SELECT accounts.id, accounts.username, account_settings.preferences AS settings
            FROM auth.sessions JOIN auth.accounts ON accounts.id = sessions.account_id
            LEFT JOIN auth.account_settings ON account_settings.account_id = accounts.id
            WHERE sessions.token_hash = %s AND sessions.expires_at > now()
        """, (token_hash,)).fetchone()
        if account is not None:
            return account
    raise HTTPException(401, "Sign in to continue.")


@router.patch("/me/settings")
def save_settings(preferences: Preferences, request: Request, initialize: bool = False):
    require_json(request)
    changes = preferences.model_dump(exclude_none=True)
    if "name" in changes:
        changes["name"] = changes["name"].strip()
        if not changes["name"]:
            raise HTTPException(422, "Enter a display name.")
    with database(request).connection() as conn:
        account = require_account(conn, request)
        expected_account = request.headers.get("X-Account-ID")
        if expected_account and expected_account != str(account["id"]):
            raise HTTPException(409, "The signed-in account changed. Reload and try again.")
        if initialize:
            conn.execute("""
                INSERT INTO auth.account_settings (account_id, preferences) VALUES (%s, %s)
                ON CONFLICT (account_id) DO NOTHING
            """, (account["id"], Jsonb(changes)))
            return conn.execute(
                "SELECT preferences FROM auth.account_settings WHERE account_id = %s", (account["id"],),
            ).fetchone()["preferences"]
        return conn.execute("""
            INSERT INTO auth.account_settings (account_id, preferences) VALUES (%s, %s)
            ON CONFLICT (account_id) DO UPDATE
            SET preferences = account_settings.preferences || EXCLUDED.preferences
            RETURNING preferences
        """, (account["id"], Jsonb(changes))).fetchone()["preferences"]


@router.post("/auth/logout", status_code=204)
def logout(request: Request, response: Response):
    require_json(request)
    token_hash = session_hash(request)
    if token_hash:
        with database(request).connection() as conn:
            conn.execute("DELETE FROM auth.sessions WHERE token_hash = %s", (token_hash,))
    response.delete_cookie(COOKIE, httponly=True, samesite="lax",
                           secure=request.app.state.secure_auth_cookie)
