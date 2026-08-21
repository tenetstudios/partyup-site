import type { SupabaseClient } from "@supabase/supabase-js";

export type RecapConnection = {
  connection_id: string;
  identity_id: string;
  profile_user_id: string | null;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  connected_at: string | null;
};

export type EventRecap = {
  id: string;
  room_id: string;
  room_title: string;
  event_date: string;
  cover_image_url: string | null;
  created_at: string;
  host_message: string | null;
  connections: RecapConnection[];
  metrics: { people: number; memories: number; matches: number; connections: number };
  personal: { connections: number; saved_memories: number };
};

export async function resolveMyEventRecaps(supabase: SupabaseClient) {
  const { error } = await supabase.rpc("resolve_my_event_recaps");
  if (error) throw new Error(error.message);
}

export async function getEventRecap(supabase: SupabaseClient, roomId: string): Promise<EventRecap> {
  await resolveMyEventRecaps(supabase);
  const { data, error } = await supabase.rpc("get_event_recap", { p_room_id: roomId });
  if (error) throw new Error(error.message);
  return data as EventRecap;
}

export function getRecapConnectionName(connection: RecapConnection) {
  return connection.display_name?.trim() || connection.username?.trim() || `Guest ${connection.identity_id.slice(0, 4)}`;
}

export function selectRecapMemories<T extends { id: string }>(items: T[], seed: string, limit = 9) {
  function hash(value: string) {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      result ^= value.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return result >>> 0;
  }

  return [...items]
    .sort((left, right) => hash(`${seed}:${left.id}`) - hash(`${seed}:${right.id}`))
    .slice(0, limit);
}
