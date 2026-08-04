import {
  classifyArchivePublication,
  type DocumentRevision,
  findDocument,
  type JsonObject,
  LIBRARY_RELEASE_COMMIT_SHA,
  releaseRefIsPinned,
  revisionForDocument,
  revisionsEqual,
} from "./core.ts";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      message ??
        `Expected ${JSON.stringify(expected)}, received ${
          JSON.stringify(actual)
        }`,
    );
  }
}

function releaseDocument(overrides: JsonObject = {}): JsonObject {
  const assetName = "paper-deadbeef.pdf";
  const downloadUrl =
    `https://github.com/MiyaaL/MiyaaL.github.io/releases/download/library-assets-v1/${assetName}`;
  return {
    id: "pdf-deadbeefdeadbeef",
    source: "release",
    path: downloadUrl,
    sha256: "deadbeef".repeat(8),
    release: {
      tag: "library-assets-v1",
      releaseId: 17,
      assetId: 23,
      assetName,
      downloadUrl,
    },
    ...overrides,
  };
}

Deno.test("revisionForDocument creates a stable deletion revision", () => {
  assertEquals(revisionForDocument(releaseDocument()), {
    source: "release",
    path:
      "https://github.com/MiyaaL/MiyaaL.github.io/releases/download/library-assets-v1/paper-deadbeef.pdf",
    sha256: "deadbeef".repeat(8),
    assetId: 23,
  });

  assertEquals(revisionForDocument({ id: "legacy-document" }), {
    source: "repository",
    path: "",
    sha256: null,
    assetId: null,
  });
});

Deno.test("revisionsEqual requires every deletion revision field to match", () => {
  const expected = revisionForDocument(releaseDocument());
  assert(revisionsEqual(expected, { ...expected }));

  const mismatches: DocumentRevision[] = [
    { ...expected, source: "external" },
    { ...expected, path: `${expected.path}?changed=1` },
    { ...expected, sha256: "cafebabe".repeat(8) },
    { ...expected, assetId: 24 },
  ];
  for (const actual of mismatches) {
    assert(!revisionsEqual(actual, expected));
  }
});

Deno.test("findDocument distinguishes matching and changed revisions", () => {
  const document = releaseDocument();
  const expected = revisionForDocument(document);
  const match = findDocument([document], String(document.id), expected);
  assertEquals(match.kind, "match");
  assert(match.kind === "match");
  assertEquals(match.index, 0);
  assert(match.document === document);

  const changedDocument = releaseDocument({
    path:
      "https://github.com/MiyaaL/MiyaaL.github.io/releases/download/library-assets-v1/replaced.pdf",
    release: {
      tag: "library-assets-v1",
      releaseId: 17,
      assetId: 99,
      assetName: "replaced.pdf",
      downloadUrl:
        "https://github.com/MiyaaL/MiyaaL.github.io/releases/download/library-assets-v1/replaced.pdf",
    },
  });
  const changed = findDocument(
    [changedDocument],
    String(document.id),
    expected,
  );
  assertEquals(changed.kind, "changed");
  assert(changed.kind === "changed");
  assertEquals(changed.index, 0);
  assert(changed.document === changedDocument);
});

Deno.test("findDocument rejects missing and duplicate catalog identities", () => {
  const document = releaseDocument();
  assertEquals(
    findDocument([], String(document.id), revisionForDocument(document)),
    { kind: "missing" },
  );
  assertEquals(
    findDocument([document, { ...document }], String(document.id)),
    { kind: "duplicate" },
  );
});

Deno.test("classifyArchivePublication recognizes a fully published asset", () => {
  const expected = releaseDocument();
  assertEquals(classifyArchivePublication([expected], expected), "published");

  const equivalentCopy = {
    ...expected,
    title: "A title added by another catalog writer",
  };
  assertEquals(
    classifyArchivePublication([equivalentCopy], expected),
    "published",
  );
});

Deno.test("classifyArchivePublication permits rollback only when the asset is absent", () => {
  const expected = releaseDocument();
  assertEquals(
    classifyArchivePublication([
      {
        id: "pdf-unrelated",
        source: "external",
        path: "https://example.com/unrelated.pdf",
        sha256: "01234567".repeat(8),
      },
    ], expected),
    "absent",
  );
});

Deno.test("classifyArchivePublication marks ambiguous or replaced assets as conflicts", () => {
  const expected = releaseDocument();
  const sameIdDifferentDigest = releaseDocument({
    sha256: "cafebabe".repeat(8),
  });
  const sameDigestDifferentId = releaseDocument({ id: "pdf-other-document" });
  const sameIdentityDifferentAsset = releaseDocument({
    release: {
      tag: "library-assets-v1",
      releaseId: 17,
      assetId: 24,
      assetName: "paper-deadbeef.pdf",
      downloadUrl: expected.path,
    },
  });

  assertEquals(
    classifyArchivePublication([sameIdDifferentDigest], expected),
    "conflict",
  );
  assertEquals(
    classifyArchivePublication([sameDigestDifferentId], expected),
    "conflict",
  );
  assertEquals(
    classifyArchivePublication([sameIdentityDifferentAsset], expected),
    "conflict",
  );
  assertEquals(
    classifyArchivePublication([expected, { ...expected }], expected),
    "conflict",
  );
  assertEquals(
    classifyArchivePublication([], { path: expected.path }),
    "conflict",
  );
});

Deno.test("releaseRefIsPinned accepts only the fixed commit target", () => {
  assert(
    releaseRefIsPinned({
      object: { type: "commit", sha: LIBRARY_RELEASE_COMMIT_SHA },
    }),
  );

  assert(
    !releaseRefIsPinned({
      object: { type: "tag", sha: LIBRARY_RELEASE_COMMIT_SHA },
    }),
  );
  assert(
    !releaseRefIsPinned({
      object: { type: "commit", sha: "0".repeat(40) },
    }),
  );
  assert(!releaseRefIsPinned({ object: null }));
  assert(!releaseRefIsPinned(null));
});
