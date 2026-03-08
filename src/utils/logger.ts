import { config } from "./config.js";

const LOG_LEVELS: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
  /[A-Za-z0-9+/]{40,}={0,2}/g, // long base64 strings
];

function maskSecrets(text: string): string {
  let masked = text;
  for (const pattern of SECRET_PATTERNS) {
    masked = masked.replace(pattern, (match) => {
      if (match.length < 20) return match;
      return match.slice(0, 6) + "***" + match.slice(-4);
    });
  }
  // Mask full NIP if present
  if (config.nip) {
    masked = masked.replaceAll(config.nip, config.maskedNip);
  }
  return masked;
}

export function log(level: "debug" | "info" | "warn" | "error", message: string, data?: unknown): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[config.logLevel]) return;

  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(data !== undefined ? { data } : {}),
  };

  const raw = JSON.stringify(entry);
  process.stderr.write(maskSecrets(raw) + "\n");
}
