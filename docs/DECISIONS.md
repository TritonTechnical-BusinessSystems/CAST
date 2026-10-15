---
status: active
read-when: A meeting has ended and its decisions need recording, a rule was decided, or someone says "we agreed this".
related: [../coordination/PM.md, ../coordination/ROLES.md]
updated: 2026-10-15
---

# Decisions

One record for every decision the user makes in a PM meeting (`coordination/PM.md`, Meetings) or directly to the PM. The PM writes entries and quotes the user's words. Ids run in one sequence, `D-01`, `D-02`, ...; the next free id is the one after the highest below. If the project keeps decisions elsewhere too (for example a rules review), continue that sequence rather than starting a second. A decision that changes a rule is also sent to the role that keeps the rules, so the rule file stays the one home of the rule.

Entry shape:

```
### D-NN — <title> (YYYY-MM-DD, meeting issue <n> or "direct")
- **Decided by the user:** <their words, or the option chosen>
- **Reported by:** <roles that spoke>; **objected:** <role and reason, or none>
- **So:** <what now changes, in one line>
- **Owner:** <role> · **Checklist:** <row id or goal, if the project keeps a checklist>
- **Follow-ups:** <requests posted, issue numbers>
```

## Log

None yet. Example of the shape (delete when the first real entry is written):

### D-01 — EXAMPLE: weekly status goes out on Mondays (2026-10-15, direct)
- **Decided by the user:** "Monday morning, short, only what is stuck."
- **Reported by:** none; **objected:** none
- **So:** the PM posts the status each Monday and leads with what is stuck.
- **Owner:** `pm` · **Checklist:** none
- **Follow-ups:** none
