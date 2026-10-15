# Running on FORGE seats

Read this if the project's sessions run as FORGE seats (`$FORGE_SEAT` is set in your shell). Where this file and the
rest of `coordination/` differ, **this file wins on FORGE**; everything else applies as written. The working model is
Matt's, approved 2026-10-15.

## Where this runs
- FORGE hosts the project (`~/projects/FORGE/CANON.md`). The project is registered with `forge-project`
  (`forge-project list` is the live source). Credentials are per project: `~/projects/FORGE/credential-hygiene.md`.
  Check which GitHub account and key the project uses before you push; never assume the shell's default.

## Sessions
- Three kinds of seat: the **PM** (never parks), **infra** (parks when idle) and one **topic** per piece of work (never
  parks, retires when merged). Specialists are subagents in `.claude/agents/` (`.claude/agents/README.md`), not seats.
  A project with a device or machine FORGE cannot host (a Mac for an iPhone app, say) adds one session on that
  machine, started by hand and directed by the PM. Who is who: `ROSTER.md`.
- Models: Sonnet by default for every seat. Opus is used only through the `planner`, `debugger` and `risk-reviewer`
  subagents, on the triggers in `ROSTER.md` and `.claude/agents/README.md`; log each Opus call as one line on the topic
  issue. Which model a seat runs on, and which secrets and websites it may use, are FORGE's decisions
  (`catalog/grants/<CODE>.yaml` on FORGE); a `model:` line in `forge-roles.yaml` is ignored.

## Titles and addresses
- FORGE starts each seat and titles it `<CODE> 🔸 <icon> <role or name>`: `<CODE> 🔸 🧑‍💼 PM`, `<CODE> 🔸 🛠️ infra`,
  `<CODE> 🔸 🔵 Pricing page`. Icons: 🧑‍💼 the PM, 🛠️ a standing role, 🔵 a topic, ⚪ a session with no seat and no
  topic. **Never rename a seat** (no `/rename`, no `set_session_title`): renaming changes its message address and
  teammates lose it. Ignore any older title form you meet in the docs.
- A seat's address is `<code>-<role>` in lower case: `<code>-pm`, `<code>-infra`, `<code>-topic-<slug>`. Message with
  SendMessage by address. A fresh app entry with the right title comes from `forge-seat renew`, never a rename.

## Parking and waking
- **The PM and topic seats never park.** `infra` parks after two idle hours (memory freed, conversation kept).
- Before messaging a parked seat, `forge-seat wake <project> infra`. A message is the fast path.
- An open issue labelled `role:infra` that is new or has changed also wakes a parked `infra` within about 10 minutes.

## Git works as usual
- `git pull` brings your branch up to date with main. `git push origin HEAD:main` lands your work; FORGE routes the
  push through the gatekeeper on its own. You do not run `forge-seat sync` or `forge-do request ship-to-main` by hand.
- Your folder is your own working copy of the one shared repository, on branch `seat/topic-<slug>` for a topic.
  Commit small and often.
- When a pull brings new project settings or subagents (`.claude/`), FORGE restarts your seat as soon as your turn
  ends (conversation kept), so they take effect. Nobody needs to ask the PM.
- You may add or change dependencies yourself (`pnpm add`, `pnpm install`): the package stores are writable.
- Need a key, token or password? `forge-seat secret <project> <NAME>... --why "..."` asks Matt on his dashboard; when
  he pastes it, FORGE writes the project's `.env.<name>` file, lets you read it and restarts you. Never ask him to
  copy files or open a terminal.
- Seats have no Claude memory folder (Matt, 2026-10-15). Lasting knowledge goes in the repo, in the file that owns
  it (one home per fact); work in progress goes in your checkpoint.
- Message other sessions by name (`<code>-<role>`), never by a `.sock` path: those change when a session restarts.

## Judgment: pick the sensible reading and carry on (Matt, 2026-10-15)
- Sessions are empowered to get the job done. If two instructions conflict, or one does not fit the situation, pick the
  sensible reading, note why in your checkpoint or on the issue, and carry on. Do not drop a rule quietly; say which
  reading you took.
- **Stop and ask only for:**
  - production, once the project is released (until then production steps are pre-approved; see Production);
  - anything that reaches real people: texts, calls, email;
  - new spend;
  - a public store release;
  - force pushes, or deleting branches or history.
- Standing approvals still count. Production steps go to `infra` and the gatekeeper with Matt's approval.

## What waits on Matt (the PM's list)
- The PM keeps **one list of everything waiting on Matt** in the project and sets it with
  `forge-seat asks <project> <file>` (read it back with `forge-seat asks <project> --show`); FORGE shows it in the dashboard's "Waiting on you" tile and pushes each new
  item to his phone. Topics and `infra` send their asks to the PM, not to Matt.
- When something waits on Matt, carry on with other work: FORGE tells the session that asked the moment he answers
  (his answer, a provided secret, or a gatekeeper decision with its output). Don't poll. In the PM's list, `from`
  names the asking seats, so they hear his answer too.
- Matt answers on his dashboard; his answer arrives in the PM's session as his own message ("Matt, from the FORGE
  dashboard, answering your item ..."). Act on it as his direct word, record it, and remove the item. Your reply is shown under the
  item on his dashboard, so write it about that item only: no list counts or status footers. Keep `what`
  short: it is the one line he sees in the list.
- Each item is plain English: what, why, impact, urgent, options, if_not, where to answer, from; plus `due` (a date)
  and `sensitive` (true/false), which turn it red on his dashboard when due within 48 hours or sensitive. To follow
  up after his answer, change the item: it turns violet for him. Remove it once resolved. Never lead with an
  ID. Keep each item's `id` stable, remove it as soon as it is answered, and never repeat gatekeeper approvals
  (those are listed separately). Details: the forge:seat-tools skill.

## Topics
- Matt types `/topic <name>` **in the PM session**. The PM starts the topic as its own seat with
  `forge-seat topic <project> "<Name>" --prompt "<goal>"`; it is titled `<CODE> 🔸 🔵 <Name>`, opens its issue (goal,
  acceptance criteria, the areas it will touch), checks in with the PM by address and builds the work. When it is
  merged and the PM has accepted it, the PM retires it (`forge-seat retire <project> topic-<slug>`).
- Conflicts between topics: see the conflict rules in `ROSTER.md` (own branch, areas listed, overlapping topics one
  after the other, hotspots landed first, at most 2 to 3 open).

## Production
- Production steps go to `infra`, the only session with production credentials; it files them with the gatekeeper in
  plain English (`forge-do request ...`; `forge-do actions` lists the actions that exist and who approves each) and
  carries them out itself once approved. Until Matt announces the project's production release, production steps are
  pre-approved (`production-step` runs at once); the exceptions always wait for him (`production-step-matt`): anything
  that reaches real people, new spend, a public store release, deleting customer data (Matt, 2026-10-15).
