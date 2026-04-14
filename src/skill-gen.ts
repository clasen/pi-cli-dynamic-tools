import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SKILLS_DIR, type RegistryEntry } from "./types.js";

export function generateSkill(entry: RegistryEntry): string {
  const skillDir = join(SKILLS_DIR, entry.name);
  const skillPath = join(skillDir, "SKILL.md");

  mkdirSync(skillDir, { recursive: true });

  const content = `---
name: ${entry.name}
description: ${entry.description}. Use when the user needs ${entry.capabilities.join(", ")} capabilities.
---

# ${entry.name}

## Overview

${entry.description}

Managed CLI tool installed via the \`pi-cli-dynamic-tools\` extension.

## Path

\`\`\`
${entry.binPath}
\`\`\`

## Usage

\`\`\`bash
${entry.binPath} --help
${entry.binPath} --version
${entry.binPath} schema
${entry.binPath} doctor
\`\`\`

## Installation

This tool was auto-installed from the \`${entry.template}\` template. To reinstall:

\`\`\`
Use the toolbox_manage tool with action "install" and template "${entry.template}"
\`\`\`

## Pi Tool

This tool is registered as \`${entry.piToolName}\` in Pi and can be called directly by the LLM.
`;

  writeFileSync(skillPath, content, "utf8");
  return skillPath;
}

export function removeSkill(name: string): void {
  const skillDir = join(SKILLS_DIR, name);
  if (existsSync(skillDir)) {
    rmSync(skillDir, { recursive: true, force: true });
  }
}
