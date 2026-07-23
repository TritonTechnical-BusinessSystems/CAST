import type { ReactNode } from "react";

type Tone = "info" | "warning" | "danger" | "success";

/** Inline notice strip. Tone maps to the semantic status tokens. */
export function Banner({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return <div className={`banner banner-${tone}`}>{children}</div>;
}
