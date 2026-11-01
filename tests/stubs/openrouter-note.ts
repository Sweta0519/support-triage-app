import * as real from "../../app/lib/ai/openrouter";

// Test-only stand-in for app/lib/ai/openrouter's completeJson, loaded in place
// of it by app/lib/ai/incidents.ts only (see tests/incidents.spec.ts). "real"
// passes through to the real call; "pass" returns a fixed note; "fail" throws
// like a model outage. No network in either stub mode.
export const noteSpy: { mode: "real" | "pass" | "fail" } = { mode: "real" };

export async function completeJson(opts: Parameters<typeof real.completeJson>[0]) {
  if (noteSpy.mode === "real") return real.completeJson(opts);
  if (noteSpy.mode === "fail") throw new Error("model unavailable");
  return {
    data: {
      title: "Webhook deliveries failing",
      summary: "Several customers report failed deliveries.",
      customer_update: "We are investigating and will follow up.",
    },
  };
}
