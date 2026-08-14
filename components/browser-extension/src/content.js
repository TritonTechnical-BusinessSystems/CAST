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

  // ---- Skin (always-on visual modernization, independent of role/dept rules) ----
  //
  // ConnectWise has no stable semantic layer — the same visual "pod" shows up as
  // `div.podborder`, `table.podborder` (class on the table itself, not a wrapper), or
  // `.myactivities` (no "pod" in the name at all) depending on the screen. Rather than
  // hardcode CSS per discovery, every visual element CAST can skin is named once (a
  // "component"), and each component owns a registry of every raw CW selector known to
  // resolve to it (SKIN_COMPONENTS below). Add a selector to a component's registry and
  // every existing customization for that component covers it too — nothing else to
  // touch. This shape matches `@cast/config-schema`'s `Skin` type 1:1 (component name ->
  // token values) so the future authoring UI (INIT-0008) edits exactly these names and
  // never has to know a raw CW selector exists. See knowledge/architecture/
  // browser-extension.md §9.
  //
  // ConnectWise's dashboard-style screens (e.g. "Today") render pod content inside a
  // same-origin iframe, so a single top-document <style> can't reach it — inject into
  // the top document AND every accessible same-origin iframe. Cross-origin iframes
  // (third-party widgets, e.g. the ITBoost overlay) throw on contentDocument access
  // and are skipped; that's expected, not an error.

  // Component name -> every raw CW selector discovered to resolve to it so far.
  const SKIN_COMPONENTS = {
    // body.bodyFill = the iframe's own page body (Today dashboard content);
    // .main-form-view-center/.cw-mainform-div = the TOP document's equivalent —
    // the breadcrumb/tab-strip chrome visible above the iframe, an entirely
    // separate document our CSS has to reach independently (§8.6's iframe
    // caveat). Without both, the strip above the dashboard doesn't match the
    // dashboard's own background.
    pageBackground: { selectors: ["body.bodyFill", ".main-form-view-center", ".cw-mainform-div"] },
    pod: { selectors: [".podborder"] /* TEMP A/B TEST: ".myactivities" removed */ },
    // table.* = pods with a dedicated header table (In/Out Board, Notices, My
    // Activities); td.* = compact link-list pods (My Company, ConnectWise
    // Community, App Launch) where header + body share one table.podborder and
    // the header is just its first td; .todaysActiviesHeader (sic — CW's own
    // typo, not ours: "Activies" not "Activities") = that pod's own header td,
    // plain inline `style="color:...` with no !important, so our !important
    // rule wins outright once the selector actually matches.
    podHeader: {
      selectors: ["table.customheader", "table.grayHeader", "td.customheader", "td.grayHeader", ".todaysActiviesHeader"],
    },
    table: { selectors: ["table"] },
    link: { selectors: ["a"] },
  };

  // Component name -> the token values it renders when the user hasn't customized it.
  // Property names match @cast/config-schema's SkinTokenValues.
  const SKIN_DEFAULT_TOKENS = {
    // Palette below is Logistics Coordinator's (knowledge/architecture/design-system.md
    // predates this; LC's own tokens.css is the source) — gray page background, dark
    // gray (not blue-on-white) headers, light-gray rule lines throughout.
    pageBackground: {
      background: "#F4F6F8",
      color: "#303336",
      fontFamily: "'Noto Sans', 'Segoe UI', Arial, sans-serif",
      fontStretch: "100%",
      fontOpticalSizing: "auto",
    },
    pod: {
      border: "1px solid #D4D8DC",
      borderRadius: "10px",
      boxShadow: "0 1px 3px rgba(48,51,54,0.10)",
    },
    podHeader: {
      background: "#303336",
      color: "#FFFFFF",
      fontFamily: "'Noto Sans', Arial, sans-serif",
      fontWeight: "700",
      fontOpticalSizing: "auto",
    },
    table: {
      // 100% (not condensed) everywhere, matching pageBackground — user call
      // 2026-08-11. Noto Sans genuinely supports a narrower value (`wdth` axis,
      // 62.5-100) if condensed table text is wanted again later.
      fontStretch: "100%",
    },
    link: {
      color: "#0071BC",
    },
  };

  // CW quirks that need a permanent fix but aren't a customizable "component" (no
  // token maps to them — a user wouldn't toggle these independently).
  const SKIN_QUIRK_CSS = `
    a:hover { color: #005A96 !important; }
    /* TEMP A/B TEST: disabled div.myactivities td:not(#_) { background: #FFFFFF !important; } */
    /* Header icons (e.g. Today's Activities' calendar) are raster PNGs, not font
       icons — CSS "color" can't recolor them, so invert them to white against
       the now-dark podHeader background. */
    table.customheader img, td.customheader img, table.grayHeader img,
    td.grayHeader img, .todaysActiviesHeader img {
      filter: brightness(0) invert(1) !important;
    }
  `;

  const SKIN_CSS_PROP = {
    background: "background",
    color: "color",
    border: "border",
    borderBottom: "border-bottom",
    borderRadius: "border-radius",
    boxShadow: "box-shadow",
    fontFamily: "font-family",
    fontWeight: "font-weight",
    fontStretch: "font-stretch",
    fontOpticalSizing: "font-optical-sizing",
  };

  // ConnectWise ships its own `span, label, td, a { font-family: roboto !important; }`
  // rule. A directly-targeting declaration on an element always wins over a value the
  // element only inherited from an ancestor (e.g. our `body.bodyFill` font-family) —
  // specificity/!important only arbitrate between rules that target the SAME element,
  // and inheritance isn't one of those. So font-family/font-optical-sizing have to be
  // re-asserted directly on the same tags CW targets, specificity-boosted (`:not(#_)`,
  // same trick as the myactivities row-banding fix) to win the tie since both sides are
  // author + !important once re-asserted at matching specificity.
  const SKIN_FONT_OVERRIDE_TAGS = ["td", "span", "label", "a"];

  function renderSkinCSS(skinComponentOverrides) {
    let css = "";
    for (const name of Object.keys(SKIN_COMPONENTS)) {
      const selectors = SKIN_COMPONENTS[name].selectors;
      const tokens = Object.assign({}, SKIN_DEFAULT_TOKENS[name], skinComponentOverrides && skinComponentOverrides[name]);
      const decls = [];
      for (const key of Object.keys(tokens)) {
        const prop = SKIN_CSS_PROP[key];
        if (prop && tokens[key]) decls.push(`${prop}: ${tokens[key]} !important;`);
      }
      // Rounding implies clipping — a component with a radius always needs overflow
      // hidden for the rounded corners to actually show against its own content.
      if (tokens.borderRadius) decls.push("overflow: hidden !important;");
      if (decls.length) css += `${selectors.join(", ")} { ${decls.join(" ")} }\n`;

      if (tokens.fontFamily || tokens.fontOpticalSizing) {
        const boostedSelectors = [];
        for (const sel of selectors) {
          for (const tag of SKIN_FONT_OVERRIDE_TAGS) boostedSelectors.push(`${sel} ${tag}:not(#_)`);
        }
        const fontDecls = [];
        if (tokens.fontFamily) fontDecls.push(`font-family: ${tokens.fontFamily} !important;`);
        if (tokens.fontOpticalSizing) fontDecls.push(`font-optical-sizing: ${tokens.fontOpticalSizing} !important;`);
        css += `${boostedSelectors.join(", ")} { ${fontDecls.join(" ")} }\n`;
      }
    }
    return css + SKIN_QUIRK_CSS;
  }

  const SKIN_FONT_HREF =
    "https://fonts.googleapis.com/css2?family=Noto+Sans:wdth,wght@62.5..100,300..800&display=swap";

  function injectSkinInto(doc, css) {
    try {
      // <head> doesn't exist yet at document_start (run_at is intentionally this
      // early — see §8.6 — to beat ConnectWise's own paint and avoid a flash of
      // unstyled content). <html> always exists; browsers tolerate <style>/<link>
      // there and promote them once <head> is parsed.
      const target = doc.head || doc.documentElement;
      if (!doc.getElementById("cast-skin-font")) {
        const link = doc.createElement("link");
        link.id = "cast-skin-font";
        link.rel = "stylesheet";
        link.href = SKIN_FONT_HREF;
        target.appendChild(link);
      }
      let el = doc.getElementById("cast-skin");
      if (!el) {
        el = doc.createElement("style");
        el.id = "cast-skin";
        target.appendChild(el);
      }
      // The MutationObserver driving reapply() watches the whole document
      // (subtree:true — pods/iframes can appear anywhere), so this runs on every
      // DOM mutation ConnectWise's own GWT app makes, not just ones caused by us.
      // Writing textContent forces a full style recalc even when the css is
      // identical to what's already there — skip it. Confirmed empirically: with
      // this skipped, a pod (My Activities) that populates itself via many rapid
      // incremental DOM updates would otherwise render as an empty, unstyled box
      // for 10+ seconds — gone with CAST disabled entirely, so it was genuinely
      // our own reapply() churn competing with ConnectWise's render, not a CW bug.
      if (el.textContent !== css) el.textContent = css;
    } catch (e) {
      /* inaccessible (cross-origin) document — skip */
    }
  }

  const wiredFrames = new WeakSet();
  function applySkin(skinComponentOverrides) {
    const css = renderSkinCSS(skinComponentOverrides);
    injectSkinInto(document, css);
    for (const frame of document.querySelectorAll("iframe")) {
      if (frame.contentDocument) injectSkinInto(frame.contentDocument, css);
      if (!wiredFrames.has(frame)) {
        wiredFrames.add(frame);
        frame.addEventListener("load", () => {
          if (frame.contentDocument) injectSkinInto(frame.contentDocument, css);
        });
      }
    }
    ensureStatusBadge();
  }

  // Always-on status readout confirming the extension is active — top document only
  // (persistent ConnectWise chrome, not pod content). Sits in the gray strip above the
  // "Today" iframe (viewport y:44-130 on every screen — that band is the top-document
  // container's own background peeking out above whatever content loads below it),
  // vertically centered in it. `right` (not a fixed x) so it hugs the true window edge
  // regardless of devtools/viewport width.
  function ensureStatusBadge() {
    if (!document.body) return; // too early (document_start) — MutationObserver retries once <body> exists
    let badge = document.getElementById("cast-status-badge");
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "cast-status-badge";
      badge.style.cssText = [
        "position: fixed",
        "top: 87px",
        "right: 16px",
        "transform: translateY(-50%)",
        "z-index: 999999",
        "font-family: 'Inter', 'Segoe UI', Arial, sans-serif",
        "font-size: 13px",
        "color: #303336",
        "pointer-events: none",
        "user-select: none",
      ].join(";");
      badge.textContent = "\u{1F7E2} CAST enhancements enabled";
      document.body.appendChild(badge);
    }
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
    if (styleEl.textContent !== css) styleEl.textContent = css; // see injectSkinInto's comment
    // Pods are table-based → move via DOM, not CSS order (design §2).
    for (const mv of rules.move) {
      try {
        const el = document.querySelector(mv.selector);
        const target = document.querySelector(mv.targetSelector);
        // Skip if already in place — insertBefore on an already-correct position
        // still fires a DOM mutation, which would retrigger our own MutationObserver.
        const alreadyThere =
          mv.position === "before" ? el && el.nextElementSibling === target : el && target && target.nextElementSibling === el;
        if (el && target && target.parentNode && !alreadyThere) {
          target.parentNode.insertBefore(el, mv.position === "before" ? target : target.nextSibling);
        }
      } catch (e) {}
    }
  }

  // The MutationObserver below fires reapply() on every DOM mutation ConnectWise's
  // own GWT app makes anywhere on the page — during its own initial render this can
  // be dozens of times per second. reapply() used to `await chrome.storage.local.get`
  // (an async extension-messaging round-trip) on every single one of those calls.
  // Confirmed empirically that this was slow enough to compete with ConnectWise's own
  // render loop: a pod that populates itself via many rapid incremental DOM updates
  // (My Activities) would render as an empty, unstyled box for 10+ seconds with CAST
  // enabled — gone entirely with CAST disabled. Config only actually changes on load
  // and on chrome.storage.onChanged, so cache it and keep the hot MutationObserver
  // path fully synchronous — no async work between "DOM changed" and "CSS reapplied".
  let cachedConfig = null;
  async function loadConfig() {
    const { config } = await chrome.storage.local.get(["config"]);
    cachedConfig = config;
  }

  let scheduled = false;
  function reapply() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      applySkin(cachedConfig && cachedConfig.skin && cachedConfig.skin.components);
      apply(rulesFor(member && member.roleName, cachedConfig));
    });
  }

  // Re-apply across ConnectWise's SPA route changes (debounced via rAF).
  new MutationObserver(() => reapply()).observe(document.documentElement, { childList: true, subtree: true });
  chrome.storage.onChanged.addListener((c) => {
    if (c.config) loadConfig().then(reapply);
  });
  loadConfig().then(reapply);
})();
