import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import {
  classifyArchivePublication,
  type DocumentRevision,
  findDocument,
  type JsonObject,
  LIBRARY_RELEASE_COMMIT_SHA,
  releaseRefIsPinned,
  revisionForDocument,
} from "./core.ts";

const ALLOWED_ORIGINS = new Set([
  "https://miyaal.github.io",
  "http://localhost:4000",
]);
const REPOSITORY = "MiyaaL/MiyaaL.github.io";
const REPOSITORY_NAME = "MiyaaL.github.io";
const BRANCH = "main";
const CATALOG_PATH = "assets/library/catalog.json";
const RELEASE_TAG = "library-assets-v1";
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const GITHUB_API_VERSION = "2026-03-10";

type Catalog = JsonObject & { documents: JsonObject[] };
type RepositorySnapshot = {
  headSha: string;
  treeSha: string;
  catalog: Catalog;
};

class RequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "RequestError";
    this.status = status;
  }
}

class GitHubError extends Error {
  status: number;

  constructor(status: number) {
    super(`github_${status}`);
    this.name = "GitHubError";
    this.status = status;
  }
}

function corsHeaders(origin: string | null): HeadersInit {
  const allowedOrigin = origin && ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://miyaal.github.io";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function jsonResponse(
  body: unknown,
  status: number,
  origin: string | null,
): Response {
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

async function createAppJwt(
  appId: string,
  privateKey: string,
): Promise<string> {
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

function githubHeaders(token: string, extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("X-GitHub-Api-Version", GITHUB_API_VERSION);
  return headers;
}

async function githubRequest<T>(
  token: string,
  url: string,
  init: RequestInit = {},
  acceptedStatuses: number[] = [],
): Promise<{ data: T | null; status: number }> {
  const response = await fetch(url, {
    ...init,
    headers: githubHeaders(token, init.headers),
  });
  let data: T | null = null;
  if (response.status !== 204) {
    data = await response.json().catch(() => null) as T | null;
  }
  if (!response.ok && !acceptedStatuses.includes(response.status)) {
    console.error("GitHub request failed", response.status, url);
    throw new GitHubError(response.status);
  }
  return { data, status: response.status };
}

async function installationToken(): Promise<string> {
  const appId = Deno.env.get("GITHUB_APP_ID");
  const installationId = Deno.env.get("GITHUB_APP_INSTALLATION_ID");
  const privateKey = Deno.env.get("GITHUB_APP_PRIVATE_KEY");
  if (!appId || !installationId || !privateKey) {
    throw new RequestError("github_app_not_configured", 503);
  }

  let jwt: string;
  try {
    jwt = await createAppJwt(appId, privateKey);
  } catch (error) {
    console.error("GitHub App token generation failed", error);
    throw new RequestError("github_token_request_failed", 502);
  }
  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${jwt}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
      body: JSON.stringify({
        repositories: [REPOSITORY_NAME],
        permissions: { contents: "write" },
      }),
    },
  );
  const result = await response.json().catch(() => null) as
    | { token?: unknown }
    | null;
  if (!response.ok || typeof result?.token !== "string") {
    console.error("GitHub installation token request failed", response.status);
    throw new RequestError("github_token_request_failed", 502);
  }
  return result.token;
}

function githubApi(path: string): string {
  return `https://api.github.com/repos/${REPOSITORY}${path}`;
}

function decodeBase64(value: unknown): string {
  if (typeof value !== "string") {
    throw new RequestError("catalog_invalid", 502);
  }
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function parseCatalog(value: unknown): Catalog {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestError("catalog_invalid", 502);
  }
  const catalog = value as JsonObject;
  if (
    !Array.isArray(catalog.documents) ||
    catalog.documents.some((entry) =>
      !entry || typeof entry !== "object" || Array.isArray(entry)
    )
  ) {
    throw new RequestError("catalog_invalid", 502);
  }
  return catalog as Catalog;
}

function catalogWithDocuments(
  catalog: Catalog,
  documents: JsonObject[],
): Catalog {
  return {
    ...catalog,
    schemaVersion: 3,
    documents,
  };
}

async function repositorySnapshot(token: string): Promise<RepositorySnapshot> {
  const reference = await githubRequest<{ object?: { sha?: unknown } }>(
    token,
    githubApi(`/git/ref/heads/${encodeURIComponent(BRANCH)}`),
  );
  const headSha = reference.data?.object?.sha;
  if (typeof headSha !== "string" || !/^[a-f0-9]{40}$/.test(headSha)) {
    throw new RequestError("repository_state_invalid", 502);
  }

  const commit = await githubRequest<{ tree?: { sha?: unknown } }>(
    token,
    githubApi(`/git/commits/${headSha}`),
  );
  const treeSha = commit.data?.tree?.sha;
  if (typeof treeSha !== "string" || !/^[a-f0-9]{40}$/.test(treeSha)) {
    throw new RequestError("repository_state_invalid", 502);
  }

  const catalogFile = await githubRequest<
    { content?: unknown; type?: unknown }
  >(
    token,
    githubApi(`/contents/${CATALOG_PATH}?ref=${encodeURIComponent(headSha)}`),
  );
  if (catalogFile.data?.type !== "file") {
    throw new RequestError("catalog_invalid", 502);
  }
  let catalogValue: unknown;
  try {
    catalogValue = JSON.parse(decodeBase64(catalogFile.data.content));
  } catch (error) {
    if (error instanceof RequestError) {
      throw error;
    }
    throw new RequestError("catalog_invalid", 502);
  }

  return { headSha, treeSha, catalog: parseCatalog(catalogValue) };
}

async function publishCatalog(
  token: string,
  snapshot: RepositorySnapshot,
  catalog: Catalog,
  message: string,
): Promise<string> {
  const catalogJson = `${JSON.stringify(catalog, null, 2)}\n`;
  const blob = await githubRequest<{ sha?: unknown }>(
    token,
    githubApi("/git/blobs"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: catalogJson, encoding: "utf-8" }),
    },
  );
  if (typeof blob.data?.sha !== "string") {
    throw new RequestError("repository_state_invalid", 502);
  }

  const tree = await githubRequest<{ sha?: unknown }>(
    token,
    githubApi("/git/trees"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base_tree: snapshot.treeSha,
        tree: [
          {
            path: CATALOG_PATH,
            mode: "100644",
            type: "blob",
            sha: blob.data.sha,
          },
        ],
      }),
    },
  );
  if (typeof tree.data?.sha !== "string") {
    throw new RequestError("repository_state_invalid", 502);
  }

  const commit = await githubRequest<{ sha?: unknown }>(
    token,
    githubApi("/git/commits"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        tree: tree.data.sha,
        parents: [snapshot.headSha],
      }),
    },
  );
  if (typeof commit.data?.sha !== "string") {
    throw new RequestError("repository_state_invalid", 502);
  }

  await githubRequest(
    token,
    githubApi(`/git/refs/heads/${encodeURIComponent(BRANCH)}`),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha: commit.data.sha, force: false }),
    },
  );
  return commit.data.sha;
}

function cleanTitle(value: FormDataEntryValue | null): string {
  const title = typeof value === "string"
    ? value.trim().replace(/\s+/g, " ")
    : "";
  if (!title) {
    throw new RequestError("title_required", 400);
  }
  if (title.length > 160 || /[\u0000-\u001f\u007f]/.test(title)) {
    throw new RequestError("title_invalid", 400);
  }
  return title;
}

function cleanTags(entries: FormDataEntryValue[]): string[] {
  const raw = entries.map((entry) => typeof entry === "string" ? entry : "")
    .join(",");
  if (raw.length > 1024) {
    throw new RequestError("tags_invalid", 400);
  }
  const values = raw.split(",").map((entry) =>
    entry.trim().replace(/\s+/g, " ")
  ).filter(Boolean);
  if (
    values.length > 12 ||
    values.some((entry) =>
      entry.length > 48 || /[\u0000-\u001f\u007f]/.test(entry)
    )
  ) {
    throw new RequestError("tags_invalid", 400);
  }
  const seen = new Set<string>();
  return values.filter((entry) => {
    const key = entry.toLocaleLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "document";
}

async function pdfBytes(
  entry: FormDataEntryValue | null,
): Promise<{ file: File; bytes: ArrayBuffer }> {
  if (!(entry instanceof File)) {
    throw new RequestError("pdf_required", 400);
  }
  if (
    !/\.pdf$/i.test(entry.name) ||
    entry.type && entry.type !== "application/pdf"
  ) {
    throw new RequestError("pdf_required", 400);
  }
  if (!entry.size) {
    throw new RequestError("pdf_empty", 400);
  }
  if (entry.size > MAX_FILE_SIZE) {
    throw new RequestError("pdf_too_large", 413);
  }
  if (entry.name.length > 240 || /[\u0000-\u001f\u007f]/.test(entry.name)) {
    throw new RequestError("pdf_filename_invalid", 400);
  }
  const bytes = await entry.arrayBuffer();
  const signature = new Uint8Array(bytes, 0, Math.min(5, bytes.byteLength));
  if (String.fromCharCode(...signature) !== "%PDF-") {
    throw new RequestError("invalid_pdf_signature", 400);
  }
  return { file: entry, bytes };
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

type Release = {
  id?: unknown;
  tag_name?: unknown;
  immutable?: unknown;
};

async function getRelease(token: string): Promise<Release | null> {
  const response = await githubRequest<Release>(
    token,
    githubApi(`/releases/tags/${encodeURIComponent(RELEASE_TAG)}`),
    {},
    [404],
  );
  return response.status === 404 ? null : response.data;
}

function validateRelease(release: Release | null): { id: number } {
  if (
    !release || typeof release.id !== "number" ||
    !Number.isSafeInteger(release.id) ||
    release.id <= 0 || release.tag_name !== RELEASE_TAG
  ) {
    throw new RequestError("library_release_invalid", 502);
  }
  if (release.immutable === true) {
    throw new RequestError("library_release_immutable", 409);
  }
  return { id: release.id };
}

async function validateReleaseRef(token: string): Promise<void> {
  const reference = await githubRequest<unknown>(
    token,
    githubApi(`/git/ref/tags/${encodeURIComponent(RELEASE_TAG)}`),
  );
  if (!releaseRefIsPinned(reference.data)) {
    throw new RequestError("library_release_ref_invalid", 409);
  }
}

async function getOrCreateRelease(
  token: string,
  allowCreate: boolean,
): Promise<{ id: number }> {
  const existing = await getRelease(token);
  if (existing) {
    const release = validateRelease(existing);
    await validateReleaseRef(token);
    return release;
  }
  if (!allowCreate) {
    throw new RequestError(
      "legacy_repository_requires_migration",
      409,
    );
  }

  let created: Release | null;
  try {
    const response = await githubRequest<Release>(
      token,
      githubApi("/releases"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tag_name: RELEASE_TAG,
          target_commitish: LIBRARY_RELEASE_COMMIT_SHA,
          name: "Library Assets",
          body: "Mutable PDF assets used by the MiyaaL Library.",
          draft: false,
          prerelease: false,
          make_latest: "false",
        }),
      },
    );
    created = response.data;
  } catch (error) {
    if (!(error instanceof GitHubError) || error.status !== 422) {
      throw error;
    }
    created = await getRelease(token);
  }
  const release = validateRelease(created);
  await validateReleaseRef(token);
  return release;
}

type ReleaseAsset = {
  id?: unknown;
  name?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
  state?: unknown;
  digest?: unknown;
};

type ReleaseAssetIdentity = {
  assetId: number;
  releaseId: number;
  assetName: string;
  downloadUrl: string;
};

function releaseAssetIdentity(
  asset: ReleaseAsset | null,
  releaseId: number,
  assetName: string,
): ReleaseAssetIdentity {
  const expectedUrl =
    `https://github.com/${REPOSITORY}/releases/download/${RELEASE_TAG}/${assetName}`;
  if (
    !asset || typeof asset.id !== "number" || !Number.isSafeInteger(asset.id) ||
    asset.id <= 0 || asset.name !== assetName ||
    asset.browser_download_url !== expectedUrl
  ) {
    throw new RequestError("release_asset_invalid", 502);
  }
  return {
    assetId: asset.id,
    releaseId,
    assetName,
    downloadUrl: expectedUrl,
  };
}

async function uploadReleaseAsset(
  token: string,
  releaseId: number,
  assetName: string,
  bytes: ArrayBuffer,
  digest: string,
): Promise<ReleaseAssetIdentity> {
  const response = await githubRequest<ReleaseAsset>(
    token,
    `https://uploads.github.com/repos/${REPOSITORY}/releases/${releaseId}/assets?name=${
      encodeURIComponent(assetName)
    }`,
    {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: bytes,
    },
  );
  if (!response.data) {
    throw new RequestError("release_asset_invalid", 502);
  }
  return verifyReusableReleaseAsset(
    response.data,
    releaseId,
    assetName,
    bytes.byteLength,
    digest,
  );
}

async function releaseAssetsNamed(
  token: string,
  releaseId: number,
  assetName: string,
): Promise<ReleaseAsset[]> {
  const matches: ReleaseAsset[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const response = await githubRequest<ReleaseAsset[]>(
      token,
      githubApi(`/releases/${releaseId}/assets?per_page=100&page=${page}`),
    );
    if (!Array.isArray(response.data)) {
      throw new RequestError("release_asset_list_invalid", 502);
    }
    matches.push(...response.data.filter((asset) => asset.name === assetName));
    if (response.data.length < 100) {
      return matches;
    }
  }
  throw new RequestError("release_asset_list_too_large", 409);
}

async function verifyReusableReleaseAsset(
  asset: ReleaseAsset,
  releaseId: number,
  assetName: string,
  expectedBytes: number,
  expectedDigest: string,
): Promise<ReleaseAssetIdentity> {
  const identity = releaseAssetIdentity(asset, releaseId, assetName);
  if (asset.state !== "uploaded" || asset.size !== expectedBytes) {
    throw new RequestError("release_asset_name_conflict", 409);
  }
  if (typeof asset.digest === "string" && asset.digest) {
    if (asset.digest !== `sha256:${expectedDigest}`) {
      throw new RequestError("release_asset_name_conflict", 409);
    }
    return identity;
  }

  let response: Response;
  try {
    response = await fetch(identity.downloadUrl, {
      headers: { "Accept": "application/pdf, application/octet-stream" },
    });
  } catch (error) {
    console.error("Reusable Release asset download failed", error);
    throw new RequestError("release_asset_state_uncertain", 502);
  }
  if (!response.ok) {
    console.error("Reusable Release asset returned", response.status);
    throw new RequestError("release_asset_state_uncertain", 502);
  }
  const bytes = await response.arrayBuffer();
  if (
    bytes.byteLength !== expectedBytes ||
    await sha256Hex(bytes) !== expectedDigest
  ) {
    throw new RequestError("release_asset_name_conflict", 409);
  }
  return identity;
}

async function findReusableReleaseAsset(
  token: string,
  releaseId: number,
  assetName: string,
  expectedBytes: number,
  expectedDigest: string,
): Promise<ReleaseAssetIdentity | null> {
  const matches = await releaseAssetsNamed(token, releaseId, assetName);
  if (!matches.length) {
    return null;
  }
  if (matches.length !== 1) {
    throw new RequestError("release_asset_name_conflict", 409);
  }
  return verifyReusableReleaseAsset(
    matches[0],
    releaseId,
    assetName,
    expectedBytes,
    expectedDigest,
  );
}

async function uploadOrReuseReleaseAsset(
  token: string,
  releaseId: number,
  assetName: string,
  bytes: ArrayBuffer,
  digest: string,
): Promise<ReleaseAssetIdentity> {
  const reusable = await findReusableReleaseAsset(
    token,
    releaseId,
    assetName,
    bytes.byteLength,
    digest,
  );
  if (reusable) {
    return reusable;
  }
  try {
    return await uploadReleaseAsset(
      token,
      releaseId,
      assetName,
      bytes,
      digest,
    );
  } catch (error) {
    if (!(error instanceof GitHubError) || error.status !== 422) {
      throw error;
    }
    const racedAsset = await findReusableReleaseAsset(
      token,
      releaseId,
      assetName,
      bytes.byteLength,
      digest,
    );
    if (racedAsset) {
      return racedAsset;
    }
    throw error;
  }
}

async function releaseAssetState(
  token: string,
  metadata: ReleaseAssetIdentity,
): Promise<"present" | "absent"> {
  const release = validateRelease(await getRelease(token));
  await validateReleaseRef(token);
  if (release.id !== metadata.releaseId) {
    throw new RequestError("release_metadata_invalid", 409);
  }
  const response = await githubRequest<ReleaseAsset>(
    token,
    githubApi(`/releases/assets/${metadata.assetId}`),
    {},
    [404],
  );
  if (response.status === 404) {
    return "absent";
  }
  const asset = response.data;
  if (
    !asset || asset.id !== metadata.assetId ||
    asset.name !== metadata.assetName ||
    asset.browser_download_url !== metadata.downloadUrl
  ) {
    throw new RequestError("release_metadata_invalid", 409);
  }
  return "present";
}

async function ensureReleaseAssetDeleted(
  token: string,
  metadata: ReleaseAssetIdentity,
): Promise<void> {
  if (await releaseAssetState(token, metadata) === "absent") {
    return;
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let deleteError: unknown = null;
    try {
      await githubRequest(
        token,
        githubApi(`/releases/assets/${metadata.assetId}`),
        { method: "DELETE" },
        [404],
      );
    } catch (error) {
      deleteError = error;
    }

    let finalState: "present" | "absent";
    try {
      finalState = await releaseAssetState(token, metadata);
    } catch (verificationError) {
      console.error(
        "Release asset state could not be verified after deletion",
        deleteError,
        verificationError,
      );
      throw new RequestError("release_asset_state_uncertain", 502);
    }
    if (finalState === "absent") {
      return;
    }
    if (attempt === 1) {
      console.error("Release asset remained after deletion", deleteError);
      throw new RequestError("release_asset_delete_failed", 502);
    }
  }
}

function operationResult(
  action: "archive" | "delete",
  document: JsonObject,
  catalog: Catalog,
  commitSha: string,
): JsonObject {
  return {
    action,
    document,
    catalog,
    commitSha,
    commitUrl: `https://github.com/${REPOSITORY}/commit/${commitSha}`,
  };
}

async function archiveDocument(
  token: string,
  form: FormData,
): Promise<JsonObject> {
  if (form.get("action") !== "archive") {
    throw new RequestError("invalid_action", 400);
  }
  const title = cleanTitle(form.get("title"));
  const tags = cleanTags(form.getAll("tags"));
  const { file, bytes } = await pdfBytes(form.get("pdf"));
  const digest = await sha256Hex(bytes);
  const documentId = `pdf-${digest.slice(0, 16)}`;
  const snapshot = await repositorySnapshot(token);
  if (
    snapshot.catalog.documents.some((document) =>
      document.id === documentId || document.sha256 === digest
    )
  ) {
    throw new RequestError("pdf_already_archived", 409);
  }

  const mayCreateRelease = !snapshot.catalog.documents.some((document) =>
    !document.source || document.source === "repository"
  );
  const release = await getOrCreateRelease(token, mayCreateRelease);
  const assetName = `${slugify(title)}-${digest.slice(0, 12)}.pdf`;
  const asset = await uploadOrReuseReleaseAsset(
    token,
    release.id,
    assetName,
    bytes,
    digest,
  );
  const document: JsonObject = {
    id: documentId,
    source: "release",
    title,
    filename: file.name,
    path: asset.downloadUrl,
    tags,
    bytes: bytes.byteLength,
    sha256: digest,
    addedAt: new Date().toISOString(),
    release: {
      tag: RELEASE_TAG,
      releaseId: asset.releaseId,
      assetId: asset.assetId,
      assetName: asset.assetName,
      downloadUrl: asset.downloadUrl,
    },
  };
  const catalog = catalogWithDocuments(snapshot.catalog, [
    document,
    ...snapshot.catalog.documents,
  ]);

  try {
    const commitSha = await publishCatalog(
      token,
      snapshot,
      catalog,
      `library: archive ${title}`,
    );
    return operationResult("archive", document, catalog, commitSha);
  } catch (publishError) {
    let latest: RepositorySnapshot;
    try {
      latest = await repositorySnapshot(token);
    } catch (verificationError) {
      console.error(
        "Archive publication state could not be verified",
        publishError,
        verificationError,
      );
      throw new RequestError("archive_state_uncertain", 502);
    }

    const publication = classifyArchivePublication(
      latest.catalog.documents,
      document,
    );
    if (publication === "published") {
      const publishedDocument = latest.catalog.documents.find((entry) =>
        entry.id === documentId
      ) || document;
      return operationResult(
        "archive",
        publishedDocument,
        latest.catalog,
        latest.headSha,
      );
    }
    if (publication === "absent") {
      throw publishError;
    }

    console.error("Archive publication conflicted with the latest catalog");
    throw new RequestError("archive_state_uncertain", 409);
  }
}

function cleanDocumentId(value: unknown): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!/^[a-z0-9][a-z0-9-]{2,80}$/.test(id)) {
    throw new RequestError("document_id_invalid", 400);
  }
  return id;
}

function releaseMetadata(document: JsonObject): {
  assetId: number;
  releaseId: number;
  assetName: string;
  downloadUrl: string;
} {
  const metadata = document.release;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new RequestError("release_metadata_invalid", 409);
  }
  const release = metadata as JsonObject;
  if (
    release.tag !== RELEASE_TAG || typeof release.releaseId !== "number" ||
    !Number.isSafeInteger(release.releaseId) || release.releaseId <= 0 ||
    typeof release.assetId !== "number" ||
    !Number.isSafeInteger(release.assetId) ||
    release.assetId <= 0 || typeof release.assetName !== "string" ||
    !release.assetName || typeof release.downloadUrl !== "string" ||
    release.downloadUrl !== document.path
  ) {
    throw new RequestError("release_metadata_invalid", 409);
  }
  let url: URL;
  try {
    url = new URL(release.downloadUrl);
  } catch (_) {
    throw new RequestError("release_metadata_invalid", 409);
  }
  const expectedPrefix = `/${REPOSITORY}/releases/download/${RELEASE_TAG}/`;
  if (
    url.protocol !== "https:" || url.hostname !== "github.com" ||
    !url.pathname.startsWith(expectedPrefix) ||
    url.pathname !== `${expectedPrefix}${encodeURIComponent(release.assetName)}`
  ) {
    throw new RequestError("release_metadata_invalid", 409);
  }
  return {
    assetId: release.assetId,
    releaseId: release.releaseId,
    assetName: release.assetName,
    downloadUrl: release.downloadUrl,
  };
}

function cleanDocumentRevision(value: unknown): DocumentRevision {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestError("document_revision_required", 400);
  }
  const revision = value as JsonObject;
  const source = revision.source;
  const path = revision.path;
  const sha256 = revision.sha256;
  const assetId = revision.assetId;
  if (
    (source !== "release" && source !== "external" &&
      source !== "repository") ||
    typeof path !== "string" || !path || path.length > 4096 ||
    (sha256 !== null &&
      (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256))) ||
    (assetId !== null &&
      (typeof assetId !== "number" || !Number.isSafeInteger(assetId) ||
        assetId <= 0)) ||
    (source === "release" && (sha256 === null || assetId === null)) ||
    (source !== "release" && assetId !== null)
  ) {
    throw new RequestError("document_revision_invalid", 400);
  }
  return { source, path, sha256, assetId };
}

function requireDocumentMatch(
  catalog: Catalog,
  documentId: string,
  revision: DocumentRevision,
): { document: JsonObject; index: number } {
  const match = findDocument(catalog.documents, documentId, revision);
  if (match.kind === "missing") {
    throw new RequestError("document_not_found", 404);
  }
  if (match.kind === "duplicate") {
    throw new RequestError("duplicate_document_id", 409);
  }
  if (match.kind === "changed") {
    throw new RequestError("document_changed", 409);
  }
  return match;
}

async function publishDeletion(
  token: string,
  initialSnapshot: RepositorySnapshot,
  documentId: string,
  revision: DocumentRevision,
  originalDocument: JsonObject,
): Promise<JsonObject> {
  let snapshot = initialSnapshot;
  const title = typeof originalDocument.title === "string"
    ? originalDocument.title
    : documentId;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const match = requireDocumentMatch(snapshot.catalog, documentId, revision);
    const catalog = catalogWithDocuments(
      snapshot.catalog,
      snapshot.catalog.documents.filter((_, index) => index !== match.index),
    );
    try {
      const commitSha = await publishCatalog(
        token,
        snapshot,
        catalog,
        `library: remove ${title}`,
      );
      return operationResult(
        "delete",
        originalDocument,
        catalog,
        commitSha,
      );
    } catch (publishError) {
      let latest: RepositorySnapshot;
      try {
        latest = await repositorySnapshot(token);
      } catch (verificationError) {
        console.error(
          "Deletion publication state could not be verified",
          publishError,
          verificationError,
        );
        throw new RequestError("catalog_state_uncertain", 502);
      }

      const finalMatch = findDocument(
        latest.catalog.documents,
        documentId,
        revision,
      );
      if (finalMatch.kind === "missing") {
        return operationResult(
          "delete",
          originalDocument,
          latest.catalog,
          latest.headSha,
        );
      }
      if (finalMatch.kind === "duplicate") {
        throw new RequestError("duplicate_document_id", 409);
      }
      if (finalMatch.kind === "changed") {
        throw new RequestError("document_changed", 409);
      }
      if (attempt === 0) {
        snapshot = latest;
        continue;
      }
      console.error("Catalog still referenced the document after retry");
      throw new RequestError("catalog_publish_failed", 502);
    }
  }
  throw new RequestError("catalog_publish_failed", 502);
}

async function deleteDocument(
  token: string,
  body: unknown,
): Promise<JsonObject> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestError("invalid_request", 400);
  }
  const request = body as JsonObject;
  if (request.action !== "delete") {
    throw new RequestError("invalid_action", 400);
  }
  const documentId = cleanDocumentId(request.documentId);
  const revision = cleanDocumentRevision(request.revision);
  const snapshot = await repositorySnapshot(token);
  const initialMatch = findDocument(
    snapshot.catalog.documents,
    documentId,
    revision,
  );
  if (initialMatch.kind === "missing") {
    if (revision.source === "repository") {
      throw new RequestError("legacy_repository_requires_migration", 409);
    }
    return operationResult(
      "delete",
      { id: documentId, ...revision },
      snapshot.catalog,
      snapshot.headSha,
    );
  }
  if (initialMatch.kind === "duplicate") {
    throw new RequestError("duplicate_document_id", 409);
  }
  if (initialMatch.kind === "changed") {
    throw new RequestError("document_changed", 409);
  }
  const document = initialMatch.document;
  const source = revisionForDocument(document).source;
  if (source === "repository") {
    throw new RequestError("legacy_repository_requires_migration", 409);
  }
  if (source === "release") {
    await ensureReleaseAssetDeleted(token, releaseMetadata(document));
  } else if (source !== "external") {
    throw new RequestError("document_source_invalid", 409);
  }

  return publishDeletion(
    token,
    snapshot,
    documentId,
    revision,
    document,
  );
}

async function authenticateOwner(request: Request): Promise<void> {
  const authorization = request.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!authorization || !supabaseUrl || !publishableKey) {
    throw new RequestError("authentication_required", 401);
  }

  const client = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) {
    throw new RequestError("authentication_required", 401);
  }
  const { data: isOwner, error: ownerError } = await client.rpc(
    "is_site_owner",
  );
  if (ownerError || isOwner !== true) {
    throw new RequestError("not_site_owner", 403);
  }
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") {
    if (!origin || !ALLOWED_ORIGINS.has(origin)) {
      return jsonResponse({ message: "request_not_allowed" }, 403, origin);
    }
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== "POST" || !origin || !ALLOWED_ORIGINS.has(origin)) {
    return jsonResponse({ message: "request_not_allowed" }, 403, origin);
  }

  try {
    await authenticateOwner(request);
    const contentType = request.headers.get("Content-Type") || "";
    const token = await installationToken();
    if (contentType.toLowerCase().startsWith("multipart/form-data")) {
      const result = await archiveDocument(token, await request.formData());
      return jsonResponse(result, 201, origin);
    }
    if (contentType.toLowerCase().startsWith("application/json")) {
      const result = await deleteDocument(token, await request.json());
      return jsonResponse(result, 200, origin);
    }
    throw new RequestError("unsupported_content_type", 415);
  } catch (error) {
    if (error instanceof RequestError) {
      return jsonResponse({ message: error.message }, error.status, origin);
    }
    if (error instanceof GitHubError) {
      const conflict = error.status === 409 || error.status === 422;
      return jsonResponse(
        { message: conflict ? "repository_changed" : "github_request_failed" },
        conflict ? 409 : 502,
        origin,
      );
    }
    if (error instanceof SyntaxError) {
      return jsonResponse({ message: "invalid_request" }, 400, origin);
    }
    console.error("Library document operation failed", error);
    return jsonResponse({ message: "library_operation_failed" }, 500, origin);
  }
});
