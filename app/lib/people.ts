// How people are named on screen (SUP-24). Shared by server and client
// code; no server-only import.

export type PersonCard = {
  id: string;
  display_name: string | null;
  avatar_path: string | null;
  is_staff: boolean;
};

// The display name when there is one; otherwise `fallback` -- the email
// where the viewer is allowed to know it (staff looking at staff), or a
// generic label ("Customer", "Support team") where they aren't.
export function personName(card: Pick<PersonCard, "display_name"> | undefined, fallback: string): string {
  return card?.display_name ?? fallback;
}
