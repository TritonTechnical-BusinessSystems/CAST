/**
 * CAST shared configuration schema.
 *
 * Single source of truth for the rules/config JSON that the CAST web app
 * AUTHORS and the CAST browser extension CONSUMES. Both sides validate
 * against this one definition so the contract can't drift — the reason CAST
 * is a monorepo (see knowledge/decisions/0004 and 0005).
 *
 * Design basis: knowledge/architecture/browser-extension.md §5-6.
 * Terms follow knowledge/conventions/naming-lexicon.md.
 *
 * NOTE: the expected-pod portion of the schema is not finalized — see
 * INIT-0004. Treat `expectedPods` below as a first candidate shape.
 */
import { z } from "zod";

/** A stable, semantic ConnectWise CSS selector (e.g. `pod_service_ticket_company`). */
export const Selector = z.string().min(1);

/**
 * ConnectWise screen type (Ticket, Configuration, Company, Opportunity, …).
 * Left as an open string, not an enum: CW screens vary and new ones appear.
 * Confirmed: rules and expected pods are per-screen-type, not just per-role.
 */
export const ScreenType = z.string().min(1);

/** Reorder within a flex/grid container (nav bars, toolbars) — NOT pods. */
export const OrderRule = z.object({
  selector: Selector,
  order: z.number().int(),
});

/** Relocate an element (used for table-based pods, which `order` can't move). */
export const MoveRule = z.object({
  selector: Selector,
  targetSelector: Selector,
  position: z.enum(["before", "after", "append"]),
});

/** The four rule kinds the extension applies for one scope. */
export const RuleSet = z.object({
  hide: z.array(Selector).default([]),
  show: z.array(Selector).default([]),
  order: z.array(OrderRule).default([]),
  move: z.array(MoveRule).default([]),
});
export type RuleSet = z.infer<typeof RuleSet>;

/** Rules bucketed by screen type. */
export const ScreenScopedRules = z.record(ScreenType, RuleSet);

/**
 * Per-screen-type expected-pod lists — drives the missing-pod banner
 * (browser-extension.md §6). Shape provisional — INIT-0004.
 */
export const ExpectedPods = z.record(ScreenType, z.array(Selector));

/** A security role's configuration. */
export const RoleConfig = z.object({
  /** Optional department base layer applied before this role's own rules. */
  department: z.string().optional(),
  screens: ScreenScopedRules.default({}),
  expectedPods: ExpectedPods.default({}),
});
export type RoleConfig = z.infer<typeof RoleConfig>;

/**
 * Canonical, semantic visual-element name (e.g. "pod", "podHeader") — CAST's
 * own vocabulary for elements of the ConnectWise UI, not ConnectWise's own.
 * ConnectWise has no stable semantic layer (the same visual "pod" shows up as
 * `div.podborder`, `table.podborder`, or `.myactivities` depending on the
 * screen) — the extension's selector registry (content.js) maps each of
 * these names to every raw CW selector known to resolve to it. This schema
 * only ever sees the canonical name and its token values, never raw
 * selectors, so the customization UI (INIT-0008) never has to show CSS.
 * Left open (not an enum): new components get discovered as more CW screens
 * are covered — see knowledge/architecture/browser-extension.md §9.
 */
export const SkinComponentName = z.string().min(1);

/**
 * Customizable visual properties for one skin component. All optional —
 * an unset field falls back to the extension's built-in default for that
 * component, so a partial override (e.g. just `borderRadius`) is valid.
 */
export const SkinTokenValues = z
  .object({
    background: z.string(),
    color: z.string(),
    border: z.string(),
    borderBottom: z.string(),
    borderRadius: z.string(),
    boxShadow: z.string(),
    fontFamily: z.string(),
    fontWeight: z.string(),
    fontStretch: z.string(),
    /** CSS `font-optical-sizing` ("auto" | "none") — only meaningful for a
     * variable font whose axes include `opsz` (e.g. Inter); ignored (not an
     * error) by fonts that don't expose that axis. */
    fontOpticalSizing: z.string(),
  })
  .partial();
export type SkinTokenValues = z.infer<typeof SkinTokenValues>;

/**
 * The full-app visual skin — one token set per canonical component, applied
 * everywhere that component's selector registry matches. Independent of the
 * hide/show/order/move rule engine above (`RuleSet`): the skin is always-on
 * visual restyling, not role/department-scoped structural change.
 */
export const Skin = z.object({
  /** Skin version tag, separate from the rules `version` — a font/color
   * tweak shouldn't require re-tagging unrelated role rules. */
  version: z.string().min(1),
  components: z.record(SkinComponentName, SkinTokenValues).default({}),
});
export type Skin = z.infer<typeof Skin>;

/**
 * The complete config the extension fetches and applies.
 * `version` is the settings/rules tag reported in the check-in catalog
 * (extension-telemetry-and-identity.md §3).
 */
export const CastConfig = z.object({
  /** Rules/settings version tag, e.g. "v14". */
  version: z.string().min(1),
  /** Department base layers, keyed by department name. */
  departments: z.record(z.string(), ScreenScopedRules).default({}),
  /** Role-specific configuration, keyed by security role name. */
  roles: z.record(z.string(), RoleConfig).default({}),
  /** Full-app visual skin — optional; the extension falls back to its
   * built-in defaults for any component (or the whole skin) left unset. */
  skin: Skin.optional(),
});
export type CastConfig = z.infer<typeof CastConfig>;

/** Parse + validate unknown input into a CastConfig (throws on invalid). */
export function parseCastConfig(input: unknown): CastConfig {
  return CastConfig.parse(input);
}
