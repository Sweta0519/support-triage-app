import "server-only";

import { after } from "next/server";

import { isAiConfigured } from "@/app/lib/ai/openrouter";
import { runTriage } from "@/app/lib/ai/triage";
import { fileAccessRequestIfPending } from "@/app/lib/db/access-requests";

// Not in actions.ts: everything a "use server" file exports is a server
// action the browser can call, and this is only for the sign-in paths.
// After someone is signed in (a sign-up that signs them straight in, a
// password sign-in, or a sign-in link; the (app) layout also calls it as a
// retry while a request is still waiting):
// files their access request if one is waiting, and starts its triage as
// the web form does. Returns where to send them: their tickets with a
// thank-you, or null to go on as usual. A failure here never blocks signing
// in; the request is filed on a later sign-in instead.
//
// `metadata`: the signed-in user's metadata when the caller has it. Without
// an access_request there's nothing to file, so the database isn't asked.
export async function afterSignIn(metadata?: Record<string, unknown> | null): Promise<string | null> {
  if (metadata && !metadata.access_request) return null;
  try {
    const filed = await fileAccessRequestIfPending();
    if (!filed) return null;
    if (isAiConfigured()) after(() => runTriage(filed.id));
    return "/tickets?requested=1";
  } catch (err) {
    console.error("Couldn't file the access request:", err);
    return null;
  }
}
