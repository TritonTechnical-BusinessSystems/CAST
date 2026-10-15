# Subagents

Specialists and helpers a topic session (or the PM) calls. Each reads only the canon its job needs; consistency comes from the canon files, not from the prompts. Who owns which area is in `coordination/ROLES.md`. A subagent is not a session: it has no address, returns a written result and stops.

| Agent | Model | Call it when |
|---|---|---|
| `design-ux-frontend` | sonnet | Any UI change (mandatory): screens, styles, tokens, brand, UX rules. |
| `api` | sonnet | Data, schema, migrations, jobs, sign-in and security code, any back end. |
| `integrations` | sonnet | Outside services: mail, phones, payments, third-party APIs. |
| `finance` | sonnet | A cost is added or changed; pricing proposals (the user decides every price). |
| `canon` | sonnet | Knowledge, rules, decisions, docs, the features catalogue, changelog, release notes. |
| `reviewer` | sonnet | Everyday bug and standards review of a diff against the acceptance criteria. Finds, does not fix. |
| `helper` | haiku | Mechanical jobs: search, run tests/lint and summarise failures, summarise logs, file lists. Never edits. |
| `planner` | opus | Start of a topic touching several areas, the schema, sign-in/auth or payments. |
| `debugger` | opus | The same fix failed twice, or CI is still red after two attempts. |
| `risk-reviewer` | opus | Security, sign-in, payments, production, data migrations; and the PM's final acceptance of a large topic. |

## Opus triggers (use sparingly)

- `planner`: several areas, schema, auth or payments.
- `debugger`: two failed attempts at the same problem.
- `risk-reviewer`: security, auth, payments, production, migrations, or final acceptance of a large topic.

Anything else runs on Sonnet or Haiku. The three Opus agents are read-only: they return a plan, a diagnosis with the exact fix, or a verdict, and the Sonnet caller applies it.

## Logging

Every Opus call is logged as one line on the topic issue. Each Opus agent starts its answer with `Opus <agent> used: <trigger>`; post that line.

## Adding or dropping one

A project drops an agent it does not need (no UI: no `design-ux-frontend`; no outside services: no `integrations`) by deleting its file and its row here and in `coordination/ROSTER.md` and `coordination/ROLES.md`. A new specialist is proposed to the user first (`coordination/ROLES.md`, Role proposals).
