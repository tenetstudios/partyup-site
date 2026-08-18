import type { SupabaseClient } from "@supabase/supabase-js";

export type ConnectionPerson = {
  identity_id: string;
  profile_user_id: string | null;
  identity_type: string | null;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

export type ConnectionContext = {
  type: string | null;
  label: string | null;
};

export type PartyUpConnection = {
  id: string;
  connected_at: string | null;
  source_match_session_id: string | null;
  source_pool_id: string | null;
  context: ConnectionContext;
  person: ConnectionPerson;
};

export type ProfileSocialState = {
  followers: number;
  following: number;
  is_following: boolean;
  connected: boolean;
  connection_id: string | null;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? (value as UnknownRecord) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

export function getConnectionName(connection: PartyUpConnection) {
  return (
    connection.person.display_name?.trim() ||
    connection.person.username?.trim() ||
    `Guest ${connection.person.identity_id.slice(0, 4)}`
  );
}

export function getConnectionInitial(connection: PartyUpConnection) {
  return getConnectionName(connection).slice(0, 1).toUpperCase();
}

export function getConnectionContextText(connection: PartyUpConnection) {
  const label = connection.context.label?.trim();
  const type = connection.context.type?.trim();

  if (type === "event" && label) {
    return `Met at ${label}`;
  }

  return "Met on PartyUp";
}

export function formatConnectionDate(value: string | null) {
  if (!value) {
    return "Recently";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Recently";
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

function normalizeConnection(value: unknown): PartyUpConnection {
  const record = asRecord(value);
  const person = asRecord(record.person);
  const context = asRecord(record.context);

  return {
    id: asString(record.id) ?? "",
    connected_at: asString(record.connected_at),
    source_match_session_id: asString(record.source_match_session_id),
    source_pool_id: asString(record.source_pool_id),
    context: {
      type: asString(context.type),
      label: asString(context.label),
    },
    person: {
      identity_id: asString(person.identity_id) ?? "",
      profile_user_id: asString(person.profile_user_id),
      identity_type: asString(person.identity_type),
      username: asString(person.username),
      display_name: asString(person.display_name),
      avatar_url: asString(person.avatar_url),
    },
  };
}

export function normalizeProfileSocialState(value: unknown): ProfileSocialState {
  const record = asRecord(value);

  return {
    followers: asNumber(record.followers),
    following: asNumber(record.following),
    is_following: asBoolean(record.is_following),
    connected: asBoolean(record.connected),
    connection_id: asString(record.connection_id),
  };
}

export async function getMyConnections(
  supabase: SupabaseClient,
): Promise<PartyUpConnection[]> {
  const { data, error } = await supabase.rpc("get_my_connections");

  if (error) {
    throw new Error(error.message);
  }

  if (!Array.isArray(data)) {
    return [];
  }

  return data.map(normalizeConnection).filter((connection) => connection.id);
}

export async function removePartyUpConnection(
  supabase: SupabaseClient,
  connectionId: string,
): Promise<void> {
  const { error } = await supabase.rpc("remove_partyup_connection", {
    p_connection_id: connectionId,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function getProfileSocialState(
  supabase: SupabaseClient,
  profileUserId: string,
): Promise<ProfileSocialState> {
  const { data, error } = await supabase.rpc("get_profile_social_state", {
    p_profile_user_id: profileUserId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return normalizeProfileSocialState(data);
}
