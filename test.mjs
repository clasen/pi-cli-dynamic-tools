#!/usr/bin/env node
/**
 * Integration test: simulates the LLM calling toolbox_create with a simple spec,
 * then validates the full CLI contract on the produced tool.
 */

import { mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const HOME = process.env.HOME;
const TOOLBOX = `${HOME}/.pi/agent/toolbox`;
const INSTALLS_DIR = `${TOOLBOX}/installs`;
const BIN_DIR = `${TOOLBOX}/bin`;
const REGISTRY_DIR = `${TOOLBOX}/registry`;
const SKILLS_DIR = `${TOOLBOX}/skills`;

const HELP_SECTIONS = ["NAME", "USAGE", "DESCRIPTION", "OPTIONS", "EXAMPLES", "EXIT CODES"];
const TOOL_NAME = "echo-test";

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { console.log(`  PASS  ${label}`); passed++; }
  else { console.error(`  FAIL  ${label}`); failed++; }
}

function run(bin, args) {
  try {
    const stdout = execFileSync(bin, args, { encoding: "utf8", timeout: 15000, stdio: ["pipe", "pipe", "pipe"] });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err) {
    return { stdout: err.stdout || "", stderr: err.stderr || "", exitCode: err.status ?? 1 };
  }
}

// ─── Cleanup from previous runs ───
for (const dir of [join(INSTALLS_DIR, TOOL_NAME), join(SKILLS_DIR, TOOL_NAME)]) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
for (const f of [join(BIN_DIR, TOOL_NAME), join(REGISTRY_DIR, `${TOOL_NAME}.json`)]) {
  if (existsSync(f)) rmSync(f, { force: true });
}

// ─── Step 1: Build the skeleton script from a ToolSpec ───

console.log("\n=== Step 1: Build skeleton from ToolSpec ===");

// Read skeleton.ts source to extract buildScript logic.
// Since we can't import .ts directly, we replicate buildScript inline.
// This is what the extension does internally.

const spec = {
  name: TOOL_NAME,
  description: "Echo back the input for testing",
  dependencies: {},
  imports: "",
  options_help: "  --text, -t <text>    Text to echo back",
  examples_help: `  ${TOOL_NAME} "hello world"\n  ${TOOL_NAME} -t "hello" --json`,
  parse_options: `{ text: { type: "string", short: "t" } }`,
  schema: `{
    name: "${TOOL_NAME}",
    version: "1.0.0",
    input: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    output: { type: "object", properties: { echoed: { type: "string" } } }
  }`,
  run_code: `  const text = values.text || positionals.join(" ");
  if (!text) { const err = new Error("text is required"); err.code = 3; throw err; }
  return { echoed: text };`,
  doctor_code: `  console.log("OK: echo-test is operational");
  process.exit(0);`,
};

// Build the script (replicating skeleton.ts logic)
const script = `#!/usr/bin/env node
import { parseArgs } from "node:util";
${spec.imports}

const NAME = ${JSON.stringify(spec.name)};
const VERSION = "1.0.0";
const DESCRIPTION = ${JSON.stringify(spec.description)};

const HELP = \`NAME
  \${NAME} - \${DESCRIPTION}

USAGE
  \${NAME} <args> [options]
  \${NAME} <subcommand>

DESCRIPTION
  \${DESCRIPTION}

OPTIONS
${spec.options_help}
  --json               Output as JSON
  --help, -h           Show this help message
  --version            Show version

EXAMPLES
${spec.examples_help}

EXIT CODES
  0   Success
  1   General error
  2   Network error
  3   Invalid arguments
\`;

const SCHEMA = ${spec.schema};

const TOOL_PARSE_OPTIONS = ${spec.parse_options};

async function run(values, positionals) {
${spec.run_code}
}

async function doctor() {
${spec.doctor_code}
}

function die(msg, code = 1) {
  process.stderr.write(msg + "\\n");
  process.exit(code);
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      ...TOOL_PARSE_OPTIONS,
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.help) { console.log(HELP); process.exit(0); }
  if (values.version) { console.log(VERSION); process.exit(0); }

  const sub = positionals[0];
  if (sub === "schema") { console.log(JSON.stringify(SCHEMA, null, 2)); process.exit(0); }
  if (sub === "doctor") { await doctor(); return; }

  try {
    const result = await run(values, positionals);
    if (values.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (typeof result === "string") {
      console.log(result);
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (err) {
    die("Error: " + err.message, err.code || 1);
  }
}

main();
`;

// Scaffold
const installDir = join(INSTALLS_DIR, TOOL_NAME);
mkdirSync(installDir, { recursive: true });
mkdirSync(BIN_DIR, { recursive: true });
mkdirSync(REGISTRY_DIR, { recursive: true });
mkdirSync(join(SKILLS_DIR, TOOL_NAME), { recursive: true });

writeFileSync(join(installDir, "package.json"), JSON.stringify({
  name: `toolbox-${TOOL_NAME}`, version: "1.0.0", type: "module",
  bin: { [TOOL_NAME]: "./index.mjs" },
}, null, 2), "utf8");

writeFileSync(join(installDir, "index.mjs"), script, "utf8");
chmodSync(join(installDir, "index.mjs"), 0o755);

assert(existsSync(join(installDir, "index.mjs")), "index.mjs created");

// ─── Step 2: Create wrapper ───

console.log("\n=== Step 2: Create wrapper ===");

const wrapperPath = join(BIN_DIR, TOOL_NAME);
writeFileSync(wrapperPath, `#!/bin/sh\nexec node "${join(installDir, "index.mjs")}" "$@"\n`, "utf8");
chmodSync(wrapperPath, 0o755);
assert(existsSync(wrapperPath), "Wrapper created");

// ─── Step 3: Validate CLI contract ───

console.log("\n=== Step 3: Validate CLI contract ===");

const help = run(wrapperPath, ["--help"]);
assert(help.exitCode === 0, "--help exits 0");
for (const section of HELP_SECTIONS) {
  assert(help.stdout.includes(section), `--help contains "${section}"`);
}

const shortHelp = run(wrapperPath, ["-h"]);
assert(shortHelp.exitCode === 0, "-h exits 0");
assert(shortHelp.stdout.trim() === help.stdout.trim(), "-h matches --help");

const version = run(wrapperPath, ["--version"]);
assert(version.exitCode === 0, "--version exits 0");
assert(version.stdout.trim().length > 0, "--version non-empty");

const schema = run(wrapperPath, ["schema"]);
assert(schema.exitCode === 0, "schema exits 0");
try {
  const obj = JSON.parse(schema.stdout);
  assert(typeof obj === "object" && obj !== null, "schema is JSON object");
  assert(typeof obj.name === "string", "schema.name exists");
} catch { assert(false, "schema is valid JSON"); }

const doctor = run(wrapperPath, ["doctor"]);
assert(doctor.exitCode === 0, "doctor exits 0");
assert(doctor.stdout.includes("OK"), "doctor reports OK");

// ─── Step 4: Test actual tool logic ───

console.log("\n=== Step 4: Test run logic ===");

const echoPlain = run(wrapperPath, ["hello", "world"]);
assert(echoPlain.exitCode === 0, "echo plain exits 0");
assert(echoPlain.stdout.includes("hello world"), "echo plain has correct output");

const echoJson = run(wrapperPath, ["-t", "test123", "--json"]);
assert(echoJson.exitCode === 0, "--json exits 0");
try {
  const obj = JSON.parse(echoJson.stdout);
  assert(obj.echoed === "test123", "--json has correct echoed value");
} catch { assert(false, "--json is valid JSON"); }

const echoNoArgs = run(wrapperPath, []);
assert(echoNoArgs.exitCode === 3, "no args exits with code 3");
assert(echoNoArgs.stderr.includes("text is required"), "no args error on stderr");

// ─── Step 5: Registry + Skill ───

console.log("\n=== Step 5: Registry and Skill ===");

const entry = {
  name: TOOL_NAME, version: "1.0.0", description: spec.description,
  capabilities: [TOOL_NAME], installedAt: new Date().toISOString(),
  installDir, binPath: wrapperPath, piToolName: TOOL_NAME.replace(/-/g, "_"),
  promptSnippet: spec.description, promptGuidelines: [],
};
writeFileSync(join(REGISTRY_DIR, `${TOOL_NAME}.json`), JSON.stringify(entry, null, 2), "utf8");
assert(existsSync(join(REGISTRY_DIR, `${TOOL_NAME}.json`)), "Registry entry written");

const skillContent = `---\nname: ${TOOL_NAME}\ndescription: ${spec.description}\n---\n\n# ${TOOL_NAME}\n\n${spec.description}\n`;
writeFileSync(join(SKILLS_DIR, TOOL_NAME, "SKILL.md"), skillContent, "utf8");
assert(existsSync(join(SKILLS_DIR, TOOL_NAME, "SKILL.md")), "SKILL.md written");

// ─── Cleanup test artifacts ───

console.log("\n=== Cleanup ===");
rmSync(installDir, { recursive: true, force: true });
rmSync(wrapperPath, { force: true });
rmSync(join(REGISTRY_DIR, `${TOOL_NAME}.json`), { force: true });
rmSync(join(SKILLS_DIR, TOOL_NAME), { recursive: true, force: true });
console.log("  Test artifacts cleaned up");

// ─── Summary ───

console.log(`\n${"=".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("All checks passed!");
