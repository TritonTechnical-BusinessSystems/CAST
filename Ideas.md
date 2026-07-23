# Ideas — the horizon

Next-level ideas that push CAST's vision further. **Lighter than Initiatives** — not yet
"we intend to / might build it," just potential worth not losing. Promote an idea to an
Initiative (`Initiatives-Open.md`) when we decide to actually pursue it.

The test for this list: *does it give Triton capability ConnectWise doesn't natively
provide?* (the North Star). If yes, it belongs here even if we never build it.

---

### Refit signals — dormant CW data → proactive outreach
The vessel companies already carry `Last Refit` (date) and `Refit Cycle (in years)`
custom fields, sitting unused. Compute each yacht's **next-refit-due date** and surface a
live "**due for refit in the next N months**" list, so the account/sales team reaches out
*before* the owner shops it elsewhere. Cheap (read-only math on existing fields, no new
integration); pure North Star. *Easiest first swing.*

### Live fleet board — fuse AIS × PSA
Overlay each tracked yacht's **real-time status** (moored / anchored / underway, nearest
port, from aisstream) with its **ConnectWise engagement state** (open tickets/projects on
chosen boards). Answers a question *neither system can alone*: "which client vessels are
**in port now AND have open service work?**" → dispatch dockside while the vessel is there.
The flagship expression of why CAST exists. More ambitious (needs the monitor running + a
map UI).

### Event-driven automation off the AIS stream
aisstream is a live push stream, so react to **events**, not a cron: when a tracked yacht
berths at a port where Triton has a presence, auto-flag a CW activity / notify the account
team ("vessel arrived — schedule dockside service"). Evolves the scheduled data-sync
(`INIT-0002`) into real-time, real-world-triggered Triton workflows.

### One intelligence layer — the extension augments CW in-context
Have the **browser extension** surface CAST's enriched data (live position, status, ETA,
refit-due) **inline on the ConnectWise company screen** a tech is already viewing — so the
extension stops merely reshaping the UI (hide/show pods) and starts *augmenting* it with
data CW doesn't have. Converges CAST's three components (extension + web app + data
services) into a single intelligence layer.
