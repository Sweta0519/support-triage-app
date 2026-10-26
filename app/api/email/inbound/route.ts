import { recordInboundEmailEvent } from "@/app/lib/db/inbound-email";
import { verifyWebhookSignature } from "@/app/lib/email/webhook-signature";

// Resend's inbound email webhook (SUP-88, docs/email.md). A mutating Route
// Handler, so it doesn't get Server Actions' CSRF check; it doesn't need it.
// Cookies are never read, so a browser can't be tricked into acting as
// anyone here: the only proof a request carries is the Svix signature,
// made with a secret only Resend and this server hold. No CORS headers are
// sent. The proxy doesn't run for this path (proxy.ts).
//
// The event carries only metadata. The body is fetched from Resend's API by
// the email id (SUP-89), so a valid signature is the one thing that lets a
// delivery in, and its content is whatever Resend actually received.

// Metadata only, so events are small; anything bigger isn't Resend.
const MAX_BODY_BYTES = 64 * 1024;

type ReceivedEvent = {
  type?: unknown;
  data?: { email_id?: unknown; to?: unknown; cc?: unknown; received_for?: unknown };
};

// "Name <a@b.c>" or "a@b.c" -> "a@b.c", lowercased.
function addressOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /<([^<>\s]+)>\s*$/.exec(value);
  return (match ? match[1] : value.trim()).toLowerCase();
}

// Local parts of the recipients at our inbound domain. A forwarded email's
// To is usually the team's own address, so the envelope recipients
// (received_for) count too.
function inboundLocalParts(data: NonNullable<ReceivedEvent["data"]>, domain: string): string[] {
  const all = [data.to, data.cc, data.received_for].flatMap((list) => (Array.isArray(list) ? list : [list]));
  const parts = new Set<string>();
  for (const address of all.map(addressOf)) {
    const at = address?.lastIndexOf("@") ?? -1;
    if (address && at > 0 && address.slice(at + 1) === domain) parts.add(address.slice(0, at));
  }
  return [...parts];
}

// The body as text, or null once it passes MAX_BODY_BYTES: read in chunks
// and abandoned there, so an oversized (or chunked, length-less) request is
// never buffered whole.
async function readLimited(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function reply(status: number, message: string, headers: Record<string, string> = {}) {
  return Response.json({ message }, { status, headers });
}

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const domain = process.env.EMAIL_INBOUND_DOMAIN?.toLowerCase();
  if (!secret || !domain) {
    console.error("Email webhook: RESEND_WEBHOOK_SECRET or EMAIL_INBOUND_DOMAIN is not configured");
    return reply(503, "Email intake isn't configured.");
  }

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return reply(413, "Too large.");
  const body = await readLimited(request);
  if (body === null) return reply(413, "Too large.");

  const signed = verifyWebhookSignature(
    secret,
    {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    },
    body,
  );
  if (!signed) return reply(401, "Invalid signature.");

  let event: ReceivedEvent;
  try {
    event = JSON.parse(body);
  } catch {
    return reply(400, "Not JSON.");
  }
  if (!event || typeof event !== "object") return reply(400, "Not an event.");
  // Signed, but not an event we subscribe to: acknowledge, so it isn't retried.
  if (event.type !== "email.received") return reply(200, "Ignored.");
  const emailId = event.data?.email_id;
  if (typeof emailId !== "string" || !event.data) return reply(400, "No email_id.");
  // The table's limits: a longer id could never be recorded, and a 503 would
  // only make Resend retry it.
  const svixId = request.headers.get("svix-id")!;
  if (emailId.length > 100 || svixId.length > 100) return reply(400, "Id too long.");

  try {
    // Every outcome is final, including 'held' (over the workspace's cap):
    // it's recorded, so there's nothing for Resend to retry.
    return reply(200, await recordInboundEmailEvent(svixId, emailId, inboundLocalParts(event.data, domain)));
  } catch (err) {
    console.error("Email webhook failed:", err);
    return reply(503, "Unavailable right now.", { "Retry-After": "30" });
  }
}
