/*
 * CAST extension — service worker (skeleton).
 * Foundation only. The rule engine, config poll, phone-home/check-in, and
 * update-staleness banner build on top of this (design:
 * knowledge/architecture/browser-extension-view-manager.md + extension-telemetry-and-identity.md).
 *
 * Locked decisions live in manifest.json (key→ID, update_url, permissions) —
 * do NOT change key or update_url after first publish (forces reinstall).
 */
const CONFIG_POLL_ALARM = "cast-config-poll";
const POLL_MINUTES = 30;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(CONFIG_POLL_ALARM, { periodInMinutes: POLL_MINUTES });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== CONFIG_POLL_ALARM) return;
  // TODO: fetch hosted rules JSON; on success stamp chrome.storage.local timestamp
  //       (staleness banner) and POST a check-in to the CAST web app (INIT-0009).
});
