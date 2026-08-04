export const LIBRARY_RELEASE_COMMIT_SHA =
  "fcc0bf7af1965376521c89a61ba2269f5b28ea72";

export type JsonObject = Record<string, unknown>;

export type DocumentRevision = {
  source: string;
  path: string;
  sha256: string | null;
  assetId: number | null;
};

export type DocumentMatch =
  | { kind: "missing" }
  | { kind: "duplicate" }
  | { kind: "changed"; document: JsonObject; index: number }
  | { kind: "match"; document: JsonObject; index: number };

function releaseAssetId(document: JsonObject): number | null {
  const metadata = document.release;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const assetId = (metadata as JsonObject).assetId;
  return typeof assetId === "number" && Number.isSafeInteger(assetId) &&
      assetId > 0
    ? assetId
    : null;
}

export function revisionForDocument(document: JsonObject): DocumentRevision {
  return {
    source: typeof document.source === "string"
      ? document.source
      : "repository",
    path: typeof document.path === "string" ? document.path : "",
    sha256: typeof document.sha256 === "string" ? document.sha256 : null,
    assetId: releaseAssetId(document),
  };
}

export function revisionsEqual(
  left: DocumentRevision,
  right: DocumentRevision,
): boolean {
  return left.source === right.source && left.path === right.path &&
    left.sha256 === right.sha256 && left.assetId === right.assetId;
}

export function findDocument(
  documents: JsonObject[],
  documentId: string,
  expected?: DocumentRevision,
): DocumentMatch {
  const matches = documents.reduce<
    Array<{ document: JsonObject; index: number }>
  >(
    (result, document, index) => {
      if (document.id === documentId) {
        result.push({ document, index });
      }
      return result;
    },
    [],
  );
  if (!matches.length) {
    return { kind: "missing" };
  }
  if (matches.length > 1) {
    return { kind: "duplicate" };
  }
  const match = matches[0];
  if (
    expected && !revisionsEqual(revisionForDocument(match.document), expected)
  ) {
    return { kind: "changed", ...match };
  }
  return { kind: "match", ...match };
}

export function classifyArchivePublication(
  documents: JsonObject[],
  expectedDocument: JsonObject,
): "published" | "absent" | "conflict" {
  const documentId = expectedDocument.id;
  const digest = expectedDocument.sha256;
  if (typeof documentId !== "string" || typeof digest !== "string") {
    return "conflict";
  }
  const candidates = documents.filter((document) =>
    document.id === documentId || document.sha256 === digest
  );
  if (!candidates.length) {
    return "absent";
  }
  if (candidates.length !== 1) {
    return "conflict";
  }
  const candidate = candidates[0];
  return candidate.id === documentId && candidate.sha256 === digest &&
      revisionsEqual(
        revisionForDocument(candidate),
        revisionForDocument(expectedDocument),
      )
    ? "published"
    : "conflict";
}

export function releaseRefIsPinned(reference: unknown): boolean {
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
    return false;
  }
  const object = (reference as JsonObject).object;
  if (!object || typeof object !== "object" || Array.isArray(object)) {
    return false;
  }
  const target = object as JsonObject;
  return target.type === "commit" && target.sha === LIBRARY_RELEASE_COMMIT_SHA;
}
