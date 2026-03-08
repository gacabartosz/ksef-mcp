import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

const KSEF_URLS: Record<string, string> = {
  test: "https://ksef-test.mf.gov.pl/api",
  demo: "https://ksef-demo.mf.gov.pl/api",
  prod: "https://ksef.mf.gov.pl/api",
};

const DATA_DIR = process.env.KSEF_DATA_DIR || join(homedir(), ".ksef-mcp");

export type KsefEnvironment = "test" | "demo" | "prod";

export const config = {
  dataDir: DATA_DIR,
  sessionFile: join(DATA_DIR, "session.json"),

  env: (process.env.KSEF_ENV || "test") as KsefEnvironment,
  nip: process.env.KSEF_NIP || "",
  token: process.env.KSEF_TOKEN || "",
  keyPath: process.env.KSEF_KEY_PATH || "",
  certPath: process.env.KSEF_CERT_PATH || "",
  approvalMode: (process.env.KSEF_APPROVAL_MODE || "manual") as "auto" | "manual",
  logLevel: (process.env.KSEF_LOG_LEVEL || "info") as "debug" | "info" | "warn" | "error",

  get baseUrl(): string {
    return KSEF_URLS[this.env] || KSEF_URLS.test;
  },

  get maskedNip(): string {
    if (!this.nip) return "(brak)";
    return this.nip.slice(0, 3) + "***" + this.nip.slice(-2);
  },
};

export function ensureDataDirs(): void {
  mkdirSync(config.dataDir, { recursive: true });
}
