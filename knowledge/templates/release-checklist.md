# Template — Release checklist

Run at each publish. Spec: `../conventions/versioning.md`, `../conventions/changelog-and-releases.md`.

```markdown
## Release: vMAJOR.MINOR.PATCH.CORRECTION — build YYMM###

- [ ] Increment level chosen per the decision tree (MAJOR only if user-authorized)
- [ ] Lower segments reset to 0 on bump
- [ ] CHANGELOG entry added (types + category tags, build, ISO-8601 UTC timestamp)
- [ ] Version + build proposed to user → approved
- [ ] If General Release (MAJOR/MINOR):
  - [ ] Release Notes generated from aggregated changelog since last General Release
  - [ ] Docs/knowledge staleness audit run (docs-and-staleness.md) and recorded
  - [ ] Shipped initiatives moved Open → Complete (with version/build/how)
- [ ] Build artifact carries injected version + build
- [ ] Tag created
```
