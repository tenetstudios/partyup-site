// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type JsonBody = {
  guestToken?: unknown;
};

type GuestSessionRow = {
  identity_id: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function errorResponse(message: string, status: number) {
  return jsonResponse({ error: message }, status);
}

function base64Url(bytes: Uint8Array) {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256Hex(value: string) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createGuestToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  return base64Url(bytes);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed.", 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return errorResponse("Server configuration is incomplete.", 500);
  }

  let body: JsonBody = {};

  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  if (typeof body.guestToken === "string" && body.guestToken.length >= 32) {
    const existingHash = await sha256Hex(body.guestToken);
    const { data: existing, error: existingError } = await adminClient
      .from("partyup_guest_sessions")
      .select("identity_id")
      .eq("token_hash", existingHash)
      .is("revoked_at", null)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .maybeSingle<GuestSessionRow>();

    if (existingError) {
      return errorResponse("Could not validate guest session.", 500);
    }

    if (existing?.identity_id) {
      await adminClient
        .from("partyup_guest_sessions")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("token_hash", existingHash);

      return jsonResponse({
        guestToken: body.guestToken,
        identityId: existing.identity_id,
      });
    }
  }

  const guestToken = createGuestToken();
  const tokenHash = await sha256Hex(guestToken);

  const { data: identity, error: identityError } = await adminClient
    .from("partyup_identities")
    .insert({
      identity_type: "guest",
      user_id: null,
    })
    .select("id")
    .single();

  if (identityError || !identity?.id) {
    return errorResponse(identityError?.message || "Could not create guest identity.", 500);
  }

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const { error: sessionError } = await adminClient.from("partyup_guest_sessions").insert({
    identity_id: identity.id,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });

  if (sessionError) {
    return errorResponse(sessionError.message, 500);
  }

  return jsonResponse({
    guestToken,
    identityId: identity.id,
    expiresAt,
  });
});
