import * as real from "../../app/lib/webhooks/n8n";

// Test-only stand-in for app/lib/webhooks/n8n, loaded in place of it by
// app/lib/ai/incidents.ts only (see tests/incidents.spec.ts). Switched off, it
// calls the real notifyIncidentOpened; switched on, it records the incident id
// and sends nothing. Named imports of the real module are read-only once
// compiled, so a spec can't swap them in place.
export const alertSpy = { active: false, calls: [] as string[] };

export function notifyIncidentOpened(incidentId: string): void {
  if (alertSpy.active) alertSpy.calls.push(incidentId);
  else real.notifyIncidentOpened(incidentId);
}
