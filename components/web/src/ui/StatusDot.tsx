type State = "ok" | "warn" | "down" | "idle";

const LABEL: Record<State, string> = { ok: "Healthy", warn: "Degraded", down: "Down", idle: "Unknown" };

export function StatusDot({ state = "idle" }: { state?: State }) {
  return <span className={`status-dot ${state}`} role="img" aria-label={LABEL[state]} />;
}
