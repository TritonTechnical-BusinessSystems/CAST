# ADR 0007 — CAST web app design system

**Status:** Accepted · 2026-07-23
**Related:** `../architecture/design-system.md`, `0006-web-app-stack-vite-react-express.md`

## Context
CAST needs a consistent UI. Two org references were studied:
- **Logistics Coordinator** — Vite+React, plain CSS + `:root` tokens, light-only,
  Triton blue `#0071BC` + charcoal `#303336` rail, Open Sans + Inter. Clean, but its
  token *names* drifted (e.g. `--color-surface` vs `--color-bg-surface`).
- **SOC** — same architecture, but fragmented into six per-page row classes, badges
  reinvented per page, and 554 inline styles. It wrote its design-system governance
  *after* the drift, when it was expensive to claw back.

The user asked to align with LC visually and apply SOC's lessons.

## Decision
1. **Adopt LC's palette values** (Triton blue, charcoal rail, Open Sans + Inter) — no
   third Triton style. CAST's mockup navy/teal is retired.
2. **Define CAST's own token names** — intentional, semantic (job-named),
   theme-invariant. Not inherited from LC unexamined.
3. **Deliver via React primitives** (`ui/`, SOC's good pattern) applying centralized
   component classes — NOT per-feature classes. A primitive is harder to bypass.
4. **Write governance first** (`../architecture/design-system.md`): tokens-only,
   reusable-first, no per-feature classes, no non-dynamic inline styles.
5. **Light ships now; dark built-ready** as a populated `:root[data-theme="dark"]`
   override, flipped on later.

## Consequences
- (+) One Triton design language; feature screens are pure composition.
- (+) SOC's fragmentation is structurally prevented, not just discouraged.
- (−) `components.css` grows per primitive — acceptable (centralized, reviewed).
- (−) CAST maintains its own dark palette (LC has none to copy).
