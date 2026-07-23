import type { ReactNode } from "react";

/**
 * `embedded` omits the big page title — use it when the view is already named by
 * an enclosing tab (e.g. inside the Vessel Tracking section), so the same name
 * isn't shouted twice. The subtitle + actions row stays for consistent anatomy.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  embedded,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  embedded?: boolean;
}) {
  return (
    <div className="page-header">
      <div>
        {!embedded && <h1 className="page-title">{title}</h1>}
        {subtitle && <div className="page-subtitle">{subtitle}</div>}
      </div>
      {actions && <div className="row gap-2">{actions}</div>}
    </div>
  );
}
