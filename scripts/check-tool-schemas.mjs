// Regression guard for the bug fixed in PR #1: Anthropic's tool-use schema
// handling does not reliably support JSON Schema $ref/$defs. A $ref in
// ANALYZE_MATCH_TOOL's input_schema broke every real "Run ATS analysis" call
// in production. This script extracts the tool schema definitions from
// ats-resume-checker.html, evaluates them, and fails if $ref/$defs reappear
// or if either tool is missing required top-level keys.
//
// This only evaluates the plain object-literal const declarations (no DOM
// APIs involved), so it's safe to run in plain Node without a browser.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(here, "..", "ats-resume-checker.html");
const html = fs.readFileSync(htmlPath, "utf8");

const start = html.indexOf("const EXTRACT_RESUME_TOOL = {");
const end = html.indexOf("async function extractResumeWithClaude");

if (start === -1 || end === -1 || end <= start) {
  console.error(
    "Could not locate the tool schema block in ats-resume-checker.html " +
      "(expected 'const EXTRACT_RESUME_TOOL = {' ... 'async function extractResumeWithClaude'). " +
      "Did the file get restructured? Update scripts/check-tool-schemas.mjs if so."
  );
  process.exit(1);
}

const schemaSource = html.slice(start, end);

let EXTRACT_RESUME_TOOL, SUGGESTION_SCHEMA, ANALYZE_MATCH_TOOL;
try {
  const evaluate = new Function(
    `${schemaSource}\nreturn { EXTRACT_RESUME_TOOL, SUGGESTION_SCHEMA, ANALYZE_MATCH_TOOL };`
  );
  ({ EXTRACT_RESUME_TOOL, SUGGESTION_SCHEMA, ANALYZE_MATCH_TOOL } = evaluate());
} catch (err) {
  console.error("Tool schema definitions failed to evaluate as JavaScript:", err.message);
  process.exit(1);
}

const failures = [];

for (const [name, tool] of Object.entries({ EXTRACT_RESUME_TOOL, ANALYZE_MATCH_TOOL })) {
  if (!tool || typeof tool !== "object") {
    failures.push(`${name} did not evaluate to an object`);
    continue;
  }
  for (const key of ["name", "description", "input_schema"]) {
    if (!(key in tool)) failures.push(`${name} is missing required key "${key}"`);
  }
  const json = JSON.stringify(tool);
  if (json.includes("$ref") || json.includes("$defs")) {
    failures.push(
      `${name} contains "$ref" or "$defs" — Anthropic tool schemas must be fully inlined, not use JSON Schema references (this is the exact bug fixed in PR #1)`
    );
  }
}

if (!SUGGESTION_SCHEMA || typeof SUGGESTION_SCHEMA !== "object") {
  failures.push("SUGGESTION_SCHEMA did not evaluate to an object");
}

if (failures.length) {
  console.error("Tool schema check FAILED:\n" + failures.map((f) => " - " + f).join("\n"));
  process.exit(1);
}

console.log(
  `Tool schema check passed. EXTRACT_RESUME_TOOL: ${JSON.stringify(EXTRACT_RESUME_TOOL).length} bytes, ` +
    `ANALYZE_MATCH_TOOL: ${JSON.stringify(ANALYZE_MATCH_TOOL).length} bytes.`
);
