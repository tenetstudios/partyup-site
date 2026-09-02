import type { SupabaseClient } from "@supabase/supabase-js";

export type ProfileUpdateResult = {
  status: "updated" | "name_taken" | "invalid_name" | "invalid_bio" | "invalid_location" | "not_authenticated" | "profile_not_found";
  message: string;
  username: string | null;
};

function text(value: unknown) {
  return typeof value === "string" ? value : null;
}

export async function updateMyProfile(
  supabase: SupabaseClient,
  input: {
    username: string;
    avatarUrl?: string | null;
    bio?: string | null;
    location?: string | null;
    updateDetails?: boolean;
  },
): Promise<ProfileUpdateResult> {
  const { data, error } = await supabase.rpc("update_my_profile", {
    p_username: input.username,
    p_avatar_url: input.avatarUrl ?? null,
    p_bio: input.bio ?? null,
    p_location: input.location ?? null,
    p_update_details: input.updateDetails === true,
  });

  if (error) {
    throw new Error(error.message);
  }

  const result = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const status = text(result.status);

  if (
    status !== "updated" &&
    status !== "name_taken" &&
    status !== "invalid_name" &&
    status !== "invalid_bio" &&
    status !== "invalid_location" &&
    status !== "not_authenticated" &&
    status !== "profile_not_found"
  ) {
    throw new Error("The profile update returned an unexpected response.");
  }

  return {
    status,
    message: text(result.message) ?? "Your profile could not be updated.",
    username: text(result.username),
  };
}
