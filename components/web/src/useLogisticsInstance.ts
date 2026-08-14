import { useState } from "react";
import { useSearchParams } from "react-router-dom";

const STORAGE_KEY = "cast.logistics.instance";

/**
 * Resolves which CW instance the current Logistics page operates against.
 *
 * Precedence: URL `?instance=` first, then the last interactively-chosen
 * value (localStorage), then `fallback`. The URL takes priority because a
 * copied embed link needs to be self-contained — it's typically opened in a
 * browser context (a CW iframe, a colleague's machine) with no matching
 * localStorage state, so a link that only encoded the instance in
 * localStorage would silently open the wrong (or default) instance instead
 * of the one it was generated for. `setInstance` writes both, so the current
 * choice is remembered for next time AND the URL stays shareable/bookmarkable.
 */
export function useLogisticsInstance(fallback = ""): [string, (id: string) => void] {
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get("instance");
  const [stored, setStored] = useState(() => localStorage.getItem(STORAGE_KEY) ?? "");
  const instance = fromUrl || stored || fallback;

  const setInstance = (id: string) => {
    setStored(id);
    localStorage.setItem(STORAGE_KEY, id);
    const next = new URLSearchParams(params);
    next.set("instance", id);
    setParams(next, { replace: true });
  };

  return [instance, setInstance];
}
