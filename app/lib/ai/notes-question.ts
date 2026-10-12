// Whether a message plainly asks about the staff member's own notes (SUP-28).
// For these Sage's first model call *must* search (tool_choice "required"):
// left to decide, the model sometimes answered a repeat question from its
// own earlier reply, or said "nothing in your notes" without looking.
// Anything less explicit stays the model's call -- that decision is the
// point of agentic RAG. Pure and dependency-free so tests can import it.
//
// Matches the notes being *theirs* ("my notes", "our saved notes", "the
// team's notes", "in my notes"), asking what notes say ("what do my notes
// say", "any notes about SLAs"), or asking to search them. Deliberately not
// a bare "the notes", which is usually a ticket's notes or a product's
// release notes, not the staff member's knowledge base.
// ['’]: smart punctuation turns "team's" into "team’s".
const OWN_NOTES = /\b(?:my|our|the team['’]?s)\s+(?:[\w’']+\s+)?notes?\b/i;
const NOTES_SAY = /\bnotes?\s+(?:say|says|mention|mentions)\b/i;
const ANY_NOTES = /\b(?:any|search)\s+(?:my\s+|our\s+|the\s+)?notes?\s+(?:on|about|for|regarding)\b/i;
const WHAT_I_WROTE = /\bwhat\s+did\s+(?:i|we)\s+(?:write|note|save|jot)\b/i;
// "Ignore my notes and just draft it": the user said not to.
const NOT_THE_NOTES = /\b(?:ignore|without|skip|don['’]?t\s+use|not\s+using)\s+(?:my|our|the)\s+notes?\b/i;

export function isExplicitNotesQuestion(message: string): boolean {
  if (NOT_THE_NOTES.test(message)) return false;
  return [OWN_NOTES, NOTES_SAY, ANY_NOTES, WHAT_I_WROTE].some((pattern) => pattern.test(message));
}
