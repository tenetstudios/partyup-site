import type { SupabaseClient } from "@supabase/supabase-js";

export type PartyUpIdentity = {
  id: string;
};

export type MatchPool = {
  id: string;
  name?: string | null;
  pool_type?: string | null;
  slug: string;
  source_id?: string | null;
  status?: string | null;
  expires_at?: string | null;
};

export type MatchSession = {
  id: string;
  ended_reason: string | null;
  expires_at: string | null;
  status: string | null;
};

export type MatchQueueState = {
  status: string | null;
  match_session_id: string | null;
};

export type EnqueueMatchResult = {
  matched: boolean;
  session_id: string | null;
  opponent_identity_id: string | null;
  identity_id?: string | null;
};

export type MatchConnectionResult = {
  saved?: boolean;
  mutual: boolean;
  connectionId: string | null;
};

export type EventMatchPoolResult = {
  poolId: string;
  name: string | null;
  sourceEventRoomId: string;
};

export type GuestSession = {
  guestToken: string;
  identityId: string;
  expiresAt?: string | null;
};

export type ClaimGuestIdentityResult = {
  claimed: boolean;
  identityId: string | null;
  conflict: boolean;
  message: string | null;
};

type UnknownRecord = Record<string, unknown>;

function firstRow(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function readString(record: UnknownRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return null;
}

function readBoolean(record: UnknownRecord, keys: string[]): boolean {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
  }

  return false;
}

export function normalizeIdentity(data: unknown): PartyUpIdentity {
  if (typeof data === "string" && data.length > 0) {
    return { id: data };
  }

  const row = firstRow(data);
  if (row && typeof row === "object") {
    const id = readString(row as UnknownRecord, ["id", "identity_id", "partyup_identity_id"]);
    if (id) {
      return { id };
    }
  }

  throw new Error("Could not resolve your PartyUp identity.");
}

export function normalizeEnqueueResult(data: unknown): EnqueueMatchResult {
  const row = firstRow(data);
  if (!row || typeof row !== "object") {
    throw new Error("Matchmaking returned an unexpected response.");
  }

  const record = row as UnknownRecord;

  return {
    matched: readBoolean(record, ["matched"]),
    session_id: readString(record, ["session_id", "match_session_id"]),
    opponent_identity_id: readString(record, ["opponent_identity_id"]),
    identity_id: readString(record, ["identity_id"]),
  };
}

export function normalizeMatchConnectionResult(data: unknown): MatchConnectionResult {
  const row = firstRow(data);
  if (!row || typeof row !== "object") {
    throw new Error("Match connection returned an unexpected response.");
  }

  const record = row as UnknownRecord;

  return {
    saved: readBoolean(record, ["saved"]),
    mutual: readBoolean(record, ["mutual"]),
    connectionId: readString(record, ["connection_id", "connectionId"]),
  };
}

export function normalizeEventMatchPoolResult(data: unknown): EventMatchPoolResult {
  const row = firstRow(data);
  if (!row || typeof row !== "object") {
    throw new Error("Event Match pool returned an unexpected response.");
  }

  const record = row as UnknownRecord;
  const poolId = readString(record, ["pool_id", "id"]);
  const sourceEventRoomId = readString(record, ["source_event_room_id", "source_id"]);

  if (!poolId || !sourceEventRoomId) {
    throw new Error("Event Match pool returned an incomplete response.");
  }

  return {
    poolId,
    name: readString(record, ["name"]),
    sourceEventRoomId,
  };
}

export function normalizeGuestSession(data: unknown): GuestSession {
  if (!data || typeof data !== "object") {
    throw new Error("Guest session returned an unexpected response.");
  }

  const record = data as UnknownRecord;
  const guestToken = readString(record, ["guestToken", "guest_token"]);
  const identityId = readString(record, ["identityId", "identity_id"]);

  if (!guestToken || !identityId) {
    throw new Error("Guest session returned an incomplete response.");
  }

  return {
    guestToken,
    identityId,
    expiresAt: readString(record, ["expiresAt", "expires_at"]),
  };
}

export function normalizeClaimGuestIdentityResult(data: unknown): ClaimGuestIdentityResult {
  const row = firstRow(data);
  if (!row || typeof row !== "object") {
    throw new Error("Guest claim returned an unexpected response.");
  }

  const record = row as UnknownRecord;

  return {
    claimed: readBoolean(record, ["claimed"]),
    identityId: readString(record, ["identity_id", "identityId"]),
    conflict: readBoolean(record, ["conflict"]),
    message: readString(record, ["message"]),
  };
}

const guestTokenStorageKey = "partyup_guest_token";
const guestIdentityStorageKey = "partyup_guest_identity_id";

export function readStoredGuestSession(): GuestSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  const guestToken = window.localStorage.getItem(guestTokenStorageKey);
  const identityId = window.localStorage.getItem(guestIdentityStorageKey);

  if (!guestToken || !identityId) {
    return null;
  }

  return { guestToken, identityId };
}

export function storeGuestSession(session: GuestSession) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(guestTokenStorageKey, session.guestToken);
  window.localStorage.setItem(guestIdentityStorageKey, session.identityId);
}

export function clearStoredGuestSession() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(guestTokenStorageKey);
  window.localStorage.removeItem(guestIdentityStorageKey);
}

export async function ensurePartyUpIdentity(supabase: SupabaseClient): Promise<PartyUpIdentity> {
  const { data, error } = await supabase.rpc("ensure_partyup_identity");

  if (error) {
    throw new Error(error.message);
  }

  return normalizeIdentity(data);
}

export async function getGlobalMatchPool(supabase: SupabaseClient): Promise<MatchPool> {
  const { data, error } = await supabase
    .from("match_pools")
    .select("id, slug")
    .eq("slug", "global")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data?.id) {
    throw new Error('The global Match pool was not found.');
  }

  return data as MatchPool;
}

export async function getMatchPool(
  supabase: SupabaseClient,
  poolId: string,
): Promise<MatchPool> {
  const { data, error } = await supabase.rpc("get_match_pool_for_match", {
    p_pool_id: poolId,
  });

  if (error) {
    throw new Error(error.message);
  }

  const row = firstRow(data);

  if (!row || typeof row !== "object") {
    throw new Error("That Match pool was not found.");
  }

  const pool = row as MatchPool;

  if (pool.status !== "active") {
    throw new Error("That Match pool is not active.");
  }

  if (pool.expires_at && Date.parse(pool.expires_at) <= Date.now()) {
    throw new Error("That Match pool has ended.");
  }

  return pool;
}

export async function getOrCreateEventMatchPool(
  supabase: SupabaseClient,
  eventRoomId: string,
): Promise<EventMatchPoolResult> {
  const { data, error } = await supabase.rpc("get_or_create_event_match_pool", {
    p_event_room_id: eventRoomId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return normalizeEventMatchPoolResult(data);
}

export async function enqueueAndMatch(
  supabase: SupabaseClient,
  poolId: string,
): Promise<EnqueueMatchResult> {
  const { data, error } = await supabase.rpc("enqueue_and_match", { p_pool_id: poolId });

  if (error) {
    throw new Error(error.message);
  }

  return normalizeEnqueueResult(data);
}

export async function createGuestSession(supabase: SupabaseClient): Promise<GuestSession> {
  const existing = readStoredGuestSession();
  const { data, error } = await supabase.functions.invoke("create-guest-session", {
    body: {
      guestToken: existing?.guestToken,
    },
  });

  if (error) {
    throw new Error(error.message);
  }

  const session = normalizeGuestSession(data);
  storeGuestSession(session);

  return session;
}

export async function guestEnqueueAndMatch(
  supabase: SupabaseClient,
  poolId: string,
  guestToken: string,
): Promise<EnqueueMatchResult> {
  const { data, error } = await supabase.rpc("guest_enqueue_and_match", {
    p_pool_id: poolId,
    p_guest_token: guestToken,
  });

  if (error) {
    throw new Error(error.message);
  }

  return normalizeEnqueueResult(data);
}

export async function nextMatch(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<EnqueueMatchResult> {
  const { data, error } = await supabase.rpc("next_match", { p_match_session_id: sessionId });

  if (error) {
    throw new Error(error.message);
  }

  return normalizeEnqueueResult(data);
}

export async function guestNextMatch(
  supabase: SupabaseClient,
  sessionId: string,
  guestToken: string,
): Promise<EnqueueMatchResult> {
  const { data, error } = await supabase.rpc("guest_next_match", {
    p_match_session_id: sessionId,
    p_guest_token: guestToken,
  });

  if (error) {
    throw new Error(error.message);
  }

  return normalizeEnqueueResult(data);
}

export async function endMatchSession(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<void> {
  const { error } = await supabase.rpc("end_match_session", {
    p_match_session_id: sessionId,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function guestEndMatchSession(
  supabase: SupabaseClient,
  sessionId: string,
  guestToken: string,
): Promise<void> {
  const { error } = await supabase.rpc("guest_end_match_session", {
    p_match_session_id: sessionId,
    p_guest_token: guestToken,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function keepMatchConnection(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<MatchConnectionResult> {
  const { data, error } = await supabase.rpc("keep_match_connection", {
    p_match_session_id: sessionId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return normalizeMatchConnectionResult(data);
}

export async function guestKeepMatchConnection(
  supabase: SupabaseClient,
  sessionId: string,
  guestToken: string,
): Promise<MatchConnectionResult> {
  const { data, error } = await supabase.rpc("guest_keep_match_connection", {
    p_match_session_id: sessionId,
    p_guest_token: guestToken,
  });

  if (error) {
    throw new Error(error.message);
  }

  return normalizeMatchConnectionResult(data);
}

export async function getMatchConnectionState(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<MatchConnectionResult> {
  const { data, error } = await supabase.rpc("get_match_connection_state", {
    p_match_session_id: sessionId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return normalizeMatchConnectionResult(data);
}

export async function guestGetMatchConnectionState(
  supabase: SupabaseClient,
  sessionId: string,
  guestToken: string,
): Promise<MatchConnectionResult> {
  const { data, error } = await supabase.rpc("guest_get_match_connection_state", {
    p_match_session_id: sessionId,
    p_guest_token: guestToken,
  });

  if (error) {
    throw new Error(error.message);
  }

  return normalizeMatchConnectionResult(data);
}

export async function cancelMatchSearch(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.rpc("cancel_match_search");

  if (error) {
    throw new Error(error.message);
  }
}

export async function guestCancelMatchSearch(
  supabase: SupabaseClient,
  guestToken: string,
): Promise<void> {
  const { error } = await supabase.rpc("guest_cancel_match_search", {
    p_guest_token: guestToken,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function claimGuestIdentity(
  supabase: SupabaseClient,
  guestToken: string,
): Promise<ClaimGuestIdentityResult> {
  const { data, error } = await supabase.rpc("claim_guest_identity", {
    p_guest_token: guestToken,
  });

  if (error) {
    throw new Error(error.message);
  }

  const result = normalizeClaimGuestIdentityResult(data);

  if (result.claimed) {
    clearStoredGuestSession();
  }

  return result;
}

export async function getMatchSession(
  supabase: SupabaseClient,
  sessionId: string,
  guestToken?: string | null,
): Promise<MatchSession> {
  const { data, error } = guestToken
    ? await supabase.rpc("guest_get_match_session", {
        p_match_session_id: sessionId,
        p_guest_token: guestToken,
      })
    : await supabase.rpc("get_match_session_for_current_identity", {
        p_match_session_id: sessionId,
      });

  if (error) {
    throw new Error(error.message);
  }

  const row = firstRow(data);

  if (!row || typeof row !== "object") {
    throw new Error("The matched session could not be loaded.");
  }

  return row as MatchSession;
}

export function isMatchSessionExpired(session: MatchSession): boolean {
  if (!session.expires_at) {
    return false;
  }

  const expiresAtMs = Date.parse(session.expires_at);

  if (Number.isNaN(expiresAtMs)) {
    return true;
  }

  return expiresAtMs <= Date.now();
}

export async function getCurrentMatchQueueState(
  supabase: SupabaseClient,
  identityId: string,
): Promise<MatchQueueState | null> {
  const { data, error } = await supabase
    .from("match_queue")
    .select("status, match_session_id")
    .eq("identity_id", identityId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as MatchQueueState | null;
}

export async function guestGetCurrentMatchQueueState(
  supabase: SupabaseClient,
  guestToken: string,
): Promise<MatchQueueState | null> {
  const { data, error } = await supabase.rpc("guest_get_current_match_queue_state", {
    p_guest_token: guestToken,
  });

  if (error) {
    throw new Error(error.message);
  }

  const row = firstRow(data);

  return (row as MatchQueueState | null) ?? null;
}
