// Regression guard for two production bugs:
//
// 1. (PR #1) Anthropic's tool-use schema handling does not reliably support
//    JSON Schema $ref/$defs. A $ref in a tool's input_schema broke every
//    real "Run ATS analysis" call.
// 2. (PR #3) Anthropic's strict-mode grammar compiler rejects tool schemas
//    that are too structurally complex ("The compiled grammar is too
//    large"). The original single analyze_match tool had 15 nested object
//    schemas and was rejected; it was split into score_match + write_feedback
//    (6 object schemas each). This script caps object-schema count per tool
//    well below that failure point so a similar regression is caught here,
//    not in production against a real API key.
//
// This only evaluates the plain object-literal const declarations (no DOM
// APIs involved), so it's safe to run in plain Node without a browser.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(here, "..", "ats-resume-checker.html");
const html = fs.readFileSync(htmlPath, "utf8");

const start = html.indexOf("const NULLABLE_STRING = {");
const end = html.indexOf("async function extractResumeWithClaude");

if (start === -1 || end === -1 || end <= start) {
  console.error(
    "Could not locate the tool schema block in ats-resume-checker.html " +
      "(expected 'const NULLABLE_STRING = {' ... 'async function extractResumeWithClaude'). " +
      "Did the file get restructured? Update scripts/check-tool-schemas.mjs if so."
  );
  process.exit(1);
}

const schemaSource = html.slice(start, end);

// Max distinct type:"object" nodes allowed in a single tool's input_schema.
// The tool that got rejected by Anthropic's grammar compiler had 15; the
// post-split tools have 6 each. 10 gives headroom while still catching a
// schema heading back toward the failure zone before it ships.
const MAX_OBJECT_SCHEMAS_PER_TOOL = 10;

let EXTRACT_RESUME_TOOL, SUGGESTION_SCHEMA, SCORE_MATCH_TOOL, WRITE_FEEDBACK_TOOL, NULLABLE_STRING;
try {
  const evaluate = new Function(
    `${schemaSource}\nreturn { EXTRACT_RESUME_TOOL, SUGGESTION_SCHEMA, SCORE_MATCH_TOOL, WRITE_FEEDBACK_TOOL, NULLABLE_STRING };`
  );
  ({ EXTRACT_RESUME_TOOL, SUGGESTION_SCHEMA, SCORE_MATCH_TOOL, WRITE_FEEDBACK_TOOL, NULLABLE_STRING } = evaluate());
} catch (err) {
  console.error("Tool schema definitions failed to evaluate as JavaScript:", err.message);
  process.exit(1);
}

const failures = [];

// Walks a JSON-Schema-shaped object and returns every node with type:"object".
function findObjectSchemas(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    node.forEach((child) => findObjectSchemas(child, out));
    return out;
  }
  if (node.type === "object") out.push(node);
  for (const key of Object.keys(node)) findObjectSchemas(node[key], out);
  return out;
}

for (const [name, tool] of Object.entries({ EXTRACT_RESUME_TOOL, SCORE_MATCH_TOOL, WRITE_FEEDBACK_TOOL })) {
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
      `${name} contains "$ref" or "$defs" — Anthropic tool schemas must be fully inlined, not use JSON Schema references (bug fixed in PR #1)`
    );
  }

  // strict: true enables Anthropic's grammar-constrained structured outputs,
  // which guarantees schema-conformant output instead of best-effort JSON.
  // This has specific requirements (see structured-outputs docs): every
  // object needs additionalProperties:false, no numeric min/max, and
  // nullable fields must use anyOf rather than a `type` array.
  if (tool.strict !== true) {
    failures.push(`${name} is missing "strict: true"`);
  }
  if (json.includes('"type":["') || json.includes("'type': [")) {
    failures.push(`${name} uses a union-type array (type: [...]) for nullability — strict mode requires anyOf instead`);
  }
  if (/"minimum"|"maximum"|"multipleOf"/.test(json)) {
    failures.push(`${name} uses minimum/maximum/multipleOf — not supported in strict mode`);
  }

  const objectSchemas = findObjectSchemas(tool.input_schema);
  for (const objectSchema of objectSchemas) {
    if (objectSchema.additionalProperties !== false) {
      failures.push(`${name} has an object schema missing "additionalProperties: false" (required in strict mode): ${JSON.stringify(objectSchema).slice(0, 120)}...`);
    }
  }
  if (objectSchemas.length > MAX_OBJECT_SCHEMAS_PER_TOOL) {
    failures.push(
      `${name} has ${objectSchemas.length} nested object schemas (limit ${MAX_OBJECT_SCHEMAS_PER_TOOL}) — this is the exact shape of complexity Anthropic's grammar compiler rejected in production (bug fixed in PR #3). Split it into smaller tool calls instead of raising this limit.`
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
    `SCORE_MATCH_TOOL: ${JSON.stringify(SCORE_MATCH_TOOL).length} bytes, ` +
    `WRITE_FEEDBACK_TOOL: ${JSON.stringify(WRITE_FEEDBACK_TOOL).length} bytes.`
);
