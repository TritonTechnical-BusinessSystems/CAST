/**
 * Scheduled Vessel Location Updating sync (INIT-0012), using node-cron — the
 * same scheduling approach as the SOC backend.
 *
 * Not yet implemented: the marine-traffic data source, eligible CW company
 * status, IMO custom-field mapping, and Target Location selection rule are all
 * open decisions (INIT-0012). This wires the schedule; the body is a stub.
 */
import cron from "node-cron";
import { config } from "../config";

export function startVesselSync(): void {
  if (!cron.validate(config.vesselSyncCron)) {
    console.warn(`[vessel-sync] invalid cron "${config.vesselSyncCron}" — not scheduled`);
    return;
  }
  cron.schedule(config.vesselSyncCron, () => {
    runVesselSync().catch((err) => console.error("[vessel-sync] run failed:", err));
  });
  console.log(`[vessel-sync] scheduled: ${config.vesselSyncCron}`);
}

async function runVesselSync(): Promise<void> {
  // TODO(INIT-0012): for each CW company in the eligible status that carries an
  // IMO number, look up its position/navigational status via the marine-traffic
  // API and write the position into its Target Location's address field.
  console.log("[vessel-sync] tick — not yet implemented (INIT-0012)");
}
