/**
 * Settings + secret store on the shared better-sqlite3 DB (INIT-0013). Secret
 * VALUES are AES-256-GCM encrypted at rest; settings are plain JSON. Key from
 * CAST_SECRET_KEY (env) when set, else a dev keyfile.
 */
import { db, DB_KEY_FILE } from "./db";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

function getKey(): Buffer {
  const env = process.env.CAST_SECRET_KEY;
  if (env && env.length >= 16) return scryptSync(env, "cast.secret.salt.v1", 32);
  if (!existsSync(DB_KEY_FILE)) writeFileSync(DB_KEY_FILE, randomBytes(32).toString("hex"), { mode: 0o600 });
  return Buffer.from(readFileSync(DB_KEY_FILE, "utf8").trim(), "hex");
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
