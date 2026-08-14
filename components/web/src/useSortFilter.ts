import { useMemo, useState } from "react";

export interface SortState {
  key: string;
  dir: "asc" | "desc";
}

/**
 * Client-side sort + per-column filter over an already-fetched row array —
 * the reusable behavior behind LC's `HeaderCell.jsx` (INIT-0026), needed
 * identically across the Outbound Shipment list, Receiving's browse tabs,
 * and the packing workspace's product pool. `accessors` maps a column key
 * to a string extractor; numeric-aware comparison (`localeCompare` with
 * `numeric: true`) so "2" sorts before "10".
 */
export function useSortFilter<T>(rows: T[], accessors: Record<string, (row: T) => string>, initialSort: SortState) {
  const [sort, setSort] = useState<SortState>(initialSort);
  const [filters, setFilters] = useState<Record<string, string>>({});

  const toggleSort = (key: string) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  };

  const setFilter = (key: string, value: string) => setFilters((f) => ({ ...f, [key]: value }));
  const clearFilters = () => setFilters({});
  const activeFilterCount = Object.values(filters).filter((v) => v.trim() !== "").length;

  const filtered = useMemo(() => {
    let out = rows;
    for (const [key, val] of Object.entries(filters)) {
      const needle = val.trim().toLowerCase();
      if (!needle) continue;
      const acc = accessors[key];
      if (!acc) continue;
      out = out.filter((r) => acc(r).toLowerCase().includes(needle));
    }
    const acc = accessors[sort.key];
    if (acc) {
      out = [...out].sort((a, b) => {
        const cmp = acc(a).localeCompare(acc(b), undefined, { numeric: true });
        return sort.dir === "asc" ? cmp : -cmp;
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filters, sort]);

  return { sort, toggleSort, filters, setFilter, clearFilters, activeFilterCount, filtered };
}
