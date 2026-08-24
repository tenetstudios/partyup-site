import type { SupabaseClient } from "@supabase/supabase-js";
import { requestPushDispatch } from "./pushDispatch";

export type LiveNodeStatus = "draft" | "armed" | "active" | "claimed" | "ended";

export type LiveNodeWinner = {
  claim_id: string;
  identity_id: string;
  display_name: string;
  avatar_url: string | null;
  claimed_at: string;
  fulfilled_at: string | null;
};

export type LiveNode = {
  id: string;
  room_id: string;
  mission_id: string | null;
  name: string;
  description: string | null;
  reward_description: string | null;
  status: LiveNodeStatus;
  max_claims: number;
  token_hint: string;
  starts_at: string | null;
  ends_at: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
  claim_count: number;
  winner: LiveNodeWinner | null;
};

export type LiveNodeScanStatus =
  | "active"
  | "winner"
  | "inactive"
  | "claimed"
  | "already_claimed_by_you"
  | "ended"
  | "room_ended"
  | "not_eligible"
  | "invalid";

export type LiveNodeScanState = {
  status: LiveNodeScanStatus;
  node_id?: string;
  room_id?: string;
  name?: string;
  description?: string | null;
  reward_description?: string | null;
  eligible?: boolean;
  claim_position?: number | null;
  claimed_at?: string | null;
  fulfilled_at?: string | null;
};

export async function getRoomLiveNodes(supabase: SupabaseClient, roomId: string) {
  const { data, error } = await supabase.rpc("get_room_live_nodes", { p_room_id: roomId });
  if (error) throw new Error(error.message);
  return (data ?? []) as LiveNode[];
}

export async function createLiveNode(
  supabase: SupabaseClient,
  roomId: string,
  input: { name: string; description?: string; rewardDescription?: string; maxClaims?: number },
) {
  const { data, error } = await supabase.rpc("create_live_node", {
    p_room_id: roomId,
    p_name: input.name,
    p_description: input.description?.trim() || null,
    p_reward_description: input.rewardDescription?.trim() || null,
    p_max_claims: input.maxClaims ?? 1,
    p_ends_at: null,
  });
  if (error) throw new Error(error.message);
  return data as { node: LiveNode; claim_token: string };
}

export async function rotateLiveNodeToken(supabase: SupabaseClient, nodeId: string) {
  const { data, error } = await supabase.rpc("rotate_live_node_token", { p_node_id: nodeId });
  if (error) throw new Error(error.message);
  return data as { node: LiveNode; claim_token: string };
}

export async function setLiveNodeStatus(
  supabase: SupabaseClient,
  nodeId: string,
  status: "armed" | "active" | "ended",
) {
  const { data, error } = await supabase.rpc("set_live_node_status", {
    p_node_id: nodeId,
    p_status: status,
  });
  if (error) throw new Error(error.message);
  const node = data as LiveNode;
  if (status === "active") requestPushDispatch(supabase, node.room_id);
  return node;
}

export async function fulfillLiveNodeClaim(supabase: SupabaseClient, nodeId: string) {
  const { data, error } = await supabase.rpc("fulfill_live_node_claim", { p_node_id: nodeId });
  if (error) throw new Error(error.message);
  return data;
}

export async function getLiveNodeScanState(
  supabase: SupabaseClient,
  token: string,
  guestToken?: string | null,
) {
  const { data, error } = await supabase.rpc("get_live_node_scan_state", {
    p_token: token,
    p_guest_token: guestToken ?? null,
  });
  if (error) throw new Error(error.message);
  return data as LiveNodeScanState;
}

export async function claimLiveNode(
  supabase: SupabaseClient,
  token: string,
  guestToken?: string | null,
) {
  const { data, error } = await supabase.rpc("claim_live_node", {
    p_token: token,
    p_guest_token: guestToken ?? null,
  });
  if (error) throw new Error(error.message);
  return data as LiveNodeScanState;
}
