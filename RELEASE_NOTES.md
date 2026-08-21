# Release Notes

User-facing story of every CAST release, curated from `CHANGELOG.md`. Newest first. Format: `knowledge/conventions/changelog-and-releases.md`.

---

# What's New in v0.22.0 — August 2026

The Deploy card can now tell you whether there's actually something to deploy, before you click anything.

## Highlights

- **"Check for updates" on System Health's Deploy card.** Shows the version and build you're currently running against what's available on the main branch, and how many commits behind you are. When there's something new, the "Update from git + Redeploy" button changes color so it's obvious there's a reason to click it.

## For the power users

- The check is a real, on-demand network call to GitHub — it deliberately doesn't run automatically every few seconds like the rest of the Deploy card's status polling. The server also caches its own result for a minute and shares one check across multiple open tabs clicking it at the same time, rather than making redundant calls.
- A pre-release security review passed, with three small hardening fixes made before shipping: two people checking at once could briefly cause duplicate work (fixed), and a couple of edge cases around malformed data were closed off so they'd degrade quietly instead of causing an error on screen.

---

# What's New in v0.21.0 — August 2026

The deploy monitor from v0.20.0 can now update itself in place, right from System Health — and a real crash on the Currencies tab is fixed.

## Highlights

- **A "Deploy monitor" tile on System Health.** It shows whether the monitor is up, how long it's been running, and — when a deploy has shipped a newer version of it — an "Update ready" badge with a one-click Update button. Progress for that update shows right in the tile, since updating the monitor doesn't touch the rest of the app.
- **Fixed: the Currencies tab could crash outright** with a raw JavaScript error instead of showing data. One ConnectWise currency record had no ISO code set, and the page choked trying to sort by it. The same defensive fix was applied to four other ConnectWise lookups that had the identical latent gap.
- **Carriers and Currencies are no longer separate tabs in Logistics Configuration.** Both were always read-only displays with nothing to configure — the actual carrier and currency pickers used when generating shipment documents are untouched and keep working exactly as before.
- **Freed up disk space on the deploy server.** Investigating why storage looked high turned up 17+ GB of Docker's own build cache that had never been cleaned up, going back a month. Every deploy now clears out old cache automatically.
- **"Update deploy monitor" no longer sends you to the page it's about to rebuild** — a bug from v0.20.1, found by asking how the monitor itself gets updated, before it caused real confusion.

## For the power users

- The monitor's "staged vs. running" detection compares the actual source code, not a version number — a version-number comparison would have falsely flagged it as outdated after nearly every deploy, since most deploys don't touch the monitor at all.
- One pre-release security review passed clean, confirming the new internal check the monitor tile relies on can't be reached from outside the deploy network and reveals nothing beyond a build fingerprint.

---

# What's New in v0.20.0 — August 2026

Redeploys are now something you can watch happen, instead of staring at a dead site for three minutes hoping it comes back.

## Highlights

- **A deploy monitor that stays up while the app restarts.** Starting a redeploy takes you to a dedicated page that shows live progress — which stage it's on, how long it's taken, and the actual build output as it scrolls — then returns you to System Health when it's done. This runs in its own separate container on its own port, specifically so that rebuilding the app can't take the progress page down with it. That was the flaw in the previous version: the status display was served by the very thing being restarted.
- **It tells you the truth when something goes wrong.** A failed deploy says so plainly, marks the step that failed, and leads with the fact that actually matters: the previous version is still running, because a failed build doesn't replace what's already up.
- **The progress bar is honest about being an estimate.** It measures against how long your deploys typically take (learned from real runs), and when one runs long it says "longer than usual" instead of parking at 99% pretending.
- **"Update deploy monitor"** is available separately, since a normal deploy deliberately doesn't restart the monitor — that would kill the progress stream you're watching.

## For the power users

- The monitor is the most locked-down piece of the stack by design: it can watch a deploy but has no ability to start one, no access to Docker, no deploy key, and none of the app's stored credentials or signing keys.
- Two pre-release security reviews each blocked this before it shipped. The first found that a single line of container configuration had quietly handed the monitor every secret the main app holds — including the credential that can trigger deploys — which would have defeated the entire reason for separating it out. The second found that the proposed fix for a second issue was based on faulty reasoning, and that a much simpler fix existed. Both are fixed and independently re-verified.
- As part of that second fix, your login session is now scoped more narrowly, so it's only ever sent to the part of the app that actually needs it. **You won't be logged out** — but the change takes full effect for your browser the next time you sign in.
- One item is deliberately still open and needs a human answer, not a code change: confirming with whoever manages the network that the monitor's new port isn't reachable from anywhere it shouldn't be.

---

# What's New in v0.19.0 — August 2026

System Health now quietly starts saving resource-usage history for up to 90 days, ahead of a longer-range view being built to show it — and two Integrations/System Health placement tweaks make the app easier to actually use.

## Highlights

- **Resource-usage history now persists for up to 90 days**, not just the last 3 hours. This release only turns on collection — a way to actually browse the longer history is still coming — but since history can't be recreated after the fact, saving is starting now rather than waiting for the viewing screen to be finished.
- **The "Deploy" card moved to the top of System Health**, instead of being the second-to-last thing on the page, past a full screen of monitoring data.
- **"Update credentials" on the Integrations page moved into the same "3 dots" menu "Clear credentials" already uses** — the last standalone button on that page's cards is now tucked away consistently with the rest.

## For the power users

- The new 90-day history is decimated to one sample a minute (not averaged) and stores overall totals only — not the per-container breakdown, which stays available at full detail for the last 3 hours. That keeps 90 days of history to about 52 MB instead of 195 MB on a small server.
- Found while building the above: a single failed connection to the container-stats service used to silently drop an entire resource-usage sample — not just the container portion of it, but the disk-space and responsiveness readings too. Fixed so one hiccup no longer costs a full data point.

---

# What's New in v0.18.0 — August 2026

A real way back in if you ever forget the break-glass admin password — no public "forgot password" link, since that would be a standing security hole on the app's most privileged account.

## Highlights

- **Locked out of the local TritonAdmin account? There's now a real recovery path.** An admin with database access can put the account into a 30-minute reset window; the next sign-in works with any password (including blank) and immediately prompts for a new one before anything else in the app is reachable — enforced on the server, not just hidden behind a screen you could navigate around.

## For the power users

- This also quietly fixes a gap that's existed since day one: newly-created local accounts were always *meant* to force a password change on first use, but nothing ever actually checked for it. Both cases now go through the same enforced screen.
- A pre-release security check caught a real gap in the first version of this: the reset window had no time limit and nothing recorded that a recovery login had happened. Both are fixed — the window now genuinely expires, and every use of it is logged. Changing your password the normal way (already knowing your current one) now actually asks for it, rather than trusting that a valid session alone was enough.

---

# What's New in v0.17.0 — August 2026

System Health can now trigger a redeploy directly from the browser — no more SSHing into the server for routine updates.

## Highlights

- **"Redeploy" and "Update from git + Redeploy" buttons on System Health.** The first rebuilds and restarts from whatever's currently checked out; the second pulls the latest code first. Built directly in response to tonight's connectivity troubles making even reaching the server a hassle.
- **The credential-holding part of the app was deliberately kept out of this.** The same server process that decrypts every stored integration credential never gets direct control of Docker or the deploy key — a brand-new, separate, minimal component holds those instead, reachable only through two narrow, authenticated actions. A bug or intrusion in the main app's own code still couldn't reach Docker or GitHub directly, even though the new component (necessarily, to do its job) carries real host-level privilege of its own.
- **"Clear credentials" on the Integrations page is no longer a big red button** — it's tucked into a small "3 dots" menu in each card's corner instead, matching how most apps keep destructive actions out of primary button space. The confirmation step before it actually clears anything is unchanged.

## For the power users

- Only one deploy can run at a time — a second click while one's in progress is refused with a clear message, not queued or raced.
- The deploy trigger is gated behind a new, stricter permission than anything else in the app (not even the credentials-management role gets it by default) — deliberately scoped to admins only, since it runs real code on the server.
- This hasn't been exercised against the live production server yet as of this release — the first real use should be watched closely rather than assumed to work.

---

# What's New in v0.16.0 — August 2026

The ConnectWise-writes safety switch got the same rigor as the credential work in v0.15.0 — it's now scoped per environment, not one shared switch — and every remaining place that quietly assumed "Production" instead of asking is gone.

## Highlights

- **ConnectWise writes are now turned on and off per environment, not globally.** Previously, one switch controlled writes to both Production and Sandbox — meaning testing writes against Sandbox meant real writes to Production were live too. Each environment on the Integrations page now has its own switch, its own status, and its own confirmation before enabling.
- **No page anywhere silently assumes "Production" or "the default environment" anymore.** Five Configuration pages that used to auto-pick an environment now ask explicitly before showing anything. The shipment detail page — the one place that actually posts documents and changes ticket status in ConnectWise — had the same gap in a more serious form (a bookmarked or old link could silently land on Production with no on-screen indication); it now asks first, and always shows which environment it's pointed at.
- **"Writes enabled" no longer looks like a warning.** A correctly-scoped environment with writes on is the normal, intended state — the indicator is green now, not red, matching how the rest of the app treats a healthy, working setup.
- **aisstream.io and TrackingMore credentials can now be entered and rotated right on the Integrations page**, the same way ConnectWise's already work — no more editing a server file and redeploying to change a key.

## For the power users

- A pre-release security check caught the shipment-detail-page gap described above before it shipped — traced to the one page in the credential-safety work that hadn't gotten the same treatment as everywhere else. Fixed and independently re-verified, not self-certified.
- Both new integrations validate their URL field against the real provider's domain before saving, same protection ConnectWise's connection address already has — closes off a class of mistake (or malicious entry) that would otherwise hand a real API key to the wrong host.
- While testing the new TrackingMore card, its currently-stored key turned out to be invalid/expired against the live API — worth rotating whenever that integration actually gets built.

---

# What's New in v0.15.0 — August 2026

ConnectWise credentials got a real safety pass — no more shared fallback paths, and a real place to manage both Production and Sandbox.

## Highlights

- **No more credential fallback, anywhere.** Every ConnectWise call now requires its own instance's real, resolved credentials — enforced at the code level, not just by convention. There is no longer any path, accidental or otherwise, where a request meant for one ConnectWise environment could silently use another's credentials.
- **Integrations now manages ConnectWise PSA properly** — one section, one card per environment (Production, Sandbox), each with its own connection test and its own credentials form. Updating just an API key no longer requires re-entering everything else for that environment.
- **Production's credentials moved into the same secure, encrypted storage everything else uses** — they'd been living only in a server config file since day one. Migrated in place, verified byte-for-byte, with zero downtime.

## For the power users

- Sandbox's credentials form pre-fills the shared Client ID (the same one Production uses) so it doesn't need typing twice — just the company and API key pair are entered fresh.
- A real bug was caught and fixed while building this: a partially-saved credential (just the Client ID, ahead of the rest) could get silently wiped out by the next save on top of it. Fixed before anyone hit it in practice.
- A pre-release security check blocked the first version of this and found two real gaps — a missing check that would have let a mistyped or malicious address receive Production's real API key, and a crash risk in one vessel-identity route. Both fixed and verified before this shipped, no impact to any user.
- Credentials can now be fully cleared, not just overwritten — useful if a key ever needs to be revoked rather than replaced.

---

# What's New in v0.14.0 — August 2026

Logistics Configuration got a real workout this round — its layout, its data, and a couple of real bugs, all fixed the same day they were found.

## Highlights

- **Carriers and Currencies are now live from ConnectWise**, not a hand-typed local list — Carriers reads the same "Shipment Carrier" field logistics tracking already uses, so it's always exactly what's configured in CW, per instance (Production/Sandbox can differ). Currencies is wired up the same way, pending one ConnectWise permission grant.
- **Configuration is now the main Logistics page**, not a separate page one click away — the old landing page's embed-link generator moved into a tab of its own alongside the rest of Configuration.
- **Outbound Shipments works against real ConnectWise again** — it was failing with a configuration error despite CAST's main CW connection already being live; now reuses those same credentials automatically for the Production instance.
- **A real layout bug is fixed**: several fields in the Configuration forms (Add Company and others) were rendering at half their intended height and visibly misaligned from their neighbors. Root cause was a CSS class doing the wrong thing inside a differently-oriented container — now fixed everywhere it appeared, with a guardrail comment so it doesn't come back.

## Improvements

- Vessel Site coordinates now round to 5 decimal places (~1m precision) with a space after the comma, both in the real ConnectWise write and the on-screen preview.
- The "Ship As Companies" tab is now labeled "Branding / Ship As".

## For the power users

- Currencies won't populate until the CAST ConnectWise API member is granted a Finance > Currency read permission — the tab's own error banner says so explicitly; nothing to debug, just a permission to add in ConnectWise.
- Sandbox (`tritontech_cs1`) still has no ConnectWise credentials of its own — Production's reuse fix doesn't extend to it, since there's nothing to reuse; that one's still blocked on retrieving LogisticsCoordinator's stored sandbox keys.

---

# What's New in v0.13.0 — August 2026

System Health went from a page of status dots to a real operations dashboard.

## Highlights

- **CPU, memory, storage, and network — with real charts, not just numbers.** Gauges for what's true right now, and six live time-series charts (CPU, memory, event-loop lag, disk I/O, network I/O, storage) so you can see whether something's a blip or a trend. Hover any chart for the exact value at that moment; every chart also has a plain table view.
- **The Docker Containers table now shows live resource use per container**, not just up/down status — CPU and memory bars, plus disk throughput, right in the row.
- **Two new checks that used to require SSHing into the server:** TLS certificate expiry (so a renewal problem shows up here first, not as a browser warning) and backup freshness (so a broken nightly backup doesn't go unnoticed for weeks).
- **ConnectWise and AIS now have their own performance charts** — response latency for CW, message-processing latency for the AIS feed — so a slowdown in either shows up as a trend on this page instead of only being noticeable when something actually breaks.

## For the power users

- Shipment tracking (TrackingMore) doesn't get a latency chart — it's a metered third-party API with no existing periodic call to piggyback on, so a dedicated poll loop just for this dashboard wasn't worth the added usage against the account.
- Everything on this page is built from real data the app was already collecting or already calling — the CW and AIS latency charts, for instance, time calls this page was already making every 15 seconds, so nothing new was added to CW's or AIS's actual load.

---

# What's New in v0.12.0 — August 2026

Real ConnectWise writes can now be turned on for a handful of vessels at a time, not all-or-nothing.

## Highlights

- **A controlled rollout, right in the Vessel Location tab.** A page-level switch chooses between "Allowlist only" and "All tracked vessels," and every vessel gets its own checkbox to opt it into real writes individually — see exactly what would be written, then decide to actually let it happen, one vessel at a time.
- **Nothing writes by default, even with writes turned on.** The allowlist starts empty on purpose, so enabling the master switch is safe on its own — a vessel only ever gets a real write once it's explicitly checked.
- **Clearer labeling.** The write-preview line now reads "CW Site Name set to:" instead of "Will write:," and a vessel with no data at all now correctly shows "Vessel" — the same plain text a long-stale vessel already showed — instead of a description of the absence.

---

# What's New in v0.11.0 — August 2026

Vessel Site updates now come with a color: how sure CAST is that what you're reading is still true.

## Highlights

- **Every Vessel Site status now says how confident CAST is.** 🟢 means current — confirmed within the last two hours. 🔵 means CAST is still confident even though it hasn't heard from the vessel recently — a docked or anchored yacht doesn't move without transmitting somewhere, so a quiet week in a shipyard shows the same status the whole time. 🟠 means the last known fact is genuinely getting old and should be double-checked, not silently trusted. After an extended period with nothing fresh at all, the status simply reverts to a bare "Vessel" rather than keep aging a guess.
- **A new field tracks exactly how current the data is.** "Last AIS Data Update" on the Vessel Site now shows the true last-confirmed time, in every case — including once the status itself has stepped back to a bare "Vessel."
- **Time zones are now set automatically.** Every Vessel Site's Time Zone field updates itself from the vessel's real position, so the record always reflects local time for wherever the vessel actually is.
- **The Vessel Location tab now shows exactly what would be sent to ConnectWise**, not just a summary of it — a "Will write" line plus the underlying position, destination, ETA, and last-confirmed data, side by side, before anything goes out.

## For the power users

- Flag/country-of-registration lookup (from the vessel's MMSI) was considered and deliberately not built — it would sit alongside fields that all represent current *location*, and a vessel's flag isn't a location. If it's wanted, it'll be recorded in ConnectWise separately.
- The AIS feed carries meaningfully more than CAST reads today — including the vessel's own broadcast IMO number, on transponders that support it. Worth a look next time vessel-identity matching (`INIT-0014`) comes up.
- A pre-release security check caught a handful of real hardening gaps — missing validation on incoming feed data, an unbounded field, a silent-failure edge case — all fixed before this shipped, no impact to any user.

---

# What's New in v0.10.0 — August 2026

Vessel Location finally shows real ships, not the sample data it's shown since day one — and the AIS pipeline underneath it turned out to have been silently broken since it was built.

## Highlights

- **Vessel Location is live.** Every vessel CAST is actively watching now shows up as a collapsible row — current status, current position in plain language ("Vessel docked in Antibes, France"), and an expandable history of everything received for it, most recent first. This is exactly the same text that would go into ConnectWise if writes were turned on, so it doubles as a preview before flipping that switch.
- **CAST now remembers what it's seen.** Every real AIS update received is kept, not just the latest one — the foundation for answering "how long was this yacht actually in refit" and "which yards does this client keep coming back to," questions the live view alone can't answer.
- **A six-day-old bug is fixed: the AIS feed was never actually being read.** aisstream.io sends its data as binary WebSocket frames; CAST was parsing them as text, so every single message failed silently since the listener was built. This looked identical to the well-documented aisstream service outage running at the same time — both were real, and the outage ending is what exposed the second problem. Confirmed fixed against live production traffic before anything shipped.

## For the power users

- ConnectWise writes remain switched off in production while the newly-fixed pipeline accumulates a track record — flip the switch in Integrations when ready.
- Vessel Location currently shows only vessels with active AIS coverage (Monitoring Tier 1/2, roughly 60 at a time) — a Tracked Vessel with no open project or ticket work gets no AIS coverage at all under the existing priority engine, so it would only ever show an empty row.
- A pre-release security check caught the new history table growing without limit on the same file as CAST's encrypted credential store — fixed before this shipped, no impact to any user.

---

# What's New in v0.9.0 — August 2026

CAST gains a new home base: a Logistics section that can generate shipping paperwork, with the ConnectWise Sandbox now fully isolated from Production.

## Highlights

- **Logistics has arrived in CAST.** A new workspace section covers the first phases of bringing the standalone shipping-prep tool natively into CAST: shared configuration (shippers, carriers, currencies, export statements, CI flags), a live list of open ConnectWise Shipping Requests, a shipment detail page, and — the headline piece — generating a Commercial Invoice or Packing List PDF and posting it straight to the ConnectWise ticket.
- **Production and Sandbox can now be used at the same time, safely.** Every Logistics feature is scoped to a specific ConnectWise instance, and CAST will refuse to touch an instance it doesn't have credentials for rather than ever guessing — so testing against Sandbox can never accidentally reach real Production data.
- **The invoice/packing-list editor is the same screen as the PDF.** Edit the shipper, consignee, pricing, and line-item details right on screen, and the PDF you export or post to ConnectWise is exactly what you see — no separate template that can drift out of sync.

## Fixes

- A delete button anywhere in the app (Configuration's companies/carriers/currencies/etc.) could silently fail to refresh its list even though the deletion actually went through — fixed.
- Confirmed a suspected AIS field-naming bug from the previous release was a false alarm and reverted the change — the original field name was correct all along.

## For the power users

- Logistics document generation hasn't been checked against real production ConnectWise yet — it's been verified end-to-end against a stand-in test server, with the real check pending live ConnectWise credentials for the Sandbox instance.
- The Assembly (drag-and-drop packing) workspace — the piece that actually fills in a shipment's boxes and pallets — is next; today's Documents tab will show "no items packed yet" until that lands.

---

# What's New in v0.8.0 — August 2026

CAST now actually watches vessels live and writes what it sees back into ConnectWise — the AIS monitor is fully working, not just the plan for one.

## Highlights

- **Live vessel tracking is real.** CAST now keeps a persistent connection open to the AIS network for every vessel in Tier 1 (real-time) and rotates through Tier 2 (periodic) to stay within the 50-vessel-per-connection limit — reconnecting automatically if the connection ever drops.
- **ConnectWise updates itself.** Each tracked vessel's site record in ConnectWise now shows its actual current status in plain language — "Vessel docked in La Ciotat, France" or "Vessel underway to Barcelona, Spain (ETA: 11 Aug 21:15 UTC)" — and its coordinates, so ConnectWise's own address search drops a pin right on the vessel's real position.
- **Nearest-port names come from a real, purpose-picked dataset.** Since the fleet is mostly superyachts that anchor at small marinas and coastal towns rather than major shipping ports, CAST uses a broad worldwide port dataset (16,000+ locations) instead of a commercial-shipping-focused one that would have missed most of them.
- **New System Health monitoring** for the AIS connection itself — is it connected, how many messages is it receiving, is anything falling behind. Answers "is this actually working" without needing to dig through server logs.

## For the power users

- One piece is still unverified: the exact shape of the AIS "destination/ETA" data hasn't been confirmed against real live traffic yet (test connections received no data during development) — worth a check once this is live and receiving real traffic.

---

# What's New in v0.7.0 — August 2026

You can now see exactly who's ranked where, not just a top-8 sample.

## Highlights

- **The full priority list, not just a preview.** Tracking Config's preview used to show 8 vessels per tier and cut off the rest. Now it shows everyone — every tracked client, numbered by rank, laid out in five columns so the whole list is scannable at a glance instead of scrolling a long single column.
- **Tracking Config now opens first.** The Vessel Tracking tabs are reordered — Tracking Config, then Vessel Identity, then Vessel Location, then Geo Alerts — and Tracking Config is what you land on now.

---

# What's New in v0.6.0 — August 2026

The AIS vessel-tracking priority engine is now formula-driven end to end — no manual pins or excludes, and the write-target setup that used to need a button click now takes care of itself.

## Highlights

- **A clear, fair pecking order for real-time tracking.** With only 50 real-time AIS slots available, CAST now ranks strictly by real business engagement: any vessel with an active ConnectWise Project always gets a slot before a vessel with only an open ticket does, and ties go to whoever's had activity most recently. A vessel with neither doesn't get tracked at all — no more guessing why one vessel got a slot over another.
- **No more manual pins or excludes.** Earlier builds let anyone pin a vessel to the front of the line or exclude one by hand; both are gone now, on the same principle — every vessel's tracking priority comes from the same formula, for everyone. If a vessel genuinely shouldn't be tracked, remove its MMSI in ConnectWise.
- **Write-target setup is now automatic.** CAST used to need someone to click "Resolve vessel sites" to find each vessel's ConnectWise write target. That step is gone — it now happens quietly in the background every refresh cycle, and only for vessels that actually need it. There's also a new optional setting to have CAST create that ConnectWise record automatically for a client that doesn't have one yet, instead of leaving it untracked.
- **Tracking Config's option lists are alphabetized** — company statuses, project statuses, and ticket boards are now easy to scan instead of showing up in ConnectWise's internal order.

---

# What's New in v0.5.0 — August 2026

CAST now knows exactly where each vessel's tracking data should go — and won't lose track of it if that record gets renamed.

## Highlights

- **Automatic, rename-safe write-target detection.** Each tracked vessel's ConnectWise company gets a specific site — the one named "Vessel..." — where AIS status and location will be written. CAST detects it once and remembers it by its permanent ID, so renaming that site later never breaks the connection. If the site is ever deleted or deactivated, CAST notices and looks for a replacement automatically.
- **A vessel with no such site is skipped, not silently guessed at** — you'll see exactly how many in the Tracking Config preview, with a one-click "Resolve vessel sites" action to check for you.

---

# What's New in v0.4.0 — August 2026

The first working piece of the AIS vessel-tracking engine: deciding which vessels matter most right now.

## Highlights

- **Smart vessel prioritization for live tracking.** aisstream (our AIS data source) only allows watching 50 vessels in real time at once — with 200+ vessels tracked, CAST now automatically decides which 50 deserve that real-time slot: vessels with active work open on selected boards, plus anyone manually pinned, with underway vessels as a tiebreaker. Everyone else still gets periodic coverage, nobody drops out of tracking.
- **Tracking Config shows the real breakdown.** The config page now shows exactly which vessels land in real-time coverage vs. periodic, instead of just a flat count.

## Improvements

- Fixed a rendering bug in the shared notice-banner component that could split a longer message into disconnected, unreadable fragments — now fixed everywhere it's used, not just where it was first spotted.
- Fixed a layout bug where some config cards were stretched with large empty space to match a taller neighbor.

## For the power users

- New API: `GET/PUT /api/tracking/pins` for manually pinning or excluding specific vessels from AIS tracking (no dedicated UI yet — a natural next step).
- Closed a permission gap: editing the tracking rule only checked you were signed in, not that your role could actually edit it.
- Cleaned up a stale piece of internal documentation describing an earlier plan (overwriting a location's street address) that was replaced before it was ever built.

---

# What's New in v0.3.0 — August 2026

A fast way to clear the IMO/MMSI backlog, plus a permission gap closed along the way.

## Highlights

- **Vessel Identity Quick Entry** — a temporary page for entering missing or broken IMO/MMSI numbers across many vessels in one sitting, without opening a dialog for each one. Type into a row, hit Save (or fill several and hit "Save all"), and move on. Linked from the existing Vessel Identity tab; it'll be removed once the backlog is cleared.

## For the power users

- Closed a permission gap: writing a vessel's IMO/MMSI was only checking that you were signed in, not that your role was actually allowed to (`vessel.reconcile`) — it was relying entirely on the global ConnectWise-writes safety switch. Both are now enforced.

---

# What's New in v0.2.0 — August 2026

CAST can now watch itself and manage ConnectWise write access — from inside the app, no file edits or redeploys. This is also the first Release Notes CAST has ever published, so it covers everything since the very first build.

## Highlights

- **System Health now shows what's actually running.** A new Docker Containers card lists every piece of CAST's own infrastructure — what it is, what it's for, whether it's healthy, how long it's been up. If something's wrong with the app itself, this is where you'll see it first.
- **ConnectWise writes can be turned on and off from the Integrations page.** This safety gate used to require editing a config file on the server and redeploying. Now it's a button — one click to turn writes off, a confirmation step to turn them on (since that's the direction that matters).
- **The download landing, sign-in, and Fleet deployment tracking** — CAST's front door for getting the browser extension installed and knowing who has it.
- **Fleet** — see every team member's device/browser pairs, filter to who needs attention, and prune stale records without uninstalling anything.

## Improvements

- The rail brand and tagline read cleanly at every size; version numbers no longer show a meaningless trailing ".0".
- Tabs remember where you left them — refreshing or sharing a link keeps the same view.
- Extension identity is now a friendly machine + browser name instead of a raw device ID.
- The installer no longer gets stuck re-prompting for admin permission on hardened machines.

## Fixes

- A rare crash that could briefly take the whole site down during a deploy is fixed — tracked down to a known Node.js compatibility issue in a database library, not anything in CAST's own code.
- The API's production footprint shrank by more than half (1.14GB → 511MB) with no change in behavior — faster deploys, smaller attack surface.

## For the power users

- The safety gate for ConnectWise writes is now a live, in-app setting (`isCwWritesEnabled()`), not just an environment variable — the first working example of a pattern we'll extend to real credentials next.
- CAST's own pre-deploy design review now drives a real, isolated browser to check its work, instead of only reading source code and guessing how it'll look.
- Deploys build the two Docker images sequentially rather than in parallel, and automatically retry once if the outgoing container is still settling — both fixes for real failures caught live on the deploy host.

---
_Full technical detail: see `CHANGELOG.md` (builds 2607001 … 2608007)._
