import { useState, type ReactNode } from "react";
import { IconChevronRight } from "./Icons";

/**
 * A collapsible row: click the header to reveal body content below it. Each
 * instance owns its own open state; pass onToggle to lazy-load body content
 * the first time it opens.
 *
 * `subheader` is a second always-visible zone — shown whether collapsed or
 * expanded, but OUTSIDE the clickable `<button>` (unlike `header`). Use it
 * for content a `<button>` can't legally contain (e.g. a `<table>` —
 * interactive/tabular content isn't valid inside a button) or that
 * shouldn't itself be part of the click target.
 */
export function Disclosure({
  header,
  subheader,
  children,
  defaultOpen = false,
  onToggle,
}: {
  header: ReactNode;
  subheader?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  onToggle?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);

  function toggle() {
    const next = !open;
    setOpen(next);
    onToggle?.(next);
  }

  return (
    <div className="disclosure">
      <button type="button" className="disclosure-header" onClick={toggle} aria-expanded={open}>
        <IconChevronRight className={`disclosure-chevron${open ? " open" : ""}`} />
        <div className="disclosure-header-content">{header}</div>
      </button>
      {subheader && <div className="disclosure-subheader">{subheader}</div>}
      {open && <div className="disclosure-body">{children}</div>}
    </div>
  );
}
