/**
 * Encrypted-at-rest settings + secret store (INIT-0013 core).
 *
 * A JSON file where secret VALUES are AES-256-GCM encrypted. Deliberately NOT
 * better-sqlite3 yet — that native dep is a follow-up (INIT-0008); a file store
 * keeps the unattended build green and still satisfies encryption-at-rest.
 *
 * Encryption key: derived from CAST_SECRET_KEY (env) when set; otherwise a random
 * dev keyfile under the data dir. Set CAST_SECRET_KEY in production so the key is
 * not co-located with the ciphertext.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const DATA_DIR = process.env.CAST_DATA_DIR ?? join(process.cwd(), ".data");
const STORE_FILE = join(DATA_DIR, "store.json");
const KEY_FILE = join(DATA_DIR, "secret.key");

interface EncBlob { iv: string; tag: string; data: string; }
interface Store { settings: Record<string, unknown>; secrets: Record<string, EncBlob>; }

function ensureDir() {
  mkdirSync(DATA_DIR, { recursive: true });
}

function getKey(): Buffer {
  const env = process.env.CAST_SECRET_KEY;
  if (env && env.length >= 16) return scryptSync(env, "cast.secret.salt.v1", 32);
  ensureDir();
  if (!existsSync(KEY_FILE)) writeFileSync(KEY_FILE, randomBytes(32).toString("hex"), { mode: 0o600 });
  return Buffer.from(readFileSync(KEY_FILE, "utf8").trim(), "hex");
}

function load(): Store {
  if (!existsSync(STORE_FILE)) return { settings: {}, secrets: {} };
  try {
    return JSON.parse(readFileSync(STORE_FILE, "utf8")) as Store;
  } catch {
    return { settings: {}, secrets: {} };
  }
}

function save(s: Store) {
  ensureDir();
  writeFileSync(STORE_FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
}

export function getSetting<T = unknown>(key: string): T | undefined {
  return load().settings[key] as T | undefined;
}

export function setSetting(key: string, val: unknown) {
  const s = load();
  s.settings[key] = val;
  save(s);
}

export function getSecret(name: string): string | undefined {
  const blob = load().secrets[name];
  if (!blob) return undefined;
  try {
    const d = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(blob.iv, "hex"));
    d.setAuthTag(Buffer.from(blob.tag, "hex"));
    return d.update(blob.data, "hex", "utf8") + d.final("utf8");
  } catch {
    return undefined;
  }
}

export function setSecret(name: string, plaintext: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", getKey(), iv);
  const data = c.update(plaintext, "utf8", "hex") + c.final("hex");
  const tag = c.getAuthTag().toString("hex");
  const s = load();
  s.secrets[name] = { iv: iv.toString("hex"), tag, data };
  save(s);
}
