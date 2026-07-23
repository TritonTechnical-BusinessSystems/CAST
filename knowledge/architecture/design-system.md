---
status: active
read-when: Writing or reviewing ANY CAST web UI — a screen, a component, or a style. This is the anti-fragmentation contract.
related: [../decisions/0007-web-app-design-system.md, cast-web-app-mockup.md]
updated: 2026-07-23
---

# CAST design system — rules + inventory

One Triton design language across the app. Adopts Logistics Coordinator's palette;
names are CAST's own (intentional, semantic, theme-invariant). This is the
governance SOC wished it had written first — SOC fragmented into six per-page row
classes and 554 inline styles *before* it wrote the rules. We write them first.

## The rules (non-negotiable)
1. **Tokens are the only source** of color/space/type (`styles/tokens.css`). Never
   hardcode a value that belongs in a token. No raw hex/px in components or features.
2. **Reusable-first.** Every repeated UI atom is a `components/web/src/ui/` primitive.
   Never style a raw element unless it's genuinely one-off — and then centralize the
   class in `components.css`, don't inline it.
3. **No per-feature class prefixes** (`.vessel-*`, `.health-*`). Feature pages
   COMPOSE primitives; they never define component classes.
4. **No inline `style=`** except for genuinely runtime-dynamic values (e.g. a gauge
   width from data). Static styling is a class.
5. **Theme-invariant names** (no "navy"/"charcoal") — dark mode is a value override
   in `:root[data-theme="dark"]`.

## Files
- `styles/tokens.css` — tokens (light `:root` + dark override).
- `styles/base.css` — reset, element defaults, a small utility set (row/col/gap/muted…).
- `styles/components.css` — the class contracts the `ui/` primitives apply.
- `ui/` — the React primitive library (the only way to build UI atoms) + `ui/index.ts` barrel.

## Token taxonomy
- Brand: `--color-brand` `-strong` `-wash`, `--color-accent`
- Surfaces: `--color-surface-page` `-surface` `-sunken` `-rail` `-hover`
- Text: `--color-text` `-soft` `-muted` `-faint` `-inverse`, `--color-link`
- Border: `--color-border` `-subtle`, `--color-focus`
- Status: `--color-{success,warning,danger,info}` (+ `-wash`)
- Type: `--font-{heading,body,mono}`, `--text-{xs..3xl}`, `--weight-*`, `--leading-*`
- Scale: `--space-1..12` (4px grid), `--radius-{sm,md,lg,pill}`, `--shadow-{sm,md,lg,focus}`
- Layout/motion/z: `--rail-width` `--topbar-height` `--content-max`; `--ease-*`; `--z-*`

## Primitive inventory (`ui/`)
`Button` · `Card`(+Header/Body/Footer) · `Badge` · `StatusDot` · `Field`(+Input/Select/Textarea/Checkbox)
· `Table` · `EmptyState` · `PageHeader` · `Tabs` · `Gauge` · `Modal` · `Toast`(+`useToast`) · `Banner` · `Spinner` · `Icons`.

**Adding a primitive:** class in `components.css` → thin component in `ui/` → export from `ui/index.ts`.

## Adding a screen
Compose primitives in a `pages/` file. `<PageHeader>` for the header; `<Card>`/`<Table>` for content;
loading → `<Spinner>`, empty → `<EmptyState>`, errors → `<Banner tone="danger">`, feedback → `useToast()`.
