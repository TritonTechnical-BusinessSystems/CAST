import type { SortState } from "../useSortFilter";

/**
 * A `<th>` combining a sort-toggle label with an optional per-column filter
 * input — the reusable header cell behind `useSortFilter` (INIT-0026's
 * ported/rebuilt `HeaderCell.jsx`). Omit `onFilterChange` for a sort-only
 * column (e.g. a numeric "Items" count with no useful free-text filter).
 */
export function SortableHeaderCell({
  label,
  sortKey,
  sort,
  onSort,
  filterValue,
  onFilterChange,
}: {
  label: string;
  sortKey: string;
  sort: SortState;
  onSort: (key: string) => void;
  filterValue?: string;
  onFilterChange?: (value: string) => void;
}) {
  const active = sort.key === sortKey;
  return (
    <th className="sortable" onClick={() => onSort(sortKey)}>
      <button type="button" className="th-sort-btn">
        {label}
        {active && <span aria-hidden="true">{sort.dir === "asc" ? "▲" : "▼"}</span>}
      </button>
      {onFilterChange && (
        <input
          className="th-filter-input"
          placeholder={`Filter…`}
          value={filterValue ?? ""}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onFilterChange(e.target.value)}
        />
      )}
    </th>
  );
}
