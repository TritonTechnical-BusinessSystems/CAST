import { useState } from "react";
import { Card, CardBody, Tabs } from "../ui";
import type { TabDef } from "../ui";

// Tabs mirror the extension's design record (mockup §1), not new concepts.
const tabs: TabDef[] = [
  { id: "roles", label: "Role Rules" },
  { id: "pods", label: "Expected Pods" },
  { id: "fleet", label: "Fleet" },
  { id: "deploy", label: "Deployment" },
];

export function Extension() {
  const [active, setActive] = useState("roles");
  const label = tabs.find((t) => t.id === active)?.label ?? "";

  return (
    <div>
      <Tabs tabs={tabs} active={active} onChange={setActive} />
      <Card>
        <CardBody>
          <div className="col gap-2">
            <h3>{label}</h3>
            <p className="muted">
              Scaffold placeholder. Build this out against the approved mockup and the shared config schema
              (<span className="mono">@cast/config-schema</span>), served by <span className="mono">GET/PUT /api/config</span>.
            </p>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
