import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import {
  Card,
  CardHeader,
  CardBody,
  Table,
  Input,
  Textarea,
  Field,
  Button,
  Badge,
  Modal,
  EmptyState,
  Spinner,
  useToast,
  IconPackage,
} from "../ui";

interface Company {
  id: number;
  name: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  tax_id: string | null;
  logo_filename: string | null;
  address_block: string | null;
  pdf_code: string | null;
  ein: string | null;
  vat: string | null;
  eori: string | null;
  default_export_statement: string | null;
  primary_color: string | null;
  accent_color: string | null;
  is_default: number;
  sort_order: number;
}

const emptyCompany: Omit<Company, "id" | "logo_filename" | "is_default" | "sort_order"> = {
  name: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  zip: "",
  country: "",
  phone: "",
  email: "",
  tax_id: "",
  address_block: "",
  pdf_code: "",
  ein: "",
  vat: "",
  eori: "",
  default_export_statement: "",
  primary_color: "",
  accent_color: "",
};

type Draft = Company | typeof emptyCompany;

const ALLOWED_LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

export function LogisticsConfigBranding() {
  const toast = useToast();
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingFor, setUploadingFor] = useState<number | null>(null);

  const load = () => api.get<Company[]>("/logistics/config/companies").then(setCompanies).catch(() => setCompanies([]));
  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (!draft || !draft.name.trim()) return;
    setSaving(true);
    try {
      if ("id" in draft) {
        await api.put(`/logistics/config/companies/${draft.id}`, draft);
      } else {
        await api.post("/logistics/config/companies", draft);
      }
      setDraft(null);
      load();
      toast("success", "Company saved.");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed to save company");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Remove this \"Ship As\" company?")) return;
    try {
      await api.del(`/logistics/config/companies/${id}`);
      load();
      toast("success", "Company removed.");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed to remove company");
    }
  };

  const setDefault = async (id: number) => {
    try {
      await api.post(`/logistics/config/companies/${id}/set-default`);
      load();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed to set default");
    }
  };

  const pickLogo = (id: number) => {
    setUploadingFor(id);
    fileInputRef.current?.click();
  };

  const onFileChosen: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const id = uploadingFor;
    setUploadingFor(null);
    if (!file || !id) return;
    if (!ALLOWED_LOGO_TYPES.has(file.type)) {
      toast("error", "Logo must be a PNG, JPEG, GIF, or WebP image.");
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      toast("error", "Logo must be 2 MB or smaller.");
      return;
    }
    try {
      await api.upload(`/logistics/config/companies/${id}/logo`, file);
      load();
      toast("success", "Logo uploaded.");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Logo upload failed");
    }
  };

  const removeLogo = async (id: number) => {
    try {
      await api.del(`/logistics/config/companies/${id}/logo`);
      load();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed to remove logo");
    }
  };

  if (!companies) return <Spinner />;

  return (
    <Card>
      <CardHeader
        title='"Ship As" Companies'
        action={
          <Button variant="primary" size="sm" onClick={() => setDraft(emptyCompany)}>
            Add company
          </Button>
        }
      />
      <CardBody>
        <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={onFileChosen} />

        {companies.length === 0 ? (
          <EmptyState icon={<IconPackage />}>
            No "Ship As" companies configured yet — add one to appear as the shipper on generated documents.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Logo</th>
                <th>Name</th>
                <th>PDF Code</th>
                <th>Location</th>
                <th>Default</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.logo_filename ? (
                      <img
                        src={`/api/logistics/config/companies/${c.id}/logo`}
                        alt={`${c.name} logo`}
                        className="thumb-sm"
                      />
                    ) : (
                      <span className="hint">None</span>
                    )}
                  </td>
                  <td>{c.name}</td>
                  <td>{c.pdf_code || <span className="hint">—</span>}</td>
                  <td>{[c.city, c.country].filter(Boolean).join(", ") || <span className="hint">—</span>}</td>
                  <td>
                    {c.is_default ? (
                      <Badge tone="brand">Default</Badge>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => setDefault(c.id)}>
                        Set default
                      </Button>
                    )}
                  </td>
                  <td>
                    <div className="row gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setDraft(c)}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => pickLogo(c.id)}>
                        {c.logo_filename ? "Replace logo" : "Upload logo"}
                      </Button>
                      {c.logo_filename && (
                        <Button variant="ghost" size="sm" onClick={() => removeLogo(c.id)}>
                          Remove logo
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => remove(c.id)}>
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </CardBody>

      {draft && (
        <Modal
          title={"id" in draft ? "Edit Company" : "Add Company"}
          onClose={() => setDraft(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={save} disabled={saving || !draft.name.trim()}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </>
          }
        >
          <div className="col gap-3">
            <div className="row gap-3 top">
              <Field label="Name">
                <Input value={draft.name} onChange={(e) => setDraft((d) => (d ? { ...d, name: e.target.value } : d))} />
              </Field>
              <Field label="PDF Code" hint="Appended to CI/PL filenames.">
                <Input
                  className="w-num"
                  value={draft.pdf_code ?? ""}
                  onChange={(e) => setDraft((d) => (d ? { ...d, pdf_code: e.target.value } : d))}
                />
              </Field>
            </div>

            <Field label="Address line 1">
              <Input value={draft.address_line1 ?? ""} onChange={(e) => setDraft((d) => (d ? { ...d, address_line1: e.target.value } : d))} />
            </Field>
            <Field label="Address line 2">
              <Input value={draft.address_line2 ?? ""} onChange={(e) => setDraft((d) => (d ? { ...d, address_line2: e.target.value } : d))} />
            </Field>
            <div className="row gap-3 top">
              <Field label="City">
                <Input value={draft.city ?? ""} onChange={(e) => setDraft((d) => (d ? { ...d, city: e.target.value } : d))} />
              </Field>
              <Field label="State">
                <Input value={draft.state ?? ""} onChange={(e) => setDraft((d) => (d ? { ...d, state: e.target.value } : d))} />
              </Field>
              <Field label="Zip">
                <Input value={draft.zip ?? ""} onChange={(e) => setDraft((d) => (d ? { ...d, zip: e.target.value } : d))} />
              </Field>
            </div>
            <Field label="Country">
              <Input value={draft.country ?? ""} onChange={(e) => setDraft((d) => (d ? { ...d, country: e.target.value } : d))} />
            </Field>
            <Field label="Freeform address block" hint="Alternative to the structured fields above — used as-is if set.">
              <Textarea rows={2} value={draft.address_block ?? ""} onChange={(e) => setDraft((d) => (d ? { ...d, address_block: e.target.value } : d))} />
            </Field>

            <div className="row gap-3 top">
              <Field label="Phone">
                <Input value={draft.phone ?? ""} onChange={(e) => setDraft((d) => (d ? { ...d, phone: e.target.value } : d))} />
              </Field>
              <Field label="Email">
                <Input value={draft.email ?? ""} onChange={(e) => setDraft((d) => (d ? { ...d, email: e.target.value } : d))} />
              </Field>
            </div>

            <div className="row gap-3 top">
              <Field label="Tax ID">
                <Input value={draft.tax_id ?? ""} onChange={(e) => setDraft((d) => (d ? { ...d, tax_id: e.target.value } : d))} />
              </Field>
              <Field label="EIN">
                <Input value={draft.ein ?? ""} onChange={(e) => setDraft((d) => (d ? { ...d, ein: e.target.value } : d))} />
              </Field>
              <Field label="VAT">
                <Input value={draft.vat ?? ""} onChange={(e) => setDraft((d) => (d ? { ...d, vat: e.target.value } : d))} />
              </Field>
              <Field label="EORI">
                <Input value={draft.eori ?? ""} onChange={(e) => setDraft((d) => (d ? { ...d, eori: e.target.value } : d))} />
              </Field>
            </div>

            <Field label="Default export statement">
              <Textarea
                rows={2}
                value={draft.default_export_statement ?? ""}
                onChange={(e) => setDraft((d) => (d ? { ...d, default_export_statement: e.target.value } : d))}
              />
            </Field>

            <div className="row gap-3 top">
              <Field label="Primary color">
                <Input
                  type="color"
                  value={draft.primary_color || "#1e3a5f"}
                  onChange={(e) => setDraft((d) => (d ? { ...d, primary_color: e.target.value } : d))}
                />
              </Field>
              <Field label="Accent color">
                <Input
                  type="color"
                  value={draft.accent_color || "#1e3a5f"}
                  onChange={(e) => setDraft((d) => (d ? { ...d, accent_color: e.target.value } : d))}
                />
              </Field>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
}
