import type { SupabaseClient } from "@supabase/supabase-js";

export type PartyUpTapToken = {
  token: string;
  short_code: string;
  expires_at: string;
  origin_room_id: string | null;
  origin_label: string | null;
};

export type PartyUpTapPerson = {
  profile_user_id?: string | null;
  display_name: string;
  avatar_url: string | null;
};

export type PartyUpTapRedeemResult = {
  status: "connected" | "already_connected" | "expired" | "invalid" | "self_scan";
  connection_id?: string;
  connected_at?: string;
  origin_room_id?: string | null;
  origin_label?: string | null;
  person?: PartyUpTapPerson;
};

export type PartyUpTapTokenStatus = {
  status: "ready" | "connected" | "expired" | "cancelled" | "invalid";
  expires_at?: string;
  connection_id?: string;
  person?: PartyUpTapPerson;
};

export async function createPartyUpTapToken(
  supabase: SupabaseClient,
  originRoomId?: string | null,
) {
  const { data, error } = await supabase.rpc("create_partyup_tap_token", {
    p_origin_room_id: originRoomId ?? null,
  });
  if (error) throw new Error(error.message);
  return data as PartyUpTapToken;
}

export async function cancelPartyUpTapToken(supabase: SupabaseClient, token: string) {
  const { error } = await supabase.rpc("cancel_partyup_tap_token", { p_token: token });
  if (error) throw new Error(error.message);
}

export async function getPartyUpTapTokenStatus(supabase: SupabaseClient, token: string) {
  const { data, error } = await supabase.rpc("get_partyup_tap_token_status", { p_token: token });
  if (error) throw new Error(error.message);
  return data as PartyUpTapTokenStatus;
}

export async function redeemPartyUpTapToken(
  supabase: SupabaseClient,
  tokenOrCode: string,
) {
  const { data, error } = await supabase.rpc("redeem_partyup_tap_token", {
    p_token_or_code: tokenOrCode,
  });
  if (error) throw new Error(error.message);
  return data as PartyUpTapRedeemResult;
}
