import { useEffect, useState } from "react";
import { api } from "../api";
import { PageHeader, Card, Table, Badge, Button, Modal, Field, Input, Banner, Spinner, EmptyState, useToast, IconExternal } from "../ui";

interface IdCheck { raw: string | null; normalized: string | null; present: boolean; valid: boolean; reason?: string; }
interface Link { label: string; url: string; note?: string; }
interface Row { id: string; companyName: string; vesselName: string; status: string; imo: IdCheck; mmsi: IdCheck; needsAttention: boolean; lookupLinks: Link[]; }
interface AuditResp { vessels: Row[]; summary: { total: number; complete: number; needsAttention: number }; }

function idBadge(c: IdCheck) {
  if (c.valid) return <Badge tone="success">{c.normalized}</Badge>;
  if (c.present) return <Badge tone="danger">Invalid</Badge>;
  return <Badge tone="warning">Missing</Badge>;
}

export function VesselIdentity() {
  const toast = useToast();
  const [data, setData] = useState<AuditResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);

  const load = () => {
    setError(null);
    api.get<AuditResp>("/vessel-identity").then(setData).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  };
  useEffect(load, []);

  return (
    <div className="col gap-4">
      <PageHeader
        title="Vessel Identity"
        subtitle="Ensure every tracked vessel has a valid IMO and MMSI in ConnectWise."
        actions={<Button variant="secondary" onClick={load}>Refresh</Button>}
      />
      {data && (
        <div className="row gap-2 wrap">
          <Badge tone="neutral">{data.summary.total} tracked</Badge>
          <Badge tone="success">{data.summary.complete} complete</Badge>
          <Badge tone="warning">{data.summary.needsAttention} need attention</Badge>
        </div>
      )}
      <Card>
        {error ? (
          <EmptyState>{error}</EmptyState>
        ) : !data ? (
          <div className="card-body row gap-2">
            <Spinner /> <span className="muted">Loading…</span>
          </div>
        ) : data.vessels.length === 0 ? (
          <EmptyState>No tracked vessels.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Vessel</th>
                <th>Company</th>
                <th>IMO</th>
                <th>MMSI</th>
                <th>Lookup</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.vessels.map((v) => (
                <tr key={v.id}>
                  <td>
                    <strong>{v.vesselName}</strong>
                  </td>
                  <td className="muted">{v.companyName}</td>
                  <td>{idBadge(v.imo)}</td>
                  <td>{idBadge(v.mmsi)}</td>
                  <td>
                    <div className="row gap-2 wrap">
                      {v.lookupLinks.map((l) => (
                        <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="row gap-1 text-sm">
                          {l.label}
                          <IconExternal width={13} height={13} />
                        </a>
                      ))}
                    </div>
                  </td>
                  <td>
                    {v.needsAttention && (
                      <Button size="sm" variant="secondary" onClick={() => setEditing(v)}>
                        Resolve
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {editing && (
        <ResolveModal
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
            toast("success", "Identifier saved.");
          }}
        />
      )}
    </div>
  );
}

function ResolveModal({ row, onClose, onSaved }: { row: Row; onClose: () => void; onSaved: () => void }) {
  const [imo, setImo] = useState(row.imo.normalized ?? row.imo.raw ?? "");
  const [mmsi, setMmsi] = useState(row.mmsi.normalized ?? row.mmsi.raw ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const patch: Record<string, string> = {};
      if (imo.trim()) patch.imo = imo.trim();
      if (mmsi.trim()) patch.mmsi = mmsi.trim();
      await api.post(`/vessel-identity/${row.id}`, patch);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Resolve — ${row.vesselName}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save to ConnectWise"}
          </Button>
        </>
      }
    >
      <div className="col gap-4">
        <Banner tone="info">
          Confirm the vessel against a registry (use the lookup links), then save. Values are validated (IMO
          check-digit, MMSI format) server-side before any write.
        </Banner>
        <Field label="IMO number" error={row.imo.present && !row.imo.valid ? row.imo.reason : undefined}>
          <Input value={imo} onChange={(e) => setImo(e.target.value)} placeholder="7 digits" />
        </Field>
        <Field label="MMSI" error={row.mmsi.present && !row.mmsi.valid ? row.mmsi.reason : undefined}>
          <Input value={mmsi} onChange={(e) => setMmsi(e.target.value)} placeholder="9 digits" />
        </Field>
        {err && <Banner tone="danger">{err}</Banner>}
      </div>
    </Modal>
  );
}
