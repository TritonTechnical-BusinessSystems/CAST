# Template — Initiative

Process: `../conventions/initiatives.md`. New stable id `INIT-NNNN` (never reused).

## Open entry (in `Initiatives-Open.md`)
```markdown
### INIT-NNNN — <short title>
- **Status:** Captured | Fleshing-out | Deferred · **Source:** User | Suggested (not declined) · **Added:** YYYY-MM-DD
- **Serves:** <who/what goal this advances> · <guiding-heuristic note>
- **Idea:** <the concept>
- **Fleshing-out notes:** <evolving design, decisions, open questions>
- **Related:** <links to knowledge files / ADRs>
```

## On completion → move to `Initiatives-Complete.md`, append:
```markdown
- **Implemented in:** vMAJOR.MINOR.PATCH.CORRECTION · build YYMM### · YYYY-MM-DD
- **What we built:** <outcome>
- **How we got there:** <key decisions/tradeoffs; links to changelog entry, ADRs, knowledge files>
```
