/**
 * PDF render pipeline (INIT-0026 Phase 3) — Playwright navigates to the
 * live SPA's own `/print/ci/:id` / `/print/pl/:id` routes and screenshots
 * them to PDF. Ported exactly from LC's `pdf_service.py`
 * (`render_commercial_invoice_via_react`/`render_packing_list_via_react`,
 * documented in `knowledge/architecture/logistics-packing-shipping-behavior-spec.md`
 * §8.3): the PDF is not a separate template, it's the same interactive
 * `CommercialInvoice`/`PackingList` React component rendered headlessly
 * with `printMode=true` — any visual change to that component applies to
 * the PDF automatically.
 *
 * `PRINT_READY` handshake: the print page sets `window.PRINT_READY = true`
 * once its data fetch settles (success OR error, so a bad shipment id
 * never hangs Playwright — it just captures whatever the error state
 * renders). We poll for that flag rather than relying on `networkidle`
 * alone, matching LC exactly.
 */
import { chromium } from "playwright";
import { config } from "../config";
import { mintInternalRenderToken, SESSION_COOKIE_NAME } from "../middleware/auth";

export type DocType = "commercial-invoice" | "packing-list";

const NAV_TIMEOUT_MS = 30_000;
const PRINT_READY_TIMEOUT_MS = 15_000;

/**
 * Caps concurrent Chromium launches (security review, INIT-0026 Phase 3) —
 * each render is a full browser process with no queue/limit otherwise, and
 * `/documents/download/*` needs only `requireAuth`, so any handful of
 * concurrent authenticated requests could exhaust the deploy host (2 vCPU /
 * 3.8 GiB, `host.md`) with nothing in front of it. A bounded queue, not a
 * rejection — a render still completes, just waits its turn past the cap.
 */
const MAX_CONCURRENT_RENDERS = 2;
let activeRenders = 0;
const renderQueue: (() => void)[] = [];

async function acquireRenderSlot(): Promise<void> {
  if (activeRenders < MAX_CONCURRENT_RENDERS) {
    activeRenders++;
    return;
  }
  await new Promise<void>((resolve) => renderQueue.push(resolve));
  activeRenders++;
}

function releaseRenderSlot(): void {
  activeRenders--;
  const next = renderQueue.shift();
  if (next) next();
}

function footerHtml(companyName: string, docLabel: string, docRef: string): string {
  // Playwright's page.pdf() footer template supports these special classes:
  // pageNumber/totalPages. Font size must be set explicitly (footer templates
  // don't inherit page CSS) — matches LC's own footer sizing.
  return `
    <div style="width:100%; font-size:8px; color:#555; padding:0 0.35in; display:flex; justify-content:space-between;">
      <span>${escapeHtml(companyName)} — ${escapeHtml(docLabel)} ${escapeHtml(docRef)}</span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
    </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Renders `/print/ci/:shipmentId` or `/print/pl/:shipmentId` to a PDF buffer.
 * `companyName`/`docRef` feed only the footer — the page itself fetches its
 * own data independently (see the print routes in `components/web`).
 */
export async function renderShipmentDocument(
  docType: DocType,
  instanceId: string,
  shipmentId: string,
  footer: { companyName: string; docRef: string },
): Promise<Buffer> {
  // Last line of defense, independent of what every caller already validates:
  // this id is about to drive a navigation URL for a browser holding a
  // privileged internal session cookie (see mintInternalRenderToken below) —
  // it must never be anything but the numeric CW ticket number it's supposed
  // to be, regardless of how a caller got here.
  if (!/^\d+$/.test(shipmentId)) throw new Error(`Invalid shipment id for PDF render: "${shipmentId}"`);

  const slug = docType === "commercial-invoice" ? "ci" : "pl";
  const docLabel = docType === "commercial-invoice" ? "Commercial Invoice" : "Packing List";

  await acquireRenderSlot();
  let browser: import("playwright").Browser | undefined;
  try {
    // No --no-sandbox: the container runs this as a non-root user specifically
    // so Chromium's real OS sandbox can stay on (Dockerfile + entrypoint.sh) —
    // Chromium itself refuses to sandbox as root, which is the only reason
    // that flag is common in Docker setups that don't bother dropping privilege.
    browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
    const context = await browser.newContext();
    // The print page's own fetch() calls hit requireAuth-gated endpoints
    // (invoice-data, the CW ticket read) exactly like an interactive user
    // would — Playwright has no login session, so give it one via a
    // short-lived internal token, same mechanism as a real cookie login.
    const target = new URL(config.internalWebUrl);
    await context.addCookies([
      { name: SESSION_COOKIE_NAME, value: mintInternalRenderToken(), domain: target.hostname, path: "/", httpOnly: true },
    ]);
    const page = await context.newPage();
    await page.goto(`${config.internalWebUrl}/print/${slug}/${encodeURIComponent(shipmentId)}?instance=${encodeURIComponent(instanceId)}`, {
      waitUntil: "networkidle",
      timeout: NAV_TIMEOUT_MS,
    });
    // A string body (not a function reference) avoids needing DOM lib types
    // in this Node-only tsconfig — it's evaluated in the browser regardless.
    await page.waitForFunction("window.PRINT_READY === true", { timeout: PRINT_READY_TIMEOUT_MS });
    const pdf = await page.pdf({
      format: "Letter",
      landscape: true,
      printBackground: true,
      margin: { top: "0.35in", right: "0.35in", bottom: "0.35in", left: "0.35in" },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: footerHtml(footer.companyName, docLabel, footer.docRef),
    });
    return pdf;
  } finally {
    if (browser) await browser.close();
    releaseRenderSlot();
  }
}
