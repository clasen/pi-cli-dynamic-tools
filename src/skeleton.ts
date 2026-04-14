import type { ToolSpec } from "./types.js";

export function buildScript(spec: ToolSpec): string {
  const piToolName = spec.name.replace(/-/g, "_");

  return `#!/usr/bin/env node
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
}
