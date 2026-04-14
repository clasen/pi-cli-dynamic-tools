import { readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { REGISTRY_DIR, type RegistryEntry } from "./types.js";

function ensureDir(): void {
  if (!existsSync(REGISTRY_DIR)) {
    mkdirSync(REGISTRY_DIR, { recursive: true });
  }
}

export function listEntries(): RegistryEntry[] {
  ensureDir();
  const files = readdirSync(REGISTRY_DIR).filter((f) => f.endsWith(".json"));
  const entries: RegistryEntry[] = [];
  for (const file of files) {
    try {
      const raw = readFileSync(join(REGISTRY_DIR, file), "utf8");
      entries.push(JSON.parse(raw) as RegistryEntry);
    } catch {
      // skip corrupt entries
    }
  }
  return entries;
}

export function getEntry(name: string): RegistryEntry | undefined {
  const filePath = join(REGISTRY_DIR, `${name}.json`);
  if (!existsSync(filePath)) return undefined;
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as RegistryEntry;
  } catch {
    return undefined;
  }
}

export function saveEntry(entry: RegistryEntry): void {
  ensureDir();
  writeFileSync(join(REGISTRY_DIR, `${entry.name}.json`), JSON.stringify(entry, null, 2), "utf8");
}

export function removeEntry(name: string): boolean {
  const filePath = join(REGISTRY_DIR, `${name}.json`);
  if (!existsSync(filePath)) return false;
  unlinkSync(filePath);
  return true;
}

export function findByCapability(capability: string): RegistryEntry | undefined {
  const keyword = capability.toLowerCase();
  return listEntries().find((e) =>
    e.capabilities.some((c) => c.toLowerCase().includes(keyword)) ||
    e.name.toLowerCase().includes(keyword) ||
    e.description.toLowerCase().includes(keyword),
  );
}
