/**
 * Shared better-sqlite3 database (INIT-0013 / INIT-0008). One connection, opened
 * at import, with the schema created idempotently. Used by the secret/settings
 * store and local break-glass accounts.
 */
import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { join } from "path";

const DATA_DIR = process.env.CAST_DATA_DIR ?? join(process.cwd(), ".data");
mkdirSync(DATA_DIR, { recursive: true });

/** Path for the AES key file fallback (used when CAST_SECRET_KEY is unset). */
export const DB_KEY_FILE = join(DATA_DIR, "secret.key");

export const db: Database.Database = new Database(join(DATA_DIR, "cast.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS secrets  (name TEXT PRIMARY KEY, iv TEXT NOT NULL, tag TEXT NOT NULL, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS local_accounts (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
`);
