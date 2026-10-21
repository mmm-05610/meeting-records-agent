/**
 * C01-C08 contract vectors: the TypeScript/Node side of the cross-module test.
 *
 * Run: apps/web/node_modules/.bin/tsx tests/contracts/contracts.test.ts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  canonicalJson,
  normalizeSha256,
  normalizeTitle,
  type AnswerRecord,
  type ScopeSnapshot,
} from "../../apps/web/src/types/meeting-contracts.ts";
import {
  computeDocumentId,
  computeScopeFingerprint,
} from "../../apps/web/src/server/meeting-identity.ts";

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(
  readFileSync(join(here, "fixtures", "meeting_contract_vectors.json"), "utf8"),
);

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`ok   ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

for (const testCase of vectors.document_id_cases) {
  const actual = computeDocumentId(testCase);
  check(`document id ${testCase.title}`, actual === testCase.expected_document_id, {
    actual,
    expected: testCase.expected_document_id,
  });
}

const [first, second] = vectors.document_id_cases;
check(
  "whitespace-normalised titles share identity",
  first.expected_document_id === second.expected_document_id,
);

const snapshotCase = vectors.scope_snapshot_case;
const snapshot = snapshotCase.snapshot as ScopeSnapshot;
check(
  "scope fingerprint matches python vector",
  computeScopeFingerprint(snapshot) === snapshotCase.expected_fingerprint,
  computeScopeFingerprint(snapshot),
);

const record = vectors.answer_record_case as AnswerRecord;
check("answer record parses", record.status === "completed" && record.claims.length === 1);
check(
  "answer record snapshot fingerprint is stable",
  computeScopeFingerprint(record.scope_snapshot) === record.scope_snapshot.fingerprint,
);
check("canonical json is key sorted", canonicalJson({ b: 1, a: 2 }) === '{"a":2,"b":1}');
check("title normalisation", normalizeTitle(" 演示项目A  需求评审会 ") === "演示项目A 需求评审会");

let threw = false;
try {
  normalizeSha256("not-a-hash");
} catch {
  threw = true;
}
check("invalid sha256 rejected", threw);

if (failures > 0) {
  console.error(`${failures} contract failures`);
  process.exit(1);
}
console.log("TS_CONTRACT_TESTS_OK");
