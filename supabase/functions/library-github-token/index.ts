import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const ALLOWED_ORIGINS = new Set([
  "https://miyaal.github.io",
  "http://localhost:4000",
]);

function corsHeaders(origin: string | null): HeadersInit {
  const allowedOrigin = origin && ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://miyaal.github.io";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function jsonResponse(body: Record<string, unknown>, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function base64Url(value: Uint8Array | string): string {
  const binary = typeof value === "string"
    ? new TextEncoder().encode(value)
    : value;
  let raw = "";
  for (const byte of binary) {
    raw += String.fromCharCode(byte);
  }
  return btoa(raw).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function privateKeyBytes(pem: string): Uint8Array {
  const encoded = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function createAppJwt(appId: string, privateKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iat: now - 60,
    exp: now + 540,
    iss: appId,
  }));
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBytes(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (request.method !== "POST" || !origin || !ALLOWED_ORIGINS.has(origin)) {
    return jsonResponse({ message: "request_not_allowed" }, 403, origin);
  }

  const authorization = request.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!authorization || !supabaseUrl || !publishableKey) {
    return jsonResponse({ message: "authentication_required" }, 401, origin);
  }

  const client = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ message: "authentication_required" }, 401, origin);
  }

  const { data: isOwner, error: ownerError } = await client.rpc("is_site_owner");
  if (ownerError || isOwner !== true) {
    return jsonResponse({ message: "not_site_owner" }, 403, origin);
  }

  const appId = Deno.env.get("GITHUB_APP_ID");
  const installationId = Deno.env.get("GITHUB_APP_INSTALLATION_ID");
  const privateKey = Deno.env.get("GITHUB_APP_PRIVATE_KEY");
  if (!appId || !installationId || !privateKey) {
    return jsonResponse({ message: "github_app_not_configured" }, 503, origin);
  }

  try {
    const jwt = await createAppJwt(appId, privateKey);
    const response = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          "Accept": "application/vnd.github+json",
          "Authorization": `Bearer ${jwt}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        body: JSON.stringify({
          repositories: ["MiyaaL.github.io"],
          permissions: { contents: "write" },
        }),
      },
    );
    const result = await response.json();
    if (!response.ok || !result.token) {
      console.error("GitHub installation token request failed", response.status);
      return jsonResponse({ message: "github_token_request_failed" }, 502, origin);
    }
    return jsonResponse({
      token: result.token,
      expiresAt: result.expires_at,
    }, 200, origin);
  } catch (error) {
    console.error("GitHub App token generation failed", error);
    return jsonResponse({ message: "github_token_request_failed" }, 502, origin);
  }
});
