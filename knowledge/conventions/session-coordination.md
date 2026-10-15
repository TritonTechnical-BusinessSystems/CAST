---
status: active
read-when: Starting a session, opening or closing a topic, finishing work another area depends on, needing something from another area, taking over or leaving a seat, or proposing a new role.
related: [../../coordination/ROLES.md, ../../coordination/PM.md, ../../coordination/ROSTER.md, ../../docs/DECISIONS.md, docs-and-staleness.md]
updated: 2026-10-15
---

# Session coordination

Many sessions build in parallel and cannot talk to each other live. They coordinate through **GitHub Issues** on this repository, through `scripts/coord.mjs`, and through direct messages.

## The sessions

Three kinds, plus the specialists they call (`coordination/ROSTER.md`):

- **PM** (`pm`): the user's single point of contact. Keeps the board and the list of what waits on the user, opens and closes topics, accepts finished work against its acceptance criteria. Owns no code and decides nothing. Handbook: `coordination/PM.md`.
- **infra** (`infra`): the only holder of production credentials; runs each approved production step. Every topic that needs a production step asks `infra`.
- **Topic**: one session per piece of work. It **builds** the work end to end in its own folder, on its own branch (`seat/topic-<slug>`), and retires when merged and accepted.
- **Subagents** in `.claude/agents/` (index: `.claude/agents/README.md`) are the specialists: design-ux-frontend (mandatory for any UI change), api, integrations, finance, canon, reviewer and helper on Sonnet or Haiku; planner, debugger and risk-reviewer on Opus, read-only, on their triggers. A topic calls them; they return a written result and stop. Sonnet by default; each Opus call is logged as one line on the topic issue.

## Seats

`pm` and `infra` are **seats**: each has one **seat issue** (`Seat: <role>`) whose comments are its memory: `HOLDER` when a session takes it, `HANDOFF` and `CHECKPOINT` notes. A new session takes a seat with `seat take`, reads the last checkpoint, and carries on. Session names are only a trace in the comments.

## The loop

1. **Start:** PM and infra run `node scripts/coord.mjs seat take <role>`, then `list --role <role>`. A topic reads its topic issue.
2. **Need something from another session** (mostly between the PM, infra and topics): `post --to <role> --from <role> --title ...` (add `--refs` with a backlog or checklist id, or `topic#<n>`).
3. **Take a request:** `claim <n> --as <role>`. The earliest `CLAIM` comment wins; the claim is checked after posting, so a lost race is reported, not hidden.
4. **Finish:** `done <n> --as <role> --note "what changed, where"` (closes it). Cannot finish: `release`.
5. **Checkpoint:** after each finished task, replace your one `CHECKPOINT` comment (at most five lines: last commit, open loops and what they wait on, who you message, anything held only in a message, the next exact step).
6. **Leave:** a seat runs `seat handoff <role> --note "in flight, next, watch out for"`, only when the PM asks or the seat is retired.

**Sessions persist and compact.** A session keeps running; when context fills it compacts and keeps its id, title and reachability. After a compaction, fetch the main branch, read `git log` since the checkpoint's sha, and re-read your checkpoint and your issue before acting; confirm what the user decided in `DECISIONS.md`, not from a summary. Replace a session only when it is broken (unreachable, wrong mode, missing a tool), never mid-task. Steps and the boot prompt: `coordination/BOOT.md`.

**Lost your context** (after `/clear` or a bad compaction): `node scripts/coord.mjs whoami`. On FORGE your address is `$FORGE_SEAT`.

## Topics

A **topic** is one session and one GitHub issue labeled `topic`, started with `/bmdev:topic <name>` (on FORGE typed in the PM session, which starts it with `forge-seat topic <project> "<Name>" --prompt "<goal>"`) and titled `<CODE> 🔸 🔵 <Name>`. The issue holds the goal, the acceptance criteria, the areas the topic will touch, the decisions, what is done and what waits on whom. The topic builds the work itself, calls the subagents for specialist parts, and asks `infra` for production steps. Decisions for the user are asked on its issue, one comment per question starting `Decision needed:`, options and a recommendation first; the answer is recorded as `Decided:`. When the work is merged and the reviewer (and, where the triggers say, the risk-reviewer) has checked it, the PM accepts it against the acceptance criteria and retires the session. The PM lists open topics in `coordination/ROSTER.md`; the board is `node scripts/coord.mjs topics`.

**Conflicts between topics.** The topic issue lists the areas it will touch (the path map is in `coordination/ROLES.md`). Overlapping topics run one after the other. Shared hotspots land first as a small change the PM approves; every other open topic rebases. At most 2 to 3 topics are open at once. Nothing is left unowned: what no one can place, the PM assigns to a topic the same day.

## Titles

Every session is titled `<CODE> 🔸 <icon> <role or name>`: 🧑‍💼 PM, 🛠️ standing roles (infra), 🔵 topics, ⚪ a session with no seat and no topic. On FORGE the title is set by FORGE and seats never rename; elsewhere a session sets its own in this form (`coordination/ROLES.md`, Naming).

## Judgment

Sessions are empowered to get the job done. If instructions conflict, pick the sensible reading, note why in your checkpoint or on the issue, and carry on. Stop and ask only for: production (deploys, production data changes); anything that reaches real people (texts, calls, email); new spend; a public store release; force pushes or deleting history. Standing approvals still count.

## Reachability

Every session of the project accepts direct messages from the other sessions of the project and can send them, always, in addition to the Issues. Issues are the record; messages wake sessions and let them work together. Message by address or session id (`coordination/ROSTER.md`), never by name. The PM tests it with a ping and records the last confirmed reply in `coordination/SESSIONS.md` (see `coordination/PM.md`, Reachability).

## Rules

- Never edit work another topic has claimed; post a comment on its issue instead.
- A claim quiet for 48 hours shows as `STALE` and any session may take it over.
- Finishing work that changes another topic's area is itself a post to that topic or to the PM.
- Issues point to the backlog and checklist ids; they do not replace them. What must happen for the project lives in the checklist and backlog; who is doing what right now lives here.
- Never put secrets, tokens or client data in an issue.
- **New specialists are proposed, not created silently.** The PM recommends one as the need arises and proposes it to the user (`proposal post`); the user approves, defers or denies (`proposal decide`). A new specialist is a subagent in `.claude/agents/`, not a seat. Deferred ones wait in the `ROLES.md` table with the trigger that would bring them in.

## Setup

The repository is read from `git remote get-url origin` (override with `--repo owner/name` or `COORD_REPO`). The token is `GH_TOKEN`, else the file named by `COORD_TOKEN_FILE`, else `.env.github` in the main checkout (git-ignored), else `gh auth login`. Labels: `coord`, `claimed`, `role-seat`, `role-proposal`, `topic`, and `role:<id>` per seat.

## The /pm skill

`/bmdev:pm` is the user's handle on all of this: `checkin` (a session reports in), `checkin all` (ask every session of this project to), `report`, `update` (the current picture: seats, topics, requests, who has answered), `meeting <topic>` and `roles` proposals. `/bmdev:topic <name>` opens a topic.
