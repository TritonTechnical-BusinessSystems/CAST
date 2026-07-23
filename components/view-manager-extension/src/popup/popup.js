/* CAST popup — shows the detected user (name/position/department), version, and
   last-sync; offers a department switch when enabled, and report-a-problem. */
function ago(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  return Math.floor(h / 24) + "d ago";
}

async function main() {
  const { member, config, lastSync, deptOverride } = await chrome.storage.local.get([
    "member",
    "config",
    "lastSync",
    "deptOverride",
  ]);

  document.getElementById("ver").textContent = chrome.runtime.getManifest().version;
  document.getElementById("sync").textContent = lastSync ? ago(lastSync) : "never";

  document.getElementById("report").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.sendMessage({ type: "cast:report" });
    window.close();
  });

  if (!member || !member.memberID) {
    document.getElementById("unknown").hidden = false;
    return;
  }

  document.getElementById("profile").hidden = false;
  document.getElementById("name").textContent = `${member.fullName || "—"} (${member.memberID})`;
  document.getElementById("role").textContent = member.roleName || "—";

  // Department: a dropdown when the app enables switching + supplies a list; else text.
  const depts = config && config.departments ? Object.keys(config.departments) : [];
  const canSwitch = !!(config && config.allowDepartmentSwitch) && depts.length > 0;
  const current = deptOverride || member.department || "—";

  if (canSwitch) {
    const sel = document.getElementById("deptSel");
    sel.hidden = false;
    document.getElementById("dept").hidden = true;
    for (const d of depts) {
      const o = document.createElement("option");
      o.value = d;
      o.textContent = d;
      if (d === current) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => chrome.storage.local.set({ deptOverride: sel.value }));
  } else {
    document.getElementById("dept").textContent = current;
  }
}

main();
