const ALLOWED_ORIGINS = new Set([
  "https://miyaal.github.io",
  "http://localhost:4000",
]);
const CATALOG_URL =
  "https://raw.githubusercontent.com/MiyaaL/MiyaaL.github.io/main/assets/tips/catalog.json";
const REPOSITORY = "MiyaaL/MiyaaL.github.io";
const MAX_FILE_SIZE = 2 * 1024 * 1024;
const CATALOG_TTL_MS = 60_000;

type CatalogDocument = {
  id?: unknown;
  source?: unknown;
  format?: unknown;
  path?: unknown;
  sha256?: unknown;
  bytes?: unknown;
  release?: {
    tag?: unknown;
    assetName?: unknown;
    downloadUrl?: unknown;
  };
};

let catalogCache: { expiresAt: number; documents: CatalogDocument[] } = {
  expiresAt: 0,
  documents: [],
};

function corsHeaders(origin: string): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function errorResponse(
  message: string,
  status: number,
  origin: string,
): Response {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

async function loadCatalog(force = false): Promise<CatalogDocument[]> {
  if (!force && catalogCache.expiresAt > Date.now()) {
    return catalogCache.documents;
  }
  const response = await fetch(
    force ? `${CATALOG_URL}?refresh=${Date.now()}` : CATALOG_URL,
    {
      headers: { "Accept": "application/json" },
    },
  );
  if (!response.ok) {
    throw new Error("catalog_unavailable");
  }
  const catalog = await response.json();
  const documents = Array.isArray(catalog?.documents)
    ? catalog.documents as CatalogDocument[]
    : [];
  catalogCache = { expiresAt: Date.now() + CATALOG_TTL_MS, documents };
  return documents;
}

function validatedDocument(entry: CatalogDocument | undefined): {
  url: URL;
  format: "markdown" | "html";
  digest: string;
  bytes: number;
} {
  if (
    !entry || entry.source !== "release" ||
    (entry.format !== "markdown" && entry.format !== "html") ||
    typeof entry.path !== "string" ||
    typeof entry.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(entry.sha256) ||
    typeof entry.bytes !== "number" ||
    !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 ||
    entry.bytes > MAX_FILE_SIZE ||
    !entry.release || typeof entry.release.tag !== "string" ||
    !/^tips-assets-[a-f0-9]{2}$/.test(entry.release.tag) ||
    typeof entry.release.assetName !== "string" ||
    !/^[a-z0-9][a-z0-9.-]{0,119}\.(?:md|html)$/.test(
      entry.release.assetName,
    )
  ) {
    throw new Error("tip_content_not_found");
  }
  const expected =
    `https://github.com/${REPOSITORY}/releases/download/${entry.release.tag}/${entry.release.assetName}`;
  if (entry.path !== expected || entry.release.downloadUrl !== expected) {
    throw new Error("tip_content_not_found");
  }
  const url = new URL(entry.path);
  if (
    url.protocol !== "https:" || url.hostname !== "github.com" ||
    url.username || url.password || url.search || url.hash
  ) {
    throw new Error("tip_content_not_found");
  }
  return {
    url,
    format: entry.format,
    digest: entry.sha256,
    bytes: entry.bytes,
  };
}

async function documentForId(
  id: string,
): Promise<ReturnType<typeof validatedDocument>> {
  let documents = await loadCatalog();
  let entry = documents.find((document) => document.id === id);
  if (!entry) {
    documents = await loadCatalog(true);
    entry = documents.find((document) => document.id === id);
  }
  return validatedDocument(entry);
}

function validatedRedirect(value: string, current: URL): URL {
  const url = new URL(value, current);
  const githubAssetHost = url.hostname === "github.com" ||
    url.hostname.endsWith(".githubusercontent.com");
  if (
    url.protocol !== "https:" || !githubAssetHost ||
    url.username || url.password
  ) {
    throw new Error("tip_redirect_invalid");
  }
  return url;
}

async function fetchAsset(source: URL): Promise<Response> {
  let current = source;
  for (let redirectCount = 0; redirectCount <= 4; redirectCount += 1) {
    const response = await fetch(current, {
      headers: {
        "Accept":
          "text/markdown, text/html, text/plain, application/octet-stream",
      },
      redirect: "manual",
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("Location");
      if (!location || redirectCount === 4) {
        throw new Error("tip_redirect_invalid");
      }
      current = validatedRedirect(location, current);
      continue;
    }
    return response;
  }
  throw new Error("tip_redirect_invalid");
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin") || "";
  if (!ALLOWED_ORIGINS.has(origin)) {
    return new Response(JSON.stringify({ message: "request_not_allowed" }), {
      status: 403,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== "GET") {
    return errorResponse("request_not_allowed", 405, origin);
  }

  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^tip-file-[a-f0-9]{16}$/.test(id)) {
    return errorResponse("tip_content_not_found", 404, origin);
  }

  try {
    const document = await documentForId(id);
    const upstream = await fetchAsset(document.url);
    if (!upstream.ok) {
      return errorResponse(
        "tip_content_unavailable",
        upstream.status === 404 ? 404 : 502,
        origin,
      );
    }
    const declaredLength = Number(upstream.headers.get("Content-Length")) || 0;
    if (declaredLength > MAX_FILE_SIZE) {
      return errorResponse("tip_content_too_large", 413, origin);
    }
    const bytes = await upstream.arrayBuffer();
    if (
      bytes.byteLength !== document.bytes ||
      bytes.byteLength > MAX_FILE_SIZE ||
      await sha256Hex(bytes) !== document.digest
    ) {
      return errorResponse("tip_content_integrity_failed", 502, origin);
    }
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (_) {
      return errorResponse("tip_content_not_utf8", 415, origin);
    }

    const responseHeaders = new Headers(corsHeaders(origin));
    responseHeaders.set(
      "Content-Type",
      document.format === "markdown"
        ? "text/markdown; charset=utf-8"
        : "text/html; charset=utf-8",
    );
    responseHeaders.set("Content-Length", String(bytes.byteLength));
    responseHeaders.set("Cache-Control", "public, max-age=300");
    responseHeaders.set("X-Content-Type-Options", "nosniff");
    return new Response(bytes, { status: 200, headers: responseHeaders });
  } catch (error) {
    console.error("Tips content proxy failed", error);
    const code = error instanceof Error
      ? error.message
      : "tip_content_unavailable";
    return errorResponse(
      code,
      code === "tip_content_not_found" ? 404 : 502,
      origin,
    );
  }
});
