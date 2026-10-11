import "server-only";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";
import type { PersonCard } from "@/app/lib/people";

// Names and pictures for the people on a page (SUP-24), from
// ticketing.profile_cards -- never email or role. RLS decides which cards
// come back: an id the caller may not see is simply missing from the map,
// and the page falls back to a generic label ("Customer", "Support team").
export async function getPersonCards(ids: (string | null | undefined)[]): Promise<Map<string, PersonCard>> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === "string"))];
  if (unique.length === 0) {
    return new Map();
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("profile_cards")
    .select("id, display_name, avatar_path")
    .in("id", unique);
  if (error) {
    throw new Error(error.message);
  }
  return new Map(data.map((card) => [card.id, card]));
}
