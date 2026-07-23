/**
 * Extension check-in catalog (INIT-0009). Each installed extension instance
 * phones home here; the catalog is grouped by CW member (the source of truth).
 *
 * POST is unauthenticated by design — it's the extension's own code posting from
 * inside the VPN-gated network (it has no CAST session). GET is auth-gated.
 */
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { db } from "../store/db";
import { listMembers } from "../connectwise/manageClient";

interface Row {
  device_id: string;
  browser: string;
  os_user: string;
  cw_member_id: string;
  extension_version: string;
  rules_version: string;
  last_check_in: string;
}

const router = Router();

router.post("/", (req, res) => {
  const b = (req.body ?? {}) as Record<string, string>;
  if (!b.deviceId) return res.status(400).json({ error: "deviceId required" });
  db.prepare(
    `INSERT INTO checkins (device_id, browser, os_user, cw_member_id, extension_version, rules_version, last_check_in)
     VALUES (@device_id, @browser, @os_user, @cw_member_id, @extension_version, @rules_version, @ts)
     ON CONFLICT(device_id) DO UPDATE SET browser=excluded.browser, os_user=excluded.os_user,
       cw_member_id=excluded.cw_member_id, extension_version=excluded.extension_version,
       rules_version=excluded.rules_version, last_check_in=excluded.last_check_in`,
  ).run({
    device_id: b.deviceId,
    browser: b.browser ?? "",
    os_user: b.osUser ?? "",
    cw_member_id: b.cwMemberId ?? "",
    extension_version: b.extensionVersion ?? "",
    rules_version: b.rulesVersion ?? "",
    ts: new Date().toISOString(),
  });
  res.json({ ok: true });
});

router.get("/", requireAuth, async (_req, res) => {
  const rows = db.prepare("SELECT * FROM checkins ORDER BY last_check_in DESC").all() as Row[];
  const toInstance = (r: Row) => ({
    deviceId: r.device_id,
    browser: r.browser,
    osUser: r.os_user,
    cwMemberId: r.cw_member_id,
    extensionVersion: r.extension_version,
    rulesVersion: r.rules_version,
    lastCheckIn: r.last_check_in,
  });

  // Group each member's check-ins (one row per device/browser pair).
  const byMember = new Map<string, Row[]>();
  for (const r of rows) {
    const key = (r.cw_member_id || "").toLowerCase();
    const arr = byMember.get(key) ?? [];
    arr.push(r);
    byMember.set(key, arr);
  }
  const entryFor = (identifier: string, name: string) => {
    const devices = (byMember.get(identifier.toLowerCase()) ?? []).map(toInstance);
    // Most recent sync across this member's devices (null if never checked in).
    const lastCheckIn = devices.reduce<string | null>(
      (max, d) => (d.lastCheckIn && (!max || d.lastCheckIn > max) ? d.lastCheckIn : max),
      null,
    );
    return { identifier, name, devices, lastCheckIn };
  };

  let members: { identifier: string; name: string }[] = [];
  let membersError: string | null = null;
  try {
    members = await listMembers();
  } catch (e) {
    membersError = e instanceof Error ? e.message : "CW member list unavailable";
  }

  let memberEntries: ReturnType<typeof entryFor>[];
  let orphans: ReturnType<typeof toInstance>[];
  if (members.length > 0) {
    // Every active member — including those with zero devices (not installed).
    memberEntries = members.map((m) => entryFor(m.identifier, m.name));
    const known = new Set(members.map((m) => m.identifier.toLowerCase()));
    orphans = rows.filter((r) => !known.has((r.cw_member_id || "").toLowerCase())).map(toInstance);
  } else {
    // CW list unavailable: fall back to grouping by reported member id so the
    // page still works, minus the "not installed" members we can't enumerate.
    const seen = new Map<string, string>(); // lc id -> original-cased id
    for (const r of rows) {
      const id = r.cw_member_id || "(unknown)";
      if (!seen.has(id.toLowerCase())) seen.set(id.toLowerCase(), id);
    }
    memberEntries = [...seen.values()].map((id) => entryFor(id, id));
    orphans = [];
  }

  res.json({
    members: memberEntries,
    orphans,
    membersError,
    totalMembers: memberEntries.length,
    totalDevices: rows.length,
  });
});

export default router;
