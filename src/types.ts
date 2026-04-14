export interface ToolSpec {
  name: string;
  description: string;
  dependencies: Record<string, string>;
  imports: string;
  options_help: string;
  examples_help: string;
  parse_options: string;
  schema: string;
  run_code: string;
  doctor_code: string;
}

export interface RegistryEntry {
  name: string;
  version: string;
  description: string;
  capabilities: string[];
  installedAt: string;
  installDir: string;
  binPath: string;
  piToolName: string;
  promptSnippet: string;
  promptGuidelines: string[];
}

export interface ValidationResult {
  passed: boolean;
  checks: ValidationCheck[];
}

export interface ValidationCheck {
  name: string;
  passed: boolean;
  message: string;
}

export const TOOLBOX_DIR = `${process.env.HOME}/.pi/agent/toolbox`;
export const REGISTRY_DIR = `${TOOLBOX_DIR}/registry`;
export const INSTALLS_DIR = `${TOOLBOX_DIR}/installs`;
export const BIN_DIR = `${TOOLBOX_DIR}/bin`;
export const SKILLS_DIR = `${TOOLBOX_DIR}/skills`;

export const HELP_SECTIONS = ["NAME", "USAGE", "DESCRIPTION", "OPTIONS", "EXAMPLES", "EXIT CODES"] as const;
