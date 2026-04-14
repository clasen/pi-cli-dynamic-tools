import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { SKILLS_DIR, type RegistryEntry, type ToolSpec } from "./types.js";
import { listEntries, getEntry } from "./registry.js";
import { install, uninstall } from "./installer.js";
import { validate } from "./validator.js";

function execTool(binPath: string, args: string[], toolName: string): { type: "text"; text: string }[] {
  try {
    const stdout = execFileSync(binPath, args, {
      encoding: "utf8",
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return [{ type: "text", text: stdout }];
  } catch (err: any) {
    const output = (err.stdout || "") + (err.stderr || "");
    throw new Error(`${toolName} failed (exit ${err.status ?? 1}): ${output.slice(0, 2000)}`);
  }
}

function registerInstalledTool(pi: ExtensionAPI, entry: RegistryEntry): void {
  pi.registerTool({
    name: entry.piToolName,
    label: entry.name,
    description: entry.description,
    promptSnippet: entry.promptSnippet,
    promptGuidelines: entry.promptGuidelines,
    parameters: Type.Object({
      args: Type.String({ description: "Command-line arguments to pass to the tool" }),
    }),
    async execute(_toolCallId, params) {
      if (!existsSync(entry.binPath)) {
        throw new Error(`Binary missing at ${entry.binPath}. Recreate with toolbox_create.`);
      }
      const argList = params.args ? params.args.split(/\s+/).filter(Boolean) : [];
      return {
        content: execTool(entry.binPath, argList, entry.name),
        details: { tool: entry.name },
      };
    },
  });
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async () => {
    for (const entry of listEntries()) {
      if (existsSync(entry.binPath)) {
        registerInstalledTool(pi, entry);
      }
    }
  });

  pi.on("resources_discover", async () => {
    return {
      skillPaths: existsSync(SKILLS_DIR) ? [SKILLS_DIR] : [],
    };
  });

  pi.registerTool({
    name: "toolbox_create",
    label: "Create CLI Tool",
    description:
      "Create a new CLI tool from code you provide. The extension wraps your code in a skeleton that handles --help, -h, --version, schema, doctor, --json, and exit codes. You only provide the core logic.",
    promptSnippet: "Create a new CLI tool on the fly when you need a capability you don't have",
    promptGuidelines: [
      "When you need a capability you don't currently have (web search, file conversion, API access, etc.), use toolbox_create to build a CLI tool for it.",
      "You provide: name, description, npm dependencies (as object like {\"pkg\": \"^1.0.0\"}), import lines, the OPTIONS and EXAMPLES help text, parseArgs options as a JS object literal string, a JSON schema object string, the body of run(values, positionals) that returns a result, and the body of doctor() for self-diagnostics.",
      "The skeleton automatically handles: --help with NAME/USAGE/DESCRIPTION/OPTIONS/EXAMPLES/EXIT CODES, -h as alias, --version, schema subcommand, doctor subcommand, --json output wrapping, error handling with stderr and exit codes.",
      "run(values, positionals) receives the parsed CLI args. Return a string for plain output or an object for --json. Throw with err.code for specific exit codes.",
      "doctor() should verify connectivity or prerequisites. Print 'OK: ...' and exit(0) on success, or print to stderr and exit(1) on failure.",
      "If validation fails, read the error, fix your code, and call toolbox_create again.",
    ],
    parameters: Type.Object({
      name: Type.String({ description: "Tool name (lowercase, hyphens ok, e.g. 'web-search')" }),
      description: Type.String({ description: "What the tool does (one sentence)" }),
      dependencies: Type.String({ description: 'NPM dependencies as JSON object, e.g. {} or {"cheerio":"^1.0.0"}' }),
      imports: Type.String({ description: 'Extra import lines for the script, e.g. "import cheerio from \\"cheerio\\";" or empty string' }),
      options_help: Type.String({ description: "Content for the OPTIONS section of --help (one option per line, indented with 2 spaces)" }),
      examples_help: Type.String({ description: "Content for the EXAMPLES section of --help (indented with 2 spaces)" }),
      parse_options: Type.String({ description: 'parseArgs options as JS object literal, e.g. { query: { type: "string", short: "q" } }' }),
      schema: Type.String({ description: "JSON schema object as JS literal, e.g. { name: \"my-tool\", version: \"1.0.0\", input: {...}, output: {...} }" }),
      run_code: Type.String({ description: "Body of async function run(values, positionals) { ... }. Return a string or object." }),
      doctor_code: Type.String({ description: "Body of async function doctor() { ... }. Print OK or fail with process.exit(1)." }),
    }),
    async execute(_toolCallId, params) {
      if (getEntry(params.name)) {
        return {
          content: [{
            type: "text" as const,
            text: `Tool "${params.name}" already exists. Use toolbox_manage remove first, then create again.`,
          }],
          details: { alreadyExists: true },
        };
      }

      let deps: Record<string, string>;
      try {
        deps = JSON.parse(params.dependencies);
      } catch {
        throw new Error(`Invalid dependencies JSON: ${params.dependencies}`);
      }

      const spec: ToolSpec = {
        name: params.name,
        description: params.description,
        dependencies: deps,
        imports: params.imports,
        options_help: params.options_help,
        examples_help: params.examples_help,
        parse_options: params.parse_options,
        schema: params.schema,
        run_code: params.run_code,
        doctor_code: params.doctor_code,
      };

      const result = install(spec);

      if (!result.success) {
        const details = result.validation
          ? "\n\nValidation:\n" + result.validation.checks
              .map((c) => `  ${c.passed ? "PASS" : "FAIL"} ${c.name}: ${c.message}`)
              .join("\n")
          : "";
        throw new Error(`Creation failed: ${result.error}${details}`);
      }

      registerInstalledTool(pi, result.entry!);

      const report = result.validation!.checks
        .map((c) => `  ${c.passed ? "PASS" : "FAIL"} ${c.name}: ${c.message}`)
        .join("\n");

      return {
        content: [{
          type: "text" as const,
          text: [
            `Tool "${spec.name}" created and registered as \`${result.entry!.piToolName}\`.`,
            `Binary: ${result.entry!.binPath}`,
            `Validation:\n${report}`,
            `\nYou can now call \`${result.entry!.piToolName}\` directly.`,
          ].join("\n"),
        }],
        details: { created: true, entry: result.entry },
      };
    },
  });

  pi.registerTool({
    name: "toolbox_manage",
    label: "Toolbox Manager",
    description: "List, remove, or diagnose installed CLI tools.",
    promptSnippet: "List, remove, or diagnose installed CLI tools in the toolbox",
    promptGuidelines: [
      "Use toolbox_manage to see what tools are installed, remove tools, or run diagnostics.",
    ],
    parameters: Type.Object({
      action: StringEnum(["list", "remove", "doctor"] as const, {
        description: "Action to perform",
      }),
      name: Type.Optional(
        Type.String({ description: "Tool name (required for remove, optional for doctor)" }),
      ),
    }),
    async execute(_toolCallId, params) {
      switch (params.action) {
        case "list": {
          const installed = listEntries();
          if (installed.length === 0) {
            return {
              content: [{ type: "text" as const, text: "No tools installed. Use toolbox_create to build one." }],
              details: { count: 0 },
            };
          }
          const lines = installed.map(
            (e) => `- **${e.name}** (\`${e.piToolName}\`): ${e.description} [${e.installedAt}]`,
          );
          return {
            content: [{ type: "text" as const, text: lines.join("\n") }],
            details: { count: installed.length },
          };
        }

        case "remove": {
          if (!params.name) throw new Error("'name' is required for remove.");
          if (!uninstall(params.name)) throw new Error(`"${params.name}" is not installed.`);
          return {
            content: [{
              type: "text" as const,
              text: `"${params.name}" removed.`,
            }],
            details: { removed: true },
          };
        }

        case "doctor": {
          const targets = params.name ? [params.name] : listEntries().map((e) => e.name);
          if (targets.length === 0) {
            return {
              content: [{ type: "text" as const, text: "No tools installed." }],
              details: {},
            };
          }
          const lines: string[] = [];
          for (const t of targets) {
            const entry = getEntry(t);
            if (!entry) { lines.push(`${t}: NOT FOUND`); continue; }
            if (!existsSync(entry.binPath)) { lines.push(`${t}: FAIL - binary missing`); continue; }
            const r = validate(entry.binPath);
            if (r.passed) {
              lines.push(`${t}: OK`);
            } else {
              const fails = r.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.message}`).join("; ");
              lines.push(`${t}: FAIL - ${fails}`);
            }
          }
          return {
            content: [{ type: "text" as const, text: lines.join("\n") }],
            details: { checked: targets.length },
          };
        }

        default:
          throw new Error(`Unknown action: ${params.action}`);
      }
    },
  });

  pi.registerCommand("toolbox", {
    description: "Manage CLI tools: /toolbox [list|remove <name>|doctor [name]]",
    handler: async (args, ctx) => {
      const parts = (args ?? "").trim().split(/\s+/);
      const action = parts[0] || "list";
      const name = parts[1];

      switch (action) {
        case "list": {
          const installed = listEntries();
          ctx.ui.notify(
            installed.length > 0
              ? `Installed: ${installed.map((e) => e.name).join(", ")}`
              : "No tools installed. The LLM can create them with toolbox_create.",
            "info",
          );
          break;
        }
        case "remove": {
          if (!name) { ctx.ui.notify("Usage: /toolbox remove <name>", "warning"); return; }
          const removed = uninstall(name);
          ctx.ui.notify(removed ? `${name} removed` : `${name} not installed`, removed ? "info" : "error");
          break;
        }
        case "doctor": {
          const targets = name ? [name] : listEntries().map((e) => e.name);
          if (targets.length === 0) { ctx.ui.notify("No tools installed.", "info"); return; }
          for (const t of targets) {
            const entry = getEntry(t);
            if (!entry || !existsSync(entry.binPath)) {
              ctx.ui.notify(`${t}: missing`, "error"); continue;
            }
            const r = validate(entry.binPath);
            ctx.ui.notify(`${t}: ${r.passed ? "OK" : "FAIL"}`, r.passed ? "info" : "error");
          }
          break;
        }
        default:
          ctx.ui.notify(`Unknown: ${action}. Use list|remove|doctor`, "warning");
      }
    },
  });
}
