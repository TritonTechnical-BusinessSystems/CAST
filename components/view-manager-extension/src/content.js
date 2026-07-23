/*
 * CAST content script — runs on ConnectWise (*.myconnectwise.net). Detects the
 * member's role/department from the session (design §3), applies the role/
 * department view rules (§5), and re-applies on SPA route changes. Reads the
 * cached config the service worker fetches; targets stable `pod_*` classes only.
 */
(function () {
  "use strict";

  // ---- Role/department detection (design §3) ----
  function detectMember() {
    try {
      const raw = localStorage.getItem("session/MemberWithSecurity");
      if (raw) {
        const m = JSON.parse(JSON.parse(raw).data).member;
        return {
          memberID: m.memberID,
          fullName: m.fullName || [m.firstName, m.lastName].filter(Boolean).join(" "),
          firstName: m.firstName,
          lastName: m.lastName,
          roleName: m.roleName,
          department: (m.defaultGroup && m.defaultGroup.description) || "",
          location: (m.defaultLocation && m.defaultLocation.description) || "",
          isAdmin: !!m.isAdmin,
        };
      }
    } catch (e) {
      /* fall through */
    }
    try {
      if (window.mng_profile && window.mng_profile.securityRole) {
        return { memberID: "", fullName: "", roleName: window.mng_profile.securityRole, department: "" };
      }
    } catch (e) {}
    return null;
  }

  const member = detectMember();
  if (member) {
    chrome.storage.local.set({ member });
    try {
      chrome.runtime.sendMessage({ type: "cast:member", member });
    } catch (e) {}
  }

  // ---- Rule engine (design §5) ----
  // Config shape (@cast/config-schema): { version, departments:{}, roles:{ <role>: {hide,show,order,move} } }
  function rulesFor(role, config) {
    const out = { hide: [], show: [], order: [], move: [] };
    const rc = config && config.roles && role ? config.roles[role] : null;
    if (rc) {
      if (rc.hide) out.hide.push(...rc.hide);
      if (rc.show) out.show.push(...rc.show);
      if (rc.order) out.order.push(...rc.order);
      if (rc.move) out.move.push(...rc.move);
    }
    return out;
  }

  let styleEl = null;
  function apply(rules) {
    let css = "";
    for (const sel of rules.hide) css += `${sel}{display:none !important;}`;
    for (const sel of rules.show) css += `${sel}{display:revert !important;}`;
    for (const o of rules.order) css += `${o.selector}{order:${o.order} !important;}`;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "cast-rules";
      document.documentElement.appendChild(styleEl);
    }
    styleEl.textContent = css;
    // Pods are table-based → move via DOM, not CSS order (design §2).
    for (const mv of rules.move) {
      try {
        const el = document.querySelector(mv.selector);
        const target = document.querySelector(mv.targetSelector);
        if (el && target && target.parentNode) {
          target.parentNode.insertBefore(el, mv.position === "before" ? target : target.nextSibling);
        }
      } catch (e) {}
    }
  }

  async function currentRules() {
    const { config, deptOverride } = await chrome.storage.local.get(["config", "deptOverride"]);
    // deptOverride (from the popup) lets an authorized user preview another dept's view.
    void deptOverride;
    return rulesFor(member && member.roleName, config);
  }

  let scheduled = false;
  function reapply() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(async () => {
      scheduled = false;
      apply(await currentRules());
    });
  }

  // Re-apply across ConnectWise's SPA route changes (debounced via rAF).
  new MutationObserver(() => reapply()).observe(document.documentElement, { childList: true, subtree: true });
  chrome.storage.onChanged.addListener((c) => {
    if (c.config || c.deptOverride) reapply();
  });
  reapply();
})();
