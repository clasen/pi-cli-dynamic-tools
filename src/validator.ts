import { execFileSync } from "node:child_process";
import { HELP_SECTIONS, type ValidationResult, type ValidationCheck } from "./types.js";

function run(binPath: string, args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync(binPath, args, {
      encoding: "utf8",
      timeout: 15_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      exitCode: typeof err.status === "number" ? err.status : 1,
    };
  }
}

function checkHelp(binPath: string): ValidationCheck {
  const { stdout, exitCode } = run(binPath, ["--help"]);
  if (exitCode !== 0) {
    return { name: "--help", passed: false, message: `--help exited with code ${exitCode}` };
  }
  const missing = HELP_SECTIONS.filter((s) => !stdout.includes(s));
  if (missing.length > 0) {
    return { name: "--help", passed: false, message: `--help output missing sections: ${missing.join(", ")}` };
  }
  return { name: "--help", passed: true, message: "OK" };
}

function checkShortHelp(binPath: string): ValidationCheck {
  const long = run(binPath, ["--help"]);
  const short = run(binPath, ["-h"]);
  if (short.exitCode !== 0) {
    return { name: "-h", passed: false, message: `-h exited with code ${short.exitCode}` };
  }
  if (short.stdout.trim() !== long.stdout.trim()) {
    return { name: "-h", passed: false, message: "-h output differs from --help" };
  }
  return { name: "-h", passed: true, message: "OK" };
}

function checkSchema(binPath: string): ValidationCheck {
  const { stdout, exitCode } = run(binPath, ["schema"]);
  if (exitCode !== 0) {
    return { name: "schema", passed: false, message: `schema exited with code ${exitCode}` };
  }
  try {
    const parsed = JSON.parse(stdout);
    if (typeof parsed !== "object" || parsed === null) {
      return { name: "schema", passed: false, message: "schema output is not a JSON object" };
    }
    return { name: "schema", passed: true, message: "OK" };
  } catch {
    return { name: "schema", passed: false, message: "schema output is not valid JSON" };
  }
}

function checkVersion(binPath: string): ValidationCheck {
  const { stdout, exitCode } = run(binPath, ["--version"]);
  if (exitCode !== 0) {
    return { name: "--version", passed: false, message: `--version exited with code ${exitCode}` };
  }
  if (!stdout.trim()) {
    return { name: "--version", passed: false, message: "--version returned empty output" };
  }
  return { name: "--version", passed: true, message: "OK" };
}

function checkDoctor(binPath: string): ValidationCheck {
  const { stdout, stderr, exitCode } = run(binPath, ["doctor"]);
  if (exitCode !== 0) {
    const detail = (stderr || stdout).trim().slice(0, 200);
    return { name: "doctor", passed: false, message: `doctor exited with code ${exitCode}: ${detail}` };
  }
  return { name: "doctor", passed: true, message: "OK" };
}

export function validate(binPath: string): ValidationResult {
  const checks: ValidationCheck[] = [
    checkHelp(binPath),
    checkShortHelp(binPath),
    checkSchema(binPath),
    checkVersion(binPath),
    checkDoctor(binPath),
  ];
  return { passed: checks.every((c) => c.passed), checks };
}
