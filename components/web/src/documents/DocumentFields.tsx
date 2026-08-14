import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

// Print mode swaps every editable field to a plain read-only span — this is
// what makes `/print/ci/:id` and `/print/pl/:id` render the exact same
// component the interactive Documents tab uses, just non-interactively
// (INIT-0026 Phase 3, mirrors LC's `printMode` prop exactly).
const PrintModeCtx = createContext(false);
export const PrintModeProvider = PrintModeCtx.Provider;
export function usePrintMode() {
  return useContext(PrintModeCtx);
}

/** A text field that saves on blur (immediate per-field PATCH, no batch save — matches LC exactly). */
export function EditField({
  value,
  onSave,
  placeholder,
  multiline,
}: {
  value: string;
  onSave: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  const printMode = usePrintMode();
  const [draft, setDraft] = useState(value);
  if (printMode) return <span className="doc-value">{value || " "}</span>;
  const commit = () => {
    if (draft !== value) onSave(draft);
  };
  return multiline ? (
    <textarea className="doc-input doc-input-multiline" value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
  ) : (
    <input className="doc-input" value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
  );
}

/** A select field that saves immediately on change (not on blur — matches LC). */
export function SelectField({
  value,
  options,
  onSave,
  displayValue,
}: {
  value: string;
  options: string[];
  onSave: (value: string) => void;
  displayValue?: string;
}) {
  const printMode = usePrintMode();
  if (printMode) return <span className="doc-value">{displayValue ?? value ?? " "}</span>;
  return (
    <select className="doc-input" value={value} onChange={(e) => onSave(e.target.value)}>
      <option value="" />
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

export function DocCard({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="doc-card">
      <div className="doc-card-header">
        <span>{title}</span>
        {action}
      </div>
      <div className="doc-card-body">{children}</div>
    </div>
  );
}
