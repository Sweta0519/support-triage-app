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
