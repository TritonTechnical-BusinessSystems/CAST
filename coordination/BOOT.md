---
status: active
read-when: A session compacts, breaks or must be replaced, or a session needs a checkpoint.
related: [ROLES.md, PM.md, SESSIONS.md, COMMS.md, ROSTER.md, FORGE.md]
updated: 2026-10-15
---

# Keeping, checkpointing and replacing sessions

A session's memory is its checkpoint, the open issues and the repo, so a session can be replaced at any time without losing the work. This file is how to do that, the same way every time. The sessions are the PM, `infra`, and one topic per piece of work (`ROSTER.md`).

## Sessions persist and compact

A session keeps running. When its context fills, the tool compacts it; the session keeps its id, title, mode, tools and reachability. There is no rotation on a token threshold. Progress is read from git, not from memory: commits on the main branch say what moved, and every commit names its work plainly.

**Checkpoint (after each finished task).** The PM and `infra` keep one checkpoint comment on their seat issue (`node scripts/coord.mjs seat checkpoint <role> --note "..."`); a topic keeps it on its topic issue (`coord.mjs comment <topic issue> --body "CHECKPOINT ..."`). Replace it as things change. Five lines at most:
- the last commit that is yours (sha), and anything pushed but unmerged (branch);
- each open loop and what it waits on (who, which issue or `D-` id);
- the addresses it messages most;
- anything held only in a message (a number, a value from the user), named and with who re-supplies it, never the value;
- the next exact step.

Also write there any judgment call you made: which reading of conflicting instructions you took, and why.

**After a compaction**, before acting: `node scripts/coord.mjs whoami` (it prints your role and checkpoint if you have lost them; on FORGE your address is `$FORGE_SEAT`); fetch the main branch and check how far behind your folder is (`git pull` to catch up); read the log of the main branch since the checkpoint's sha; re-read your checkpoint and your issue, and, for the PM, `OPEN-LOOPS.md`. Never trust the summary on what the user decided: confirm it in `DECISIONS.md` or the user's own words.

**Context window per session.** Use a larger window only where a session must hold large reads at once. The default is cheaper per turn and better for most work.

## Replace a session only when

- it is broken: the PM cannot reach it (no reply to a direct message, no activity on its issue after a day), it runs in the wrong mode, or it lacks a tool it needs;
- the work moves to a different session.

Do not replace a session in the middle of a task. Let it finish or reach a commit, then hand off. A session that can only run on one machine (a device or signing toolchain) is replaced on that machine by the user.

## The steps

1. **Wrap up.** Message the old session: commit and push what is finished, leave unfinished work on a named branch, write a final checkpoint (what is in flight, what waits on whom, where the branch is, gotchas; for a seat also `seat handoff <role> --note "..."`), and reply "handed off".
2. **Replace.** On FORGE a fresh seat with the same address and title comes from `forge-seat renew <project> <role or topic-slug>`; never rename. Outside FORGE, start a new session (the spare, if the project keeps one, or one the user starts) and send it the boot prompt below.
3. **Archive** the old session (read-only, its history is kept) if your tool offers it.
4. **Verify** the new session: it reads the checkpoint, and replies to the PM. Then update `ROSTER.md` and `SESSIONS.md` (reachable date) and `OPEN-LOOPS.md` (the asks it now owes).

## The boot prompt

Replace `<name>` and `<PM address>`. On FORGE the real prompt is generated from `forge-roles.yaml` for the PM and `infra`, and from `forge-seat topic ... --prompt` for a topic; this is the content it carries.

> You are the `<name>` session for CAST. Read `CLAUDE.md`, `coordination/ROSTER.md` and `coordination/COMMS.md`; on FORGE also `coordination/FORGE.md`; the PM also reads `coordination/PM.md`. Take your seat (PM and infra: `node scripts/coord.mjs seat take <role>`; a topic: read your topic issue) and read your last checkpoint. Work in your own folder on your own branch; update it from the main branch and land work there (on FORGE: `git pull`, then `git push origin HEAD:main`). Pick the sensible reading when instructions conflict and note why; stop and ask only for production, anything that reaches real people, new spend, a public store release, and force pushes or deleting branches or history. Call the subagents in `.claude/agents/` for specialist parts. Accept and answer direct messages from the other sessions, always. Then send the PM (`<PM address>`) `ack <name>` with your title and one short line: what you picked up, what is in flight, what you are waiting on, and wait for the reply. Keep your checkpoint current after each finished task, and after a compaction re-read it, `git log` and your issue before acting. Titles: on FORGE never rename (FORGE set yours); elsewhere set `<CODE> 🔸 <icon> <name>` once.

## The roster check (the PM's weekly and every status report)

The PM reads each session's status, context used and last update. It checks each session: a title that says paused or waiting, an idle session with open work, a session whose checkpoint is older than its last commit, a topic with no live session. These go to the user first, with the way forward, before anything that is going well.
