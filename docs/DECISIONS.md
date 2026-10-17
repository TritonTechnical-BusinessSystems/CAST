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

### D-01 — HELM will replace CAST; CAST stays stable until then (2026-10-17, direct, relayed by FORGE Admin)
- **Decided by the user:** HELM (project helm, code TRT-HELM), Triton's new CRM and platform, replaces CAST once CAST's functions are folded into HELM. CAST stays running for reference until then, then is retired; trt-cast-01 becomes HELM's server. "Keep CAST stable, and avoid starting large new CAST features without checking with Matt, since the work will move to HELM."
- **Reported by:** FORGE Admin; **objected:** none
- **So:** nothing on trt-cast-01 changes now. The PM checks with Matt before opening any large new CAST topic; fixes and small changes continue.
- **Owner:** `pm` · **Checklist:** none
- **Follow-ups:** none

### D-02 — ConnectWise API member renamed app_CAST to app_HELM (2026-10-17, direct, relayed by FORGE Admin)
- **Decided by the user:** Matt renamed the member; same key and client ID.
- **Reported by:** FORGE Admin; **objected:** none
- **So:** CAST's live app keeps working; its ConnectWise activity now shows as `app_HELM`. Older docs and the changelog that say `app_CAST` are historical and stay as written.
- **Owner:** `pm` · **Checklist:** none
- **Follow-ups:** none
