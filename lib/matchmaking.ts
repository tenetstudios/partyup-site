import type { SupabaseClient } from "@supabase/supabase-js";

export type PartyUpIdentity = {
  id: string;
};

export type MatchPool = {
  id: string;
  slug: string;
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
};

export type MatchConnectionResult = {
  saved?: boolean;
  mutual: boolean;
  connectionId: string | null;
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

export async function cancelMatchSearch(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.rpc("cancel_match_search");

  if (error) {
    throw new Error(error.message);
  }
}

export async function getMatchSession(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<MatchSession> {
  const { data, error } = await supabase
    .from("match_sessions")
    .select("id, ended_reason, expires_at, status")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data?.id) {
    throw new Error("The matched session could not be loaded.");
  }

  return data as MatchSession;
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
