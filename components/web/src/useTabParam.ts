import { useSearchParams } from "react-router-dom";

/**
 * Tab state backed by the `?tab=` query param, so a refresh (or a shared link)
 * keeps the user on the same tab instead of snapping back to the first one.
 * Falls back to `fallback` when the param is missing or not a known tab id.
 */
export function useTabParam(ids: string[], fallback: string): [string, (id: string) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const active = raw && ids.includes(raw) ? raw : fallback;
  const setActive = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("tab", id);
    setParams(next, { replace: true }); // refresh-safe without spamming history
  };
  return [active, setActive];
}
