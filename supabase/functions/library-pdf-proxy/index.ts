const ALLOWED_ORIGINS = new Set([
  "https://miyaal.github.io",
  "http://localhost:4000",
]);
const CATALOG_URL =
  "https://raw.githubusercontent.com/MiyaaL/MiyaaL.github.io/main/assets/library/catalog.json";
const CATALOG_TTL_MS = 60_000;

type CatalogDocument = {
  id?: string;
  source?: string;
  path?: string;
};

let catalogCache: { expiresAt: number; documents: CatalogDocument[] } | null = null;

function corsHeaders(origin: string): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "apikey, authorization, if-range, range, x-client-info",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Expose-Headers":
      "accept-ranges, content-length, content-range, content-type, etag, last-modified",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Vary": "Origin",
  };
}

function errorResponse(message: string, status: number, origin: string): Response {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return true;
  }
  if (host === "::1" || host.includes(":") &&
    (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:"))) {
    return true;
  }
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false;
  }
  return octets[0] === 10 || octets[0] === 127 || octets[0] === 0 ||
    octets[0] === 169 && octets[1] === 254 ||
    octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31 ||
    octets[0] === 192 && octets[1] === 168;
}

function validatedPdfUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || isPrivateHostname(url.hostname)) {
    throw new Error("external_url_not_allowed");
  }
  return url;
}

async function loadCatalog(force = false): Promise<CatalogDocument[]> {
  if (!force && catalogCache && catalogCache.expiresAt > Date.now()) {
    return catalogCache.documents;
  }
  const response = await fetch(CATALOG_URL, {
    headers: { "Accept": "application/json" },
  });
  if (!response.ok) {
    throw new Error("catalog_unavailable");
  }
  const catalog = await response.json();
  const documents = Array.isArray(catalog?.documents) ? catalog.documents : [];
  catalogCache = { expiresAt: Date.now() + CATALOG_TTL_MS, documents };
  return documents;
}

async function externalDocumentUrl(id: string): Promise<URL> {
  let documents = await loadCatalog();
  let document = documents.find((entry) => entry.id === id && entry.source === "external");
  if (!document) {
    documents = await loadCatalog(true);
    document = documents.find((entry) => entry.id === id && entry.source === "external");
  }
  if (!document?.path) {
    throw new Error("external_document_not_found");
  }
  return validatedPdfUrl(document.path);
}

async function fetchPdf(source: URL, request: Request): Promise<Response> {
  let current = source;
  for (let redirectCount = 0; redirectCount <= 4; redirectCount += 1) {
    const headers = new Headers({ "Accept": "application/pdf, application/octet-stream" });
    for (const name of ["Range", "If-Range"] as const) {
      const value = request.headers.get(name);
      if (value) {
        headers.set(name, value);
      }
    }
    const response = await fetch(current, {
      method: request.method === "HEAD" ? "HEAD" : "GET",
      headers,
      redirect: "manual",
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("Location");
      if (!location || redirectCount === 4) {
        throw new Error("external_redirect_invalid");
      }
      current = validatedPdfUrl(new URL(location, current).href);
      continue;
    }
    return response;
  }
  throw new Error("external_redirect_invalid");
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin") || "";
  if (!ALLOWED_ORIGINS.has(origin)) {
    return new Response(JSON.stringify({ message: "request_not_allowed" }), {
      status: 403,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return errorResponse("request_not_allowed", 405, origin);
  }

  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^url-[a-f0-9]{16}$/.test(id)) {
    return errorResponse("external_document_not_found", 404, origin);
  }

  try {
    const source = await externalDocumentUrl(id);
    const upstream = await fetchPdf(source, request);
    if (!upstream.ok && upstream.status !== 206) {
      return errorResponse("external_pdf_unavailable", upstream.status === 404 ? 404 : 502, origin);
    }
    const contentType = upstream.headers.get("Content-Type") || "application/pdf";
    if (/text\/html/i.test(contentType)) {
      return errorResponse("external_pdf_unavailable", 415, origin);
    }

    const responseHeaders = new Headers(corsHeaders(origin));
    for (const name of [
      "Accept-Ranges",
      "Content-Length",
      "Content-Range",
      "Content-Type",
      "ETag",
      "Last-Modified",
    ]) {
      const value = upstream.headers.get(name);
      if (value) {
        responseHeaders.set(name, value);
      }
    }
    responseHeaders.set("Content-Type", contentType);
    responseHeaders.set("Cache-Control", "private, max-age=300");
    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("External PDF proxy failed", error);
    const code = error instanceof Error ? error.message : "external_pdf_unavailable";
    const status = code === "external_document_not_found" ? 404 : 502;
    return errorResponse(code, status, origin);
  }
});
