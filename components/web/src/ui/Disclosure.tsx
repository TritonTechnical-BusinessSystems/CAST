import { useState, type ReactNode } from "react";
import { IconChevronRight } from "./Icons";

/** A collapsible row: click the header to reveal body content below it. Each instance owns its own open state; pass onToggle to lazy-load body content the first time it opens. */
export function Disclosure({
  header,
  children,
  defaultOpen = false,
  onToggle,
}: {
  header: ReactNode;
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
      {open && <div className="disclosure-body">{children}</div>}
    </div>
  );
}
