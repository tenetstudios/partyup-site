import type { SupabaseClient } from "@supabase/supabase-js";

export function requestPushDispatch(supabase: SupabaseClient, roomId: string | null | undefined) {
  if (!roomId) return;
  void supabase.functions.invoke("dispatch-push-notifications", { body: { roomId } }).then(({ error }) => {
    if (error) console.warn("Push dispatch fallback failed:", error.message);
  });
}
