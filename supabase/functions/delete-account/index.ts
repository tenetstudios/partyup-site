/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const recentSignInWindowMs = 15 * 60 * 1000;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("Authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : null;
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function listFilesAtPrefix(adminClient: ReturnType<typeof createClient>, bucket: string, prefix: string) {
  const paths: string[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await adminClient.storage.from(bucket).list(prefix, {
      limit: 100,
      offset,
      sortBy: { column: "name", order: "asc" },
    });

    if (error) throw error;
    const rows = data || [];
    paths.push(...rows.filter((row) => row.id).map((row) => `${prefix}/${row.name}`));
    if (rows.length < 100) break;
    offset += rows.length;
  }

  return paths;
}

async function removePaths(adminClient: ReturnType<typeof createClient>, bucket: string, paths: string[]) {
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  for (const pathChunk of chunks(uniquePaths, 100)) {
    const { error } = await adminClient.storage.from(bucket).remove(pathChunk);
    if (error) throw error;
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const token = bearerToken(request);

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Server configuration is incomplete." }, 500);
  }
  if (!token) return jsonResponse({ error: "Authentication required." }, 401);

  let body: { confirmed?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Malformed JSON request." }, 400);
  }
  if (body.confirmed !== true) return jsonResponse({ error: "Deletion confirmation is required." }, 400);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await adminClient.auth.getUser(token);
  const user = userData.user;
  if (userError || !user) return jsonResponse({ error: "Authentication required." }, 401);

  const lastSignInAt = Date.parse(user.last_sign_in_at || "");
  // Anonymous accounts cannot reauthenticate as the same temporary identity. The
  // authenticated bearer token plus the explicit confirmation remains required.
  if (!user.is_anonymous && (!Number.isFinite(lastSignInAt) || Date.now() - lastSignInAt > recentSignInWindowMs)) {
    return jsonResponse({
      error: "Please verify your identity again before deleting your account.",
      code: "reauthentication_required",
    }, 403);
  }

  const requestId = crypto.randomUUID();

  try {
    const { data: prepared, error: prepareError } = await adminClient.rpc("prepare_account_deletion", {
      p_user_id: user.id,
      p_request_id: requestId,
    });
    if (prepareError) throw prepareError;

    const storagePaths = prepared?.storage_paths || {};
    const memoryPaths = Array.isArray(storagePaths["room-memories"])
      ? storagePaths["room-memories"]
      : [];
    const imagePrefixes = Array.isArray(storagePaths["event-images-prefixes"])
      ? storagePaths["event-images-prefixes"]
      : [user.id];

    await removePaths(adminClient, "room-memories", memoryPaths);

    const imagePaths: string[] = [];
    for (const prefix of new Set<string>(imagePrefixes)) {
      imagePaths.push(...await listFilesAtPrefix(adminClient, "event-images", prefix));
    }
    await removePaths(adminClient, "event-images", imagePaths);

    const profileImagePaths = await listFilesAtPrefix(adminClient, "profile-images", user.id);
    await removePaths(adminClient, "profile-images", profileImagePaths);

    const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(user.id, false);
    if (deleteUserError) throw deleteUserError;

    await adminClient.rpc("set_account_deletion_result", {
      p_user_id: user.id,
      p_request_id: requestId,
      p_status: "completed",
      p_error: null,
    });

    return jsonResponse({ status: "completed", requestId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Account deletion failed.";
    await adminClient.rpc("set_account_deletion_result", {
      p_user_id: user.id,
      p_request_id: requestId,
      p_status: "failed",
      p_error: message,
    });
    return jsonResponse({ error: "Account deletion could not be completed. Please try again.", requestId }, 500);
  }
});
