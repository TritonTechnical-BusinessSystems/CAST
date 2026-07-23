/**
 * Settings + secret store on better-sqlite3 (INIT-0013 / INIT-0008).
 *
 * Embedded, synchronous, single-file — the right fit for this internal single-node
 * app (same choice as SOC). Secret VALUES are AES-256-GCM encrypted at rest;
 * non-secret settings are plain JSON. Public API is unchanged from the prior
 * file-store so nothing else needed to change.
 *
 * Encryption key: from CAST_SECRET_KEY (env) when set; else a random dev keyfile.
 */
import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const DATA_DIR = process.env.CAST_DATA_DIR ?? join(process.cwd(), ".data");
const DB_FILE = join(DATA_DIR, "cast.db");
const KEY_FILE = join(DATA_DIR, "secret.key");

mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS secrets (name TEXT PRIMARY KEY, iv TEXT NOT NULL, tag TEXT NOT NULL, data TEXT NOT NULL);
`);

function getKey(): Buffer {
  const env = process.env.CAST_SECRET_KEY;
  if (env && env.length >= 16) return scryptSync(env, "cast.secret.salt.v1", 32);
  if (!existsSync(KEY_FILE)) writeFileSync(KEY_FILE, randomBytes(32).toString("hex"), { mode: 0o600 });
  return Buffer.from(readFileSync(KEY_FILE, "utf8").trim(), "hex");
}

export function getSetting<T = unknown>(key: string): T | undefined {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : undefined;
}

export function setSetting(key: string, val: unknown) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    key,
    JSON.stringify(val),
  );
}

export function getSecret(name: string): string | undefined {
  const row = db.prepare("SELECT iv, tag, data FROM secrets WHERE name = ?").get(name) as
    | { iv: string; tag: string; data: string }
    | undefined;
  if (!row) return undefined;
  try {
    const d = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(row.iv, "hex"));
    d.setAuthTag(Buffer.from(row.tag, "hex"));
    return d.update(row.data, "hex", "utf8") + d.final("utf8");
  } catch {
    return undefined;
  }
}

export function setSecret(name: string, plaintext: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", getKey(), iv);
  const data = c.update(plaintext, "utf8", "hex") + c.final("hex");
  const tag = c.getAuthTag().toString("hex");
  db.prepare(
    "INSERT INTO secrets (name, iv, tag, data) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET iv=excluded.iv, tag=excluded.tag, data=excluded.data",
  ).run(name, iv.toString("hex"), tag, data);
}
