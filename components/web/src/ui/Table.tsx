import type { ReactNode } from "react";

/** Horizontally-scrollable table shell. Compose <thead>/<tbody> inside. */
export function Table({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className="table-wrap">
      <table className={`table ${className}`.trim()}>{children}</table>
    </div>
  );
}
