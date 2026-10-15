// How people are named on screen (SUP-24). Shared by server and client
// code; no server-only import.

export type PersonCard = {
  id: string;
  display_name: string | null;
  avatar_path: string | null;
};

// The display name when there is one; otherwise `fallback` -- the email
// where the viewer is allowed to know it (staff looking at staff), or a
// generic label ("Customer", "Support team") where they aren't.
export function personName(card: { display_name?: string | null } | undefined, fallback: string): string {
  return card?.display_name ?? fallback;
}

// "Assigned to …" for someone else's ticket, the same everywhere (ticket
// page, queue, board). Only admins see other people's tickets, and they
// can read every staff profile.
export function assignedToLabel(assignee: { full_name: string | null; email: string } | undefined): string {
  return assignee ? `Assigned to ${profileName(assignee)}` : "Assigned";
}

// For a profiles row the viewer may read in full (staff looking at staff,
// admins at everyone): the name, else the email.
export function profileName(profile: { full_name: string | null; email: string }): string {
  return profile.full_name ?? profile.email;
}

// A comment's author by name where the viewer may see it (profile_cards,
// RLS-scoped), else by role: the only possible authors are the ticket's
// customer and staff. A customer sees staff as "<name> (Support)".
export function commentAuthorLabel(
  authorId: string | null,
  viewerId: string,
  customerId: string,
  viewerIsStaff: boolean,
  people: Map<string, PersonCard>
): string {
  if (authorId === null) return "Deleted account";
  if (authorId === viewerId) return "You";
  const card = people.get(authorId);
  // A customer chooses their own name ("Support Team" included), so staff
  // always see it marked as the customer.
  if (authorId === customerId) return card?.display_name ? `${card.display_name} (Customer)` : "Customer";
  if (!card?.display_name) return "Support team";
  return viewerIsStaff ? card.display_name : `${card.display_name} (Support)`;
}
