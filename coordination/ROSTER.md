# Who is who (loaded by every session; kept by the PM)

There are three kinds of session, plus the specialists they call. Find yours below. Your address is in `$FORGE_SEAT` on FORGE; elsewhere it is your session id (the end of your worktree name, `bridge-cse_<id>` is `session_<id>`, or what your tool shows). `node scripts/coord.mjs whoami` does the lookup for you. Take your seat (`node scripts/coord.mjs seat take <role>` for `pm` and `infra`; a topic reads its topic issue), read your latest CHECKPOINT, and follow the after-compaction steps in `coordination/BOOT.md`. Not listed? Message the PM. On FORGE read `FORGE.md` first: it wins where the rest of `coordination/` differs. History and reachability: `SESSIONS.md`.

| Role | Address | Runs on | Job (detail: `ROLES.md`) |
|---|---|---|---|
| `pm` | `trt-cast-pm` | FORGE seat, never parks | Matt's single point of contact. Keeps the board, opens and closes topics, accepts finished work against its acceptance criteria, keeps "what waits on Matt". Decides nothing. Handbook: `PM.md` |
| `infra` | `trt-cast-infra` | FORGE seat, parks when idle | Hosting (`trt-cast-01`), deploys, backups, TLS, CI and root config. The only holder of production credentials; runs each approved production step |

A topic session is one per piece of work. It builds that work end to end in its own folder on its own branch (`seat/topic-<slug>`), calling subagents for specialist parts, and retires when its work is merged and the PM has accepted it. It is started with `/bmdev:topic <name>` (on FORGE typed in the PM session, which starts it as a seat with `forge-seat topic`; see `FORGE.md`), titled `<CODE> 🔸 🔵 <Name>`, and has one GitHub issue labeled `topic`: the goal, the acceptance criteria, the areas it will touch, the decisions, what is done and what waits on whom.

**Your session title** shows who you are: `<CODE> 🔸 🧑‍💼 PM`, `<CODE> 🔸 🛠️ infra`, `<CODE> 🔸 🔵 <Topic name>`. Details: `ROLES.md`, Naming.

## Open topics

The PM adds a row when a topic opens and removes it when the topic is merged, accepted and retired. The board is `node scripts/coord.mjs topics`. At most 2 to 3 are open at once.

| Topic | Address | Issue | Areas it touches |
|---|---|---|---|

## Subagents (`.claude/agents/`, index: `.claude/agents/README.md`)

A topic (or the PM) calls a subagent for a specialist part. It returns a written result and stops. It is not a session and has no address. Sonnet by default; Opus only for the three read-only agents below, on their triggers.

| Subagent | Model | Owns / used for |
|---|---|---|
| `design-ux-frontend` | Sonnet | Any UI change (mandatory): screens, styles, tokens, brand, UX rules, on every surface |
| `api` | Sonnet | The back end: API, data, schema, migrations, jobs, sign-in and security code |
| `integrations` | Sonnet | Connections to outside services |
| `finance` | Sonnet | Costs, the budget, pricing proposals (the user decides every price) |
| `canon` | Sonnet | Knowledge, rules, the router, docs, the features catalogue, changelog |
| `reviewer` | Sonnet | Checks every topic before the PM accepts it |
| `helper` | Haiku | Mechanical jobs: search, run tests, summarize logs |
| `planner` | Opus, read-only | A topic that touches several areas, the database schema, sign-in or payments |
| `debugger` | Opus, read-only | The same fix failed twice, or CI is red after two attempts |
| `risk-reviewer` | Opus, read-only | Security, sign-in, payments, production, migrations; the final acceptance of a large topic |

Each Opus call is logged as one line on the topic issue: `Opus <agent> used: <trigger>`.

## Conflict rules

1. Each topic works on its own branch, `seat/topic-<slug>`, in its own folder.
2. The topic issue lists the areas the topic will touch (the path map is in `ROLES.md`).
3. The PM runs topics whose areas overlap one after the other, never side by side.
4. Shared hotspots are changed as a small change landed first and approved by the PM; every other open topic then rebases. The hotspots are listed in `ROLES.md`.
5. At most 2 to 3 topics are open at once.
6. Never leave something unowned. If you cannot tell whose it is, it is the PM's to assign, and the PM assigns it to a topic the same day.
7. The same-change touch stays: a rule may require one change to update a file in another area (a help page, a checklist status, the cost tracker, a lockfile). Make that small edit in the same commit.
8. Decisions for the user on a topic are asked on its issue, one comment per question starting `Decision needed:`, options and a recommendation first. The answer is recorded there as a comment starting `Decided:`.
9. Use judgment. If instructions conflict, pick the sensible reading, note why, and carry on. Stop and ask only for the gates in `FORGE.md` (production, anything that reaches real people, new spend, a public store release, force pushes or deleting history).
