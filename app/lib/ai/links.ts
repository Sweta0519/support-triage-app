// Link stripping for the triage output. Plain functions with no
// server-only imports, so they can be unit-tested directly; called only
// from app/lib/ai/triage.ts.

// Scheme URLs, bare "host.tld/path" links, and email addresses: what
// stripForeignLinks (draft reply) and stripAllLinks (summary, priority
// reason, missing info) remove. Any URL or email in the draft reply that
// did not appear in the ticket being assessed can only have come from the
// model or from another customer's text -- neither is something an agent
// should paste to a customer unreviewed.
const URL_OR_EMAIL_RE =
  /\bhttps?:\/\/[^\s)<>"']+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s)<>"']*|\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/gi;
// A URL at the end of a sentence drags its punctuation into the match
// ("…/ticket/123,"); compare without it so the same link in the ticket and
// in the reply is recognised as the same link.
const TRAILING_PUNCT_RE = /[.,;:!?)\]]+$/;

function linkKey(match: string): string {
  return match.replace(TRAILING_PUNCT_RE, "").toLowerCase();
}

export function stripForeignLinks(reply: string, ticketText: string): string {
  const allowed = new Set((ticketText.match(URL_OR_EMAIL_RE) ?? []).map(linkKey));
  return reply.replace(URL_OR_EMAIL_RE, (match) => {
    if (allowed.has(linkKey(match))) {
      return match;
    }
    const trailing = match.match(TRAILING_PUNCT_RE)?.[0] ?? "";
    return `[link removed]${trailing}`;
  });
}

// The summary, priority reason and missing-info lines never need a link,
// and the summary is what staff publish on the public status page and what
// other tickets' triage sees as candidate text -- so a prompt-injected
// ticket mustn't be able to plant a URL or address there. Unlike the draft
// reply, even links from the ticket itself are removed.
export function stripAllLinks(text: string): string {
  return text.replace(URL_OR_EMAIL_RE, (match) => `[link removed]${match.match(TRAILING_PUNCT_RE)?.[0] ?? ""}`);
}
