import { mkdirSync, writeFileSync, chmodSync, rmSync, existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { INSTALLS_DIR, BIN_DIR, SKILLS_DIR, type RegistryEntry, type ToolSpec, type ValidationResult } from "./types.js";
import { saveEntry, removeEntry, getEntry } from "./registry.js";
import { validate } from "./validator.js";
import { generateSkill, removeSkill } from "./skill-gen.js";
import { buildScript } from "./skeleton.js";

export interface InstallResult {
  success: boolean;
  entry?: RegistryEntry;
  validation?: ValidationResult;
  error?: string;
}

function ensureDirs(): void {
  for (const dir of [INSTALLS_DIR, BIN_DIR, SKILLS_DIR]) {
    mkdirSync(dir, { recursive: true });
  }
}

function scaffold(spec: ToolSpec): string {
  const installDir = join(INSTALLS_DIR, spec.name);

  if (existsSync(installDir)) {
    rmSync(installDir, { recursive: true, force: true });
  }
  mkdirSync(installDir, { recursive: true });

  const pkgJson = {
    name: `toolbox-${spec.name}`,
    version: "1.0.0",
    type: "module",
    bin: { [spec.name]: "./index.mjs" },
    ...(Object.keys(spec.dependencies).length > 0 ? { dependencies: spec.dependencies } : {}),
  };

  writeFileSync(join(installDir, "package.json"), JSON.stringify(pkgJson, null, 2), "utf8");

  const script = buildScript(spec);
  const scriptPath = join(installDir, "index.mjs");
  writeFileSync(scriptPath, script, "utf8");
  chmodSync(scriptPath, 0o755);

  return installDir;
}

function npmInstall(installDir: string): void {
  const pkg = JSON.parse(readFileSync(join(installDir, "package.json"), "utf8"));
  const hasDeps = pkg.dependencies && Object.keys(pkg.dependencies).length > 0;
  if (!hasDeps) return;

  execSync("npm install --production --no-fund --no-audit", {
    cwd: installDir,
    encoding: "utf8",
    timeout: 60_000,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function createWrapper(name: string): string {
  const wrapperPath = join(BIN_DIR, name);
  const installDir = join(INSTALLS_DIR, name);
  const content = `#!/bin/sh\nexec node "${join(installDir, "index.mjs")}" "$@"\n`;
  writeFileSync(wrapperPath, content, "utf8");
  chmodSync(wrapperPath, 0o755);
  return wrapperPath;
}

function cleanup(name: string): void {
  const installDir = join(INSTALLS_DIR, name);
  const wrapperPath = join(BIN_DIR, name);
  if (existsSync(installDir)) rmSync(installDir, { recursive: true, force: true });
  if (existsSync(wrapperPath)) rmSync(wrapperPath, { force: true });
  removeSkill(name);
  removeEntry(name);
}

export function install(spec: ToolSpec): InstallResult {
  ensureDirs();
  const piToolName = spec.name.replace(/-/g, "_");

  try {
    const installDir = scaffold(spec);

    try {
      npmInstall(installDir);
    } catch (err: any) {
      cleanup(spec.name);
      return { success: false, error: `npm install failed: ${err.message}` };
    }

    const binPath = createWrapper(spec.name);
    const validation = validate(binPath);

    if (!validation.passed) {
      const failures = validation.checks
        .filter((c) => !c.passed)
        .map((c) => `${c.name}: ${c.message}`)
        .join("; ");
      cleanup(spec.name);
      return { success: false, validation, error: `Contract validation failed: ${failures}` };
    }

    const entry: RegistryEntry = {
      name: spec.name,
      version: "1.0.0",
      description: spec.description,
      capabilities: [spec.name],
      installedAt: new Date().toISOString(),
      installDir,
      binPath,
      piToolName,
      promptSnippet: spec.description,
      promptGuidelines: [`Use ${piToolName} when the user needs ${spec.description.toLowerCase()}.`],
    };

    saveEntry(entry);
    generateSkill(entry);

    return { success: true, entry, validation };
  } catch (err: any) {
    cleanup(spec.name);
    return { success: false, error: err.message };
  }
}

export function uninstall(name: string): boolean {
  if (!getEntry(name)) return false;
  cleanup(name);
  return true;
}
