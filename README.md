# pi-cli-dynamic-tools

Pi extension that lets the LLM build, install, and use its own CLI tools on the fly — without any human intervention.

When Pi needs a capability it doesn't have (web search, file conversion, API calls, etc.), it calls `toolbox_create`, writes the code, and from that moment on can use the new tool as a native Pi tool. The tool persists across sessions.

---

## How it works

```
User: "search the web for..."
         │
         ▼
Pi notices it has no web-search tool
         │
         ▼
Pi calls toolbox_create  ──► scaffolds Node.js script
                          ──► runs npm install (if deps needed)
                          ──► validates the CLI contract
                          ──► saves to registry (~/.pi/agent/toolbox/)
                          ──► generates a SKILL.md
                          ──► registers as a Pi tool (this session)
         │
         ▼
Pi calls web_search "your query"  ──► returns results
         │
         ▼
Pi answers the user ✓
```

Everything happens automatically. The user just asks, Pi figures out what to build.

---

## Installation

```bash
# from your pi agent workspace
pi install ./extensions/pi-cli-dynamic-tools
```

---

## Tools registered by the extension

### `toolbox_create`

Creates a new CLI tool from code the LLM writes.

The extension wraps your code in a skeleton that automatically handles:
- `--help` / `-h` — structured help with NAME, USAGE, DESCRIPTION, OPTIONS, EXAMPLES, EXIT CODES
- `--version`
- `schema` subcommand — machine-readable JSON schema
- `doctor` subcommand — self-diagnostics / connectivity checks
- `--json` — structured output mode
- Exit codes (0 success, 1 general error, 2 network, 3 bad args)

After creation the tool is validated against this contract. If validation fails, Pi reads the error and tries again.

### `toolbox_manage`

List, remove, or run diagnostics on installed tools.

| Action | Description |
|--------|-------------|
| `list` | Show all installed tools |
| `remove <name>` | Uninstall a tool and its skill |
| `doctor [name]` | Run self-diagnostics on one or all tools |

### `/toolbox` command

Slash command available in the Pi CLI for quick management:

```
/toolbox list
/toolbox remove web-search
/toolbox doctor
/toolbox doctor web-search
```

---

## File layout

All tools are stored under `~/.pi/agent/toolbox/`:

```
~/.pi/agent/toolbox/
├── registry/          # JSON entry per installed tool
├── installs/
│   └── web-search/    # Node.js package (index.mjs + package.json + node_modules)
├── bin/
│   └── web-search     # Shell wrapper → node installs/web-search/index.mjs
└── skills/
    └── web-search/
        └── SKILL.md   # Auto-generated skill picked up by Pi
```

---

## Example: Pi builds a web-search tool

Just ask Pi to search the web. It will build the tool if it doesn't exist yet.

```
You: search the internet for "latest Node.js release"
```

Pi will:

1. Call `toolbox_create` with a name `web-search`, install something like `node-fetch` or use a search API.
2. Write the `run()` logic, `doctor()` check, help text, and schema.
3. Install, validate, register.
4. Immediately call `web_search --query "latest Node.js release"` and answer you.

On the next session the tool is already there — Pi loads it automatically at startup and the skill is picked up so it knows when to use it.

---

## Example: manually inspecting a created tool

After Pi creates `web-search`, you can interact with it directly:

```bash
# See the help
~/.pi/agent/toolbox/bin/web-search --help

# Check connectivity
~/.pi/agent/toolbox/bin/web-search doctor

# Run a search
~/.pi/agent/toolbox/bin/web-search --query "Node.js 22 release notes"

# Get structured JSON output
~/.pi/agent/toolbox/bin/web-search --query "Node.js 22" --json
```

---

## Example: listing and removing tools

```
You: /toolbox list
Pi:  Installed: web-search, pdf-to-text, github-search

You: /toolbox doctor web-search
Pi:  web-search: OK

You: /toolbox remove web-search
Pi:  web-search removed
```

Or via Pi tools (the LLM can do this too):

```
You: remove the web-search tool from the toolbox
Pi:  [calls toolbox_manage action=remove name=web-search]
     "web-search" removed.
```

---

## What gets validated before a tool is accepted

Every new tool must pass 5 checks before it's registered:

| Check | What it verifies |
|-------|-----------------|
| `--help` | Exits 0, output contains all required sections |
| `-h` | Identical output to `--help` |
| `schema` | Exits 0, returns valid JSON object |
| `--version` | Exits 0, returns non-empty string |
| `doctor` | Exits 0 (connectivity / prerequisites ok) |

If any check fails, the tool is deleted and Pi gets the failure details so it can fix and retry.

---

## Persistence across sessions

- Tools are stored on disk — they survive restarts.
- At `session_start`, the extension scans the registry and re-registers every installed tool whose binary exists.
- Skills in `~/.pi/agent/toolbox/skills/` are automatically surfaced via `resources_discover`, so Pi knows about the tools and when to use them.

---

## Architecture

| File | Role |
|------|------|
| `src/index.ts` | Extension entry point — registers tools, session hooks, slash command |
| `src/installer.ts` | Scaffold → npm install → wrapper → validate → registry → skill |
| `src/skeleton.ts` | Generates the Node.js script from the LLM-provided code |
| `src/validator.ts` | Runs the 5 CLI contract checks |
| `src/skill-gen.ts` | Generates the `SKILL.md` for each installed tool |
| `src/registry.ts` | Read/write JSON entries in `toolbox/registry/` |
| `src/types.ts` | Shared types and directory constants |
