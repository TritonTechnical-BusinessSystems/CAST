import { useEffect, useState } from "react";
import { api } from "../api";
import { PageHeader, Card, CardBody, Table, Badge, Button, Input, Banner, Spinner, EmptyState, useToast, IconExternal } from "../ui";
import { useAuth } from "../auth";

// TEMPORARY (added 2026-08-09) — a fast way to power through the IMO/MMSI
// backlog in one sitting. Tear down once the backlog is clear: delete this
// file, its route in App.tsx, and the link on VesselIdentity.tsx. No backend
// changes to remove — it's built entirely on the existing
// GET/POST /api/vessel-identity routes (INIT-0014).

interface IdCheck { raw: string | null; normalized: string | null; present: boolean; valid: boolean; reason?: string; }
interface LookupLink { label: string; url: string; note?: string; }
interface Row { id: string; companyName: string; vesselName: string; imo: IdCheck; mmsi: IdCheck; needsAttention: boolean; lookupLinks: LookupLink[]; }
interface AuditResp { vessels: Row[] }

type RowState = "idle" | "saving" | "saved" | "error";

// Only prefill a field with its EXISTING value when that value is already
// valid (the other field must be the reason this row needs attention) —
// prefilling an invalid/garbage value meant every untouched field rode along
// on Save and failed validation, silently defeating "Save all" on almost
// every row. Blank means "type this one"; the badge below explains why.
function initialValue(c: IdCheck): string {
  return c.valid ? (c.normalized ?? "") : "";
}

function IdHint({ c }: { c: IdCheck }) {
  if (c.valid) return null;
  if (!c.present) return <Badge tone="warning">Missing</Badge>;
  return <Badge tone="danger">{c.raw} — {c.reason ?? "invalid"}</Badge>;
}

export function VesselIdentityQuickEntry() {
  const toast = useToast();
  const { can } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [writesEnabled, setWritesEnabled] = useState<boolean | null>(null);
  const [edits, setEdits] = useState<Record<string, { imo: string; mmsi: string }>>({});
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [savingAll, setSavingAll] = useState(false);

  const canWrite = can("vessel.reconcile") && writesEnabled !== false;

  const load = () => {
    setError(null);
    api
      .get<AuditResp>("/vessel-identity")
      .then((r) => {
        const pending = r.vessels.filter((v) => v.needsAttention);
        setRows(pending);
        setEdits((prev) => {
          const next = { ...prev };
          for (const v of pending) {
            if (!next[v.id]) next[v.id] = { imo: initialValue(v.imo), mmsi: initialValue(v.mmsi) };
          }
          return next;
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
    api
      .get<{ writesEnabled: boolean }>("/integrations/connectwise")
      .then((r) => setWritesEnabled(r.writesEnabled))
      .catch(() => setWritesEnabled(null));
  };
  useEffect(load, []);

  const saveRow = async (id: string): Promise<boolean> => {
    const edit = edits[id];
    if (!edit || (!edit.imo.trim() && !edit.mmsi.trim())) return false;
    setRowState((s) => ({ ...s, [id]: "saving" }));
    setRowError((s) => ({ ...s, [id]: "" }));
    try {
      const patch: Record<string, string> = {};
      if (edit.imo.trim()) patch.imo = edit.imo.trim();
      if (edit.mmsi.trim()) patch.mmsi = edit.mmsi.trim();
      await api.post(`/vessel-identity/${id}`, patch);
      setRowState((s) => ({ ...s, [id]: "saved" }));
      setRows((r) => (r ? r.filter((v) => v.id !== id) : r));
      return true;
    } catch (e) {
      setRowState((s) => ({ ...s, [id]: "error" }));
      setRowError((s) => ({ ...s, [id]: e instanceof Error ? e.message : "Save failed" }));
      return false;
    }
  };

  const saveAll = async () => {
    if (!rows) return;
    setSavingAll(true);
    let saved = 0;
    let failed = 0;
    for (const v of rows) {
      const edit = edits[v.id];
      if (!edit || (!edit.imo.trim() && !edit.mmsi.trim())) continue;
      const ok = await saveRow(v.id);
      if (ok) saved++;
      else failed++;
    }
    setSavingAll(false);
    if (saved) toast("success", `Saved ${saved} vessel${saved === 1 ? "" : "s"}.`);
    if (failed) toast("error", `${failed} vessel${failed === 1 ? "" : "s"} failed — see row${failed === 1 ? "" : "s"} below.`);
  };

  return (
    <div className="col gap-4">
      <PageHeader
        title="Vessel Identity — Quick Entry"
        subtitle="Temporary tool for powering through the IMO/MMSI backlog. Tear down once clear."
        actions={
          <div className="row gap-2">
            <Button variant="secondary" onClick={load}>Refresh</Button>
            <Button variant="primary" onClick={saveAll} disabled={savingAll || !rows?.length || !canWrite}>
              {savingAll ? "Saving all…" : "Save all"}
            </Button>
          </div>
        }
      />
      {writesEnabled === false && (
        <Banner tone="danger">
          ConnectWise writes are disabled — every save will fail until they're turned on from the Integrations page.
        </Banner>
      )}
      {writesEnabled !== false && !can("vessel.reconcile") && (
        <Banner tone="warning">Your account can't save identifier changes — view only.</Banner>
      )}
      <Card>
        {error ? (
          <CardBody><Banner tone="danger">{error}</Banner></CardBody>
        ) : !rows ? (
          <div className="card-body row gap-2">
            <Spinner /> <span className="muted">Loading…</span>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState>Nothing needs attention — the backlog is clear.</EmptyState>
        ) : (
          <Table className="align-top">
            <thead>
              <tr>
                <th>Vessel</th>
                <th>Company</th>
                <th>IMO</th>
                <th>MMSI</th>
                <th>Lookup</th>
                <th>Save</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const edit = edits[v.id] ?? { imo: "", mmsi: "" };
                const state = rowState[v.id] ?? "idle";
                return (
                  <tr key={v.id}>
                    <td data-label="Vessel"><strong>{v.vesselName}</strong></td>
                    <td data-label="Company" className="muted">{v.companyName}</td>
                    <td data-label="IMO" className="td-stack">
                      <Input
                        value={edit.imo}
                        placeholder="7 digits"
                        disabled={state === "saving"}
                        onChange={(e) => setEdits((s) => ({ ...s, [v.id]: { ...s[v.id], imo: e.target.value } }))}
                      />
                      <IdHint c={v.imo} />
                    </td>
                    <td data-label="MMSI" className="td-stack">
                      <Input
                        value={edit.mmsi}
                        placeholder="9 digits"
                        disabled={state === "saving"}
                        onChange={(e) => setEdits((s) => ({ ...s, [v.id]: { ...s[v.id], mmsi: e.target.value } }))}
                      />
                      <IdHint c={v.mmsi} />
                    </td>
                    <td data-label="Lookup">
                      <div className="row gap-2 wrap">
                        {v.lookupLinks.map((l) => (
                          <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="row gap-1 text-sm">
                            {l.label}
                            <IconExternal width={13} height={13} />
                          </a>
                        ))}
                      </div>
                    </td>
                    <td data-label="Save" className="td-stack">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => saveRow(v.id)}
                        disabled={state === "saving" || (!edit.imo.trim() && !edit.mmsi.trim()) || !canWrite}
                      >
                        {state === "saving" ? "Saving…" : "Save"}
                      </Button>
                      {state === "error" && <Badge tone="danger">{rowError[v.id]}</Badge>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
