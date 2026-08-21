import { useEffect, useRef, useState } from "react";
import { IconMoreVertical } from "./Icons";

export interface MenuItemDef {
  label: string;
  onSelect: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
}

/**
 * A "3 dots" overflow menu — for actions that shouldn't sit as a permanent,
 * prominent button on a card (e.g. a destructive one), matching how most
 * design systems keep "delete"/"clear" out of primary button real estate
 * (user, 2026-08-21: "'Clear credentials' shouldn't be a big red button
 * available on these. Let's just go with a simple '3 dots' edit button").
 * Closes on outside click, Escape, or selecting an item.
 */
export function Menu({ items, label = "More actions" }: { items: MenuItemDef[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="menu-root" ref={rootRef}>
      <button type="button" className="menu-trigger" aria-label={label} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <IconMoreVertical />
      </button>
      {open && (
        <div className="menu-panel" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`menu-item${item.tone === "danger" ? " menu-item-danger" : ""}`}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
