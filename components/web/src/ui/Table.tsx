import type { ReactNode } from "react";

/** Horizontally-scrollable table shell. Compose <thead>/<tbody> inside. */
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="table-wrap">
      <table className="table">{children}</table>
    </div>
  );
}
