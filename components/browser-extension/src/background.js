/*
 * CAST extension service worker — config poll, check-in phone-home, and the
 * update-staleness timestamp (design: browser-extension.md +
 * extension-telemetry-and-identity.md). Classic (non-module) worker.
 */
const APP_BASE = "https://cast.tritontechnical.com";
const CONFIG_URL = APP_BASE + "/api/config/public";
const CHECKIN_URL = APP_BASE + "/api/checkins";
const POLL_ALARM = "cast-poll";
const POLL_MINUTES = 30;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_MINUTES });
  poll();
});
chrome.runtime.onStartup.addListener(poll);
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === POLL_ALARM) poll();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "cast:member") {
    checkIn(msg.member).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg && msg.type === "cast:poll") {
    poll().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg && msg.type === "cast:report") {
    // TODO(INIT-0005): POST to the Teams webhook (design §8). Stubbed for now.
    console.log("[CAST] report-a-problem:", msg.detail || "");
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

async function deviceIdentity() {
  // The machine name + OS user come from managed storage, stamped by the installer
  // (Install-CAST.bat) into the browser's extension policy — a sandboxed extension
  // can't read the OS hostname/username itself.
  let deviceName = "";
  let osUser = "";
  try {
    const managed = await chrome.storage.managed.get(["deviceName", "osUser"]);
    if (managed) {
      deviceName = managed.deviceName || "";
      osUser = managed.osUser || "";
    }
  } catch (e) {
    /* no managed policy (dev / not force-installed) */
  }
  // Stable per-browser-profile id — the unique key, so multiple browsers on one
  // machine stay distinct rows that all share the same deviceName.
  const local = await chrome.storage.local.get("deviceId");
  let deviceId = local.deviceId;
  if (!deviceId) {
    deviceId = (crypto.randomUUID && crypto.randomUUID()) || "dev-" + Math.random().toString(36).slice(2, 10);
    await chrome.storage.local.set({ deviceId });
  }
  return { deviceId, deviceName, osUser };
}

// A friendly "Microsoft Edge v150.0.4078.83 (64-bit)" from high-entropy UA data,
// falling back to the raw UA string on engines without userAgentData.
async function browserLabel() {
  try {
    const uad = navigator.userAgentData;
    if (uad && uad.getHighEntropyValues) {
      const hi = await uad.getHighEntropyValues(["fullVersionList", "bitness"]);
      const list = hi.fullVersionList || uad.brands || [];
      const brand = list.find((b) => !/Chromium|Not.*Brand/i.test(b.brand)) || list[0];
      if (brand) return brand.brand + " v" + brand.version + (hi.bitness ? " (" + hi.bitness + "-bit)" : "");
    }
  } catch (e) {
    /* fall through to raw UA */
  }
  return navigator.userAgent;
}

async function poll() {
  try {
    const res = await fetch(CONFIG_URL, { cache: "no-store" });
    if (res.ok) await chrome.storage.local.set({ config: await res.json() });
  } catch (e) {
    /* offline — keep cached config; staleness reflects last successful check-in */
  }
  const { member } = await chrome.storage.local.get("member");
  await checkIn(member);
}

async function checkIn(member) {
  try {
    const { deviceId, deviceName, osUser } = await deviceIdentity();
    const { config } = await chrome.storage.local.get("config");
    const res = await fetch(CHECKIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId,
        deviceName,
        browser: await browserLabel(),
        osUser,
        cwMemberId: (member && member.memberID) || "",
        extensionVersion: chrome.runtime.getManifest().version,
        rulesVersion: (config && config.version) || "",
      }),
    });
    if (res.ok) await chrome.storage.local.set({ lastSync: Date.now() });
  } catch (e) {
    /* offline; next poll retries */
  }
}
