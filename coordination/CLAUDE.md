# coordination: sessions, topics and the checklist

Loaded when a session works under `coordination/`. The roster loads from the router in every session; the rest of the coordination rules are one line in the router and the detail is here.

- **Sessions:** the **PM** (the user's single point of contact; keeps the board and the list of what waits on the user; accepts finished work), **infra** (the only holder of production credentials), and one **topic** session per piece of work (it builds the work end to end on its own branch, `seat/topic-<slug>`, and retires when merged). Who is who: `ROSTER.md`. On FORGE, `FORGE.md` wins.
- **Specialists are subagents** in `.claude/agents/` (index: `.claude/agents/README.md`), called by a topic. Design-ux-frontend is mandatory for any UI change; the reviewer checks every topic before acceptance. Sonnet by default; log each Opus call as one line on the topic issue.
- **Take your seat first:** PM and infra run `node scripts/coord.mjs seat take <role>`; a topic reads its topic issue. Lost after a compaction? `node scripts/coord.mjs whoami`, then your checkpoint.
- **Checkpoint after each finished task:** one CHECKPOINT comment, replaced as things change, five lines (`BOOT.md`). After a compaction re-read the log of the main branch, your checkpoint and your issue before you act.
- **Conflicts between topics:** list the areas you will touch on your issue; overlapping topics run one after the other; shared hotspots land first as a small change the PM approves; at most 2 to 3 topics are open (`ROSTER.md`).
- **Use judgment:** pick the sensible reading, note why, carry on. Stop and ask only for production, anything that reaches real people, new spend, a public store release, force pushes or deleting history.
- **Message by address**, never by name (`COMMS.md`); answer a ping with `ack <name>`.
- **Write state down:** requests on Issues (`coord.mjs post`), decisions in `DECISIONS.md` via the PM, open asks in `OPEN-LOOPS.md`.
- **Replace a session only when it is broken** (`BOOT.md`).
