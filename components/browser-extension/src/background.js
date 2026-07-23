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
  try {
    const managed = await chrome.storage.managed.get(["deviceId", "osUser"]);
    if (managed && managed.deviceId) return { deviceId: managed.deviceId, osUser: managed.osUser || "" };
  } catch (e) {
    /* no managed policy (dev) */
  }
  const local = await chrome.storage.local.get("deviceId");
  let id = local.deviceId;
  if (!id) {
    id = "dev-" + Math.random().toString(36).slice(2, 10);
    await chrome.storage.local.set({ deviceId: id });
  }
  return { deviceId: id, osUser: "" };
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
    const { deviceId, osUser } = await deviceIdentity();
    const { config } = await chrome.storage.local.get("config");
    const res = await fetch(CHECKIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId,
        browser: navigator.userAgent,
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
