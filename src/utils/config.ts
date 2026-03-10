import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

// KSeF API v2 base URLs (changed in 2026 — new domain pattern)
const KSEF_URLS: Record<string, string> = {
  test: "https://api-test.ksef.mf.gov.pl/v2",
  demo: "https://api-demo.ksef.mf.gov.pl/v2",
  prod: "https://api.ksef.mf.gov.pl/v2",
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

  /** Switch environment at runtime (test/demo/prod). Clears cached session. */
  setEnvironment(env: KsefEnvironment): void {
    if (!KSEF_URLS[env]) throw new Error(`Nieznane środowisko: ${env}`);
    this.env = env;
  },

  /** Override NIP at runtime. */
  setNip(nip: string): void {
    this.nip = nip;
  },

  /** Override token at runtime. */
  setToken(token: string): void {
    this.token = token;
  },
};

export function ensureDataDirs(): void {
  mkdirSync(config.dataDir, { recursive: true });
}
