/*
 * Deploy monitor — view logic (INIT-0038).
 *
 * Reads a single SSE stream from this container (which polls `deploy-agent`
 * every 500ms on the internal network) and renders three things: elapsed time,
 * which stage is running, and the raw output. No framework, no build step —
 * this page has to render when the rest of the stack is mid-rebuild, so it
 * depends on nothing that isn't already in the browser.
 */
(function () {
  "use strict";

  var APP_ORIGIN = document.body.dataset.appOrigin || "";
  var REDIRECT_DELAY_SEC = 5;
  // Separate baselines per action FAMILY, not one shared key -- bug found
  // live 2026-08-21: an "update-monitor" run (rebuilds one small container,
  // ~1 minute) and a real "redeploy"/"update-and-redeploy" (rebuilds api+web,
  // several minutes) were both feeding the same rolling average. The array
  // only keeps the last 5 entries, so a couple of fast monitor-only updates
  // was enough to drag the "typical" duration shown during a real deploy down
  // to something nonsensical (observed: 19s against an actual ~3:35 run).
  var TYPICAL_DEPLOY = { key: "cast.deploy.durations", fallback: 215 }; // 3:35 — first real measured deploy
  var TYPICAL_MONITOR = { key: "cast.deploy.monitor-durations", fallback: 60 };
  function typicalFor(action) {
    return action === "update-monitor" ? TYPICAL_MONITOR : TYPICAL_DEPLOY;
  }

  var STAGE_LABELS = {
    pull: "git pull origin main",
    "build-api": "build api image",
    "build-web": "build web image",
    up: "start containers",
    prune: "prune old images",
    "build-monitor": "build monitor image",
    "up-monitor": "restart monitor",
  };

  var el = {
    body: document.body,
    stateText: document.getElementById("state-text"),
    meta: document.getElementById("meta"),
    elapsed: document.getElementById("elapsed"),
    action: document.getElementById("action"),
    trackFill: document.getElementById("track-fill"),
    trackLeft: document.getElementById("track-left"),
    trackRight: document.getElementById("track-right"),
    stages: document.getElementById("stages"),
    tape: document.getElementById("tape"),
    follow: document.getElementById("follow"),
    outcome: document.getElementById("outcome"),
    outcomeTitle: document.getElementById("outcome-title"),
    outcomeBody: document.getElementById("outcome-body"),
    outcomeLink: document.getElementById("outcome-link"),
    stay: document.getElementById("stay"),
  };

  var status = null;
  var plan = [];
  var stageOrder = [];
  var stageSeenAt = {}; // stage id -> client ms when first observed
  var following = true;
  var redirectTimer = null;
  var settled = false;
  /* Whether this page session actually watched the deploy run. Landing on an
     already-finished deploy — refreshing, or opening the link later to read
     the log — must NOT start a countdown and yank the reader away. */
  var sawRunning = false;

  // The watch token arrives in the query string and is immediately exchanged
  // for an httpOnly cookie by the server. Drop it from the address bar so it
  // isn't sitting in browser history or over someone's shoulder.
  if (window.location.search.indexOf("w=") !== -1 && window.history.replaceState) {
    window.history.replaceState({}, "", window.location.pathname);
  }

  // --- helpers -------------------------------------------------------------

  function fmtDuration(totalSec) {
    if (!isFinite(totalSec) || totalSec < 0) totalSec = 0;
    var m = Math.floor(totalSec / 60);
    var s = Math.floor(totalSec % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function typicalSeconds(action) {
    var t = typicalFor(action);
    try {
      var raw = window.localStorage.getItem(t.key);
      var arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr) && arr.length) {
        var sum = arr.reduce(function (a, b) {
          return a + b;
        }, 0);
        return Math.round(sum / arr.length);
      }
    } catch (e) {
      /* localStorage unavailable or corrupt — fall through to the default */
    }
    return t.fallback;
  }

  function recordDuration(action, sec) {
    var t = typicalFor(action);
    try {
      var raw = window.localStorage.getItem(t.key);
      var arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) arr = [];
      arr.push(sec);
      // Keep a short window so the baseline tracks how this box behaves NOW,
      // not how it behaved months ago on different hardware or image sizes.
      while (arr.length > 5) arr.shift();
      window.localStorage.setItem(t.key, JSON.stringify(arr));
    } catch (e) {
      /* non-fatal — the baseline is a nicety, not a requirement */
    }
  }

  function setState(name) {
    el.body.dataset.state = name;
  }

  // --- log parsing ---------------------------------------------------------

  // deploy.sh emits `::plan::a,b,c` once up front and `::stage::<id>` as each
  // begins. Parsing real markers beats inferring progress from elapsed time,
  // which would misreport the moment a build runs slower or faster than usual.
  function parseLog(log) {
    var lines = log.split("\n");
    var visible = [];
    var nextPlan = null;
    var seenStages = [];

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.indexOf("::plan::") === 0) {
        nextPlan = line.slice(8).split(",").filter(Boolean);
      } else if (line.indexOf("::stage::") === 0) {
        seenStages.push(line.slice(9).trim());
      } else {
        visible.push(line);
      }
    }
    return { visible: visible.join("\n"), plan: nextPlan, stages: seenStages };
  }

  function renderStages(seen, isFailed) {
    var list = plan.length ? plan.slice() : seen.slice();
    if (!list.length) return;

    // A stage id that showed up without being in the announced plan still gets
    // rendered — better to show something real we didn't predict than to hide it.
    seen.forEach(function (id) {
      if (id !== "done" && list.indexOf(id) === -1) list.push(id);
    });

    var activeIndex = -1;
    var doneSet = {};
    for (var i = 0; i < seen.length; i++) {
      if (seen[i] === "done") continue;
      doneSet[seen[i]] = true;
    }
    // A failed run never reaches the trailing `done` marker (deploy.sh runs
    // under `set -e`), but don't rely on that: if the exit code says failed,
    // refuse to mark every stage complete regardless of what markers arrived.
    // "All stages ✓" next to a FAILED banner is a contradiction that would
    // make someone distrust the whole page.
    var finishedAll = !isFailed && seen.indexOf("done") !== -1;
    if (!finishedAll && seen.length) {
      var lastReal = null;
      for (var k = seen.length - 1; k >= 0; k--) {
        if (seen[k] !== "done") {
          lastReal = seen[k];
          break;
        }
      }
      if (lastReal) {
        activeIndex = list.indexOf(lastReal);
        delete doneSet[lastReal];
      }
    }

    var html = "";
    for (var j = 0; j < list.length; j++) {
      var id = list[j];
      var label = STAGE_LABELS[id] || id;
      var state = "pending";
      var mark = "·";
      if (finishedAll || doneSet[id]) {
        state = "done";
        mark = "✓";
      } else if (j === activeIndex) {
        state = isFailed ? "failed" : "active";
        mark = isFailed ? "✕" : "▸";
      }

      var timeText = "";
      if (stageSeenAt[id]) {
        var nextId = list[j + 1];
        var endedAt = stageSeenAt[nextId] || (finishedAll || isFailed ? stageSeenAt.__end || Date.now() : null);
        if (state === "done" && endedAt) {
          timeText = fmtDuration((endedAt - stageSeenAt[id]) / 1000);
        } else if (state === "active") {
          timeText = fmtDuration((Date.now() - stageSeenAt[id]) / 1000);
        }
      }

      html +=
        '<li class="stage" data-status="' +
        state +
        '"><span class="stage-mark" aria-hidden="true">' +
        mark +
        '</span><span class="stage-name">' +
        escapeHtml(label) +
        '</span><span class="stage-time">' +
        timeText +
        "</span></li>";
    }
    el.stages.innerHTML = html;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // --- rendering -----------------------------------------------------------

  function render() {
    if (!status) return;

    if (status.ok === false) {
      el.stateText.textContent = "No status";
      el.action.textContent = "cannot reach deploy agent";
      setState("failed");
      return;
    }

    var parsed = parseLog(status.log || "");
    if (parsed.plan) plan = parsed.plan;

    // Record the first time we OBSERVE each stage. Approximate by up to the
    // poll interval, and unknown for stages that already happened before this
    // page connected — shown blank rather than invented.
    parsed.stages.forEach(function (id) {
      if (!stageSeenAt[id] && stageOrder.indexOf(id) === -1) {
        stageOrder.push(id);
        stageSeenAt[id] = Date.now();
      }
    });

    var failed = status.status === "done" && status.exitCode !== 0;
    var running = status.status === "running";
    if (running) sawRunning = true;

    if (status.finishedAt && !stageSeenAt.__end) stageSeenAt.__end = Date.parse(status.finishedAt);

    // elapsed
    var startMs = status.startedAt ? Date.parse(status.startedAt) : null;
    var endMs = status.finishedAt ? Date.parse(status.finishedAt) : null;
    var elapsedSec = startMs ? ((endMs || Date.now()) - startMs) / 1000 : 0;
    el.elapsed.textContent = fmtDuration(elapsedSec);

    var typical = typicalSeconds(status.action);
    var overrun = running && elapsedSec > typical;

    if (running) setState(overrun ? "slow" : "running");
    else if (failed) setState("failed");
    else if (status.status === "done") setState("done");
    else setState("idle");

    el.stateText.textContent = running ? (overrun ? "Taking longer" : "Running") : failed ? "Failed" : status.status === "done" ? "Complete" : "Idle";

    el.action.textContent = status.action ? String(status.action).replace(/-/g, " ") : "no deploy recorded";
    el.meta.textContent = "cast · trt-cast-01" + (status.triggeredBy ? " · " + status.triggeredBy : "");

    // progress — an estimate, and labelled as one
    var pct = typical > 0 ? Math.min(100, (elapsedSec / typical) * 100) : 0;
    if (!running) pct = status.status === "done" ? 100 : 0;
    el.trackFill.style.width = pct + "%";
    el.trackLeft.textContent = running ? "elapsed" : failed ? "stopped" : status.status === "done" ? "finished" : "elapsed";
    el.trackRight.textContent = overrun ? "longer than usual (typical " + fmtDuration(typical) + ")" : "typical " + fmtDuration(typical);

    // `stageOrder`, NOT `parsed.stages` — real bug, caught live 2026-08-21: a
    // long enough build pushes the early `::stage::` lines out of
    // deploy-agent's own log window (500 chunks stored, only the last 200
    // returned by /status), so a poll partway through no longer sees them in
    // the raw log at all. Rendering directly off `parsed.stages` made the
    // stage list forget everything already completed and revert to "nothing
    // has happened" the moment that scroll-off occurred — while the output
    // tape kept showing real, current progress right below it. `stageOrder`
    // is this session's own accumulated memory of every marker it has ever
    // seen, independent of whether the server's log window still contains it.
    renderStages(stageOrder, failed);

    // tape
    if (el.tape.textContent !== parsed.visible) {
      el.tape.textContent = parsed.visible;
      if (following) el.tape.scrollTop = el.tape.scrollHeight;
    }

    // outcome
    if (status.status === "done" && !settled) {
      settled = true;
      if (failed) {
        showFailure(status);
      } else {
        // Only learn from a deploy we actually watched — otherwise every
        // revisit to an old finished deploy would re-record the same duration
        // and skew the baseline.
        if (sawRunning && startMs && endMs) recordDuration(status.action, Math.round((endMs - startMs) / 1000));
        showSuccess(sawRunning);
      }
    }
  }

  function showFailure(s) {
    el.outcome.dataset.show = "true";
    var code = s.exitCode;
    el.outcomeTitle.textContent = code === -2 ? "Deploy timed out and was stopped." : "Deploy failed (exit code " + code + ").";
    // The genuinely useful fact when a deploy fails is what's running RIGHT
    // NOW, not the failure itself — say it first rather than making someone
    // infer it from the log.
    el.outcomeBody.textContent =
      code === -1
        ? "The deploy script could not be started. Nothing was changed; the previous version is still running."
        : "The previous version is still running — a failed build does not replace the containers already up. The output above ends at the failing step.";
    el.outcomeLink.textContent = "Return to System Health";
    el.outcomeLink.href = APP_ORIGIN + "/health";
  }

  function showSuccess(autoReturn) {
    el.outcome.dataset.show = "true";
    el.outcomeTitle.textContent = "Deploy complete.";
    el.outcomeLink.href = APP_ORIGIN + "/health";

    if (!autoReturn) {
      // Arrived after the fact — this is a record to read, not a wait to end.
      el.outcomeBody.textContent = "This deploy has already finished. The output above is the full record of it.";
      return;
    }

    el.stay.hidden = false;
    var left = REDIRECT_DELAY_SEC;
    var tick = function () {
      el.outcomeBody.textContent = "The new version is live. Returning to System Health in " + left + "…";
      if (left <= 0) {
        window.location.href = APP_ORIGIN + "/health";
        return;
      }
      left -= 1;
    };
    tick();
    redirectTimer = window.setInterval(tick, 1000);

    el.stay.addEventListener("click", function () {
      if (redirectTimer) window.clearInterval(redirectTimer);
      redirectTimer = null;
      el.stay.hidden = true;
      el.outcomeBody.textContent = "The new version is live.";
    });
  }

  // --- follow toggle -------------------------------------------------------

  el.follow.addEventListener("click", function () {
    following = !following;
    el.follow.setAttribute("aria-pressed", String(following));
    el.follow.textContent = following ? "Following" : "Paused";
    if (following) el.tape.scrollTop = el.tape.scrollHeight;
  });

  // Scrolling up is an implicit "stop following" — matching what every log
  // viewer does, so nobody has to discover the button to read back.
  el.tape.addEventListener("scroll", function () {
    var atBottom = el.tape.scrollHeight - el.tape.scrollTop - el.tape.clientHeight < 24;
    if (!atBottom && following) {
      following = false;
      el.follow.setAttribute("aria-pressed", "false");
      el.follow.textContent = "Paused";
    }
  });

  // --- stream --------------------------------------------------------------

  var source = new EventSource("/events");
  source.onmessage = function (evt) {
    try {
      status = JSON.parse(evt.data);
    } catch (e) {
      return;
    }
    render();
  };
  source.onerror = function () {
    // EventSource reconnects on its own; only say something if we have nothing
    // at all to show, so a blip during the api/web swap doesn't read as failure.
    if (!status) {
      el.stateText.textContent = "Reconnecting";
      el.action.textContent = "waiting for the monitor stream";
    }
  };

  // Local tick so the clock and the active stage's timer advance smoothly
  // between server payloads, instead of jumping every poll interval.
  window.setInterval(function () {
    if (status && status.status === "running") render();
  }, 1000);
})();
