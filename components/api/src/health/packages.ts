/**
 * Package manifest + vulnerability check for System Health (INIT-0016), mirroring
 * LC's OSV.dev scanner. Reads CAST's declared dependencies, queries OSV.dev per
 * package (npm ecosystem), and caches results 24h in the settings store.
 */
import { readFileSync } from "fs";
import { join, resolve } from "path";
import { getSetting, setSetting } from "../store/secretStore";

type Layer = "backend" | "frontend" | "build";
interface Pkg { name: string; version: string; layer: Layer; }
export interface PkgResult { name: string; version: string; layer: Layer; vulnCount: number; severity: string; osvUrl: string; }

interface PkgJson { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; }
interface OsvVuln { database_specific?: { severity?: string } }
interface OsvResp { vulns?: OsvVuln[] }

const REPO_ROOT = resolve(process.cwd(), "..", ".."); // container cwd = /app/components/api

function cleanVersion(range: string): string {
  return range.replace(/^[^\d]*/, "");
}

function readDeps(relPath: string, layer: Layer, devAsBuild = false): Pkg[] {
  try {
    const j = JSON.parse(readFileSync(join(REPO_ROOT, relPath), "utf8")) as PkgJson;
    const out: Pkg[] = [];
    for (const [name, ver] of Object.entries(j.dependencies ?? {})) {
      if (ver.startsWith("workspace:")) continue;
      out.push({ name, version: cleanVersion(ver), layer });
    }
    if (devAsBuild) {
      for (const [name, ver] of Object.entries(j.devDependencies ?? {})) {
        if (ver.startsWith("workspace:") || name.startsWith("@types/")) continue;
        out.push({ name, version: cleanVersion(ver), layer: "build" });
      }
    }
    return out;
  } catch {
    return [];
  }
}

const SEV_RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MODERATE: 2, MEDIUM: 2, LOW: 1 };
function worstSeverity(vulns: OsvVuln[]): string {
  let best = "";
  let bestRank = 0;
  for (const v of vulns) {
    const s = String(v.database_specific?.severity ?? "").toUpperCase();
    if (SEV_RANK[s] && SEV_RANK[s] > bestRank) {
      bestRank = SEV_RANK[s];
      best = s;
    }
  }
  return best || (vulns.length ? "UNKNOWN" : "");
}

async function osvCheck(name: string, version: string): Promise<{ vulnCount: number; severity: string }> {
  const cacheKey = `osv:${name}@${version}`;
  const cached = getSetting<{ t: number; vulnCount: number; severity: string }>(cacheKey);
  if (cached && Date.now() - cached.t < 24 * 3600 * 1000) return { vulnCount: cached.vulnCount, severity: cached.severity };
  try {
    const res = await fetch("https://api.osv.dev/v1/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version, package: { name, ecosystem: "npm" } }),
    });
    const data = res.ok ? ((await res.json()) as OsvResp) : {};
    const vulns = data.vulns ?? [];
    const result = { vulnCount: vulns.length, severity: worstSeverity(vulns) };
    setSetting(cacheKey, { t: Date.now(), ...result });
    return result;
  } catch {
    return { vulnCount: 0, severity: "unknown" };
  }
}

export async function getPackageManifest(): Promise<PkgResult[]> {
  const pkgs = [
    ...readDeps("components/api/package.json", "backend"),
    ...readDeps("components/web/package.json", "frontend"),
    ...readDeps("package.json", "build", true),
  ];
  const seen = new Set<string>();
  const unique = pkgs.filter((p) => (seen.has(p.name) ? false : seen.add(p.name)));

  const results = await Promise.all(
    unique.map(async (p) => {
      const v = await osvCheck(p.name, p.version);
      return { ...p, vulnCount: v.vulnCount, severity: v.severity, osvUrl: `https://osv.dev/list?q=${encodeURIComponent(p.name)}` };
    }),
  );
  return results.sort((a, b) => b.vulnCount - a.vulnCount || a.name.localeCompare(b.name));
}
