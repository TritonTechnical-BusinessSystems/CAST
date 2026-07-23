import { useState } from "react";

// Tabs mirror the extension's design record (mockup §1), not new concepts.
const tabs = ["Role Rules", "Expected Pods", "Fleet", "Deployment"] as const;

export function Extension() {
  const [active, setActive] = useState<(typeof tabs)[number]>("Role Rules");

  return (
    <div>
      <div className="tabs">
        {tabs.map((tab) => (
          <button
            key={tab}
            className={`tab${active === tab ? " active" : ""}`}
            onClick={() => setActive(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="card panel">
        <h2>{active}</h2>
        <p className="muted">
          Scaffold placeholder. Build this out against the approved mockup and the
          shared config schema (<code>@cast/config-schema</code>), served by{" "}
          <code>GET/PUT /api/config</code>.
        </p>
      </div>

      <style>{css}</style>
    </div>
  );
}

const css = `
  .tabs { display: flex; gap: 8px; border-bottom: 1px solid var(--color-border); margin-bottom: 24px; }
  .tab { background: none; border: none; padding: 12px 8px; margin-bottom: -1px; font: inherit; font-weight: 600; color: var(--color-ink-soft); border-bottom: 2px solid transparent; cursor: pointer; }
  .tab:hover { color: var(--color-ink); }
  .tab.active { color: var(--color-signal); border-bottom-color: var(--color-signal); }
  .panel { padding: 24px; max-width: 720px; }
  .panel h2 { font-size: 1.0625rem; margin-bottom: 8px; }
  .muted { color: var(--color-ink-faint); font-size: 0.8125rem; }
  code { font-family: var(--font-mono); font-size: 0.75rem; }
`;
