import type { SVGProps } from "react";

/** Inline SVG icon set (no icon library). Stroke-based, inherits currentColor. */
type P = SVGProps<SVGSVGElement>;
function svg(p: P) {
  return {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...p,
  };
}

export const IconGrid = (p: P) => (
  <svg {...svg(p)}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></svg>
);
export const IconShip = (p: P) => (
  <svg {...svg(p)}><path d="M3 15l1.5 5.5a2 2 0 0 0 2 1.5h11a2 2 0 0 0 2-1.5L21 15" /><path d="M5 15V9a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6" /><path d="M12 3v4M8 15V7M16 15V7" /></svg>
);
export const IconRoute = (p: P) => (
  <svg {...svg(p)}><circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" /><path d="M8 19h6a4 4 0 0 0 0-8H10a4 4 0 0 1 0-8h6" /></svg>
);
export const IconPlug = (p: P) => (
  <svg {...svg(p)}><path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0z" /><path d="M12 17v5" /></svg>
);
export const IconActivity = (p: P) => (
  <svg {...svg(p)}><path d="M3 12h4l3 8 4-16 3 8h4" /></svg>
);
export const IconCheck = (p: P) => (<svg {...svg(p)}><path d="M20 6L9 17l-5-5" /></svg>);
export const IconX = (p: P) => (<svg {...svg(p)}><path d="M18 6L6 18M6 6l12 12" /></svg>);
export const IconAlert = (p: P) => (
  <svg {...svg(p)}><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></svg>
);
export const IconSearch = (p: P) => (<svg {...svg(p)}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>);
export const IconExternal = (p: P) => (
  <svg {...svg(p)}><path d="M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>
);
export const IconRefresh = (p: P) => (
  <svg {...svg(p)}><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>
);
export const IconLogout = (p: P) => (
  <svg {...svg(p)}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></svg>
);
export const IconLock = (p: P) => (
  <svg {...svg(p)}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
);
export const IconMenu = (p: P) => (
  <svg {...svg(p)}><path d="M3 6h18M3 12h18M3 18h18" /></svg>
);
export const IconPin = (p: P) => (
  <svg {...svg(p)}><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z" /><circle cx="12" cy="11" r="2.5" /></svg>
);
export const IconDownload = (p: P) => (
  <svg {...svg(p)}><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
);
