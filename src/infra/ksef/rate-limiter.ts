/**
 * Token-bucket rate limiter per endpoint category.
 * Uses rolling windows (1s, 60s, 3600s) to enforce limits.
 */

import { log } from "../../utils/logger.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RateLimitConfig {
  perSecond: number;
  perMinute: number;
  perHour: number;
}

interface WindowState {
  timestamps: number[];
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_LIMITS: RateLimitConfig = {
  perSecond: 5,
  perMinute: 200,
  perHour: 1000,
};

function loadConfig(): RateLimitConfig {
  return {
    perSecond: parseInt(process.env.KSEF_RATE_LIMIT_PER_SECOND || "", 10) || DEFAULT_LIMITS.perSecond,
    perMinute: parseInt(process.env.KSEF_RATE_LIMIT_PER_MINUTE || "", 10) || DEFAULT_LIMITS.perMinute,
    perHour: parseInt(process.env.KSEF_RATE_LIMIT_PER_HOUR || "", 10) || DEFAULT_LIMITS.perHour,
  };
}

// ─── Rate Limiter ────────────────────────────────────────────────────────────

class RateLimiter {
  private windows: Map<string, WindowState> = new Map();
  private config: RateLimitConfig;

  constructor() {
    this.config = loadConfig();
  }

  /**
   * Acquire permission to make a request for the given key (endpoint category).
   * Waits if any rate limit window is exceeded.
   */
  async acquire(key: string): Promise<void> {
    const state = this.getOrCreate(key);
    const now = Date.now();

    // Prune old timestamps (older than 1 hour)
    state.timestamps = state.timestamps.filter((t) => now - t < 3_600_000);

    // Check each window and wait if necessary
    const waitMs = this.calculateWait(state, now);
    if (waitMs > 0) {
      log("debug", `Rate limit: waiting ${waitMs}ms for key '${key}'`);
      await this.sleep(waitMs);
    }

    // Record request
    state.timestamps.push(Date.now());
  }

  private getOrCreate(key: string): WindowState {
    let state = this.windows.get(key);
    if (!state) {
      state = { timestamps: [] };
      this.windows.set(key, state);
    }
    return state;
  }

  private calculateWait(state: WindowState, now: number): number {
    const { perSecond, perMinute, perHour } = this.config;

    // Check 1-second window
    const oneSecAgo = now - 1_000;
    const inLastSecond = state.timestamps.filter((t) => t > oneSecAgo);
    if (inLastSecond.length >= perSecond) {
      const oldest = inLastSecond[0]!;
      return oldest + 1_000 - now + 1; // wait until oldest exits the window
    }

    // Check 1-minute window
    const oneMinAgo = now - 60_000;
    const inLastMinute = state.timestamps.filter((t) => t > oneMinAgo);
    if (inLastMinute.length >= perMinute) {
      const oldest = inLastMinute[0]!;
      return oldest + 60_000 - now + 1;
    }

    // Check 1-hour window
    const oneHourAgo = now - 3_600_000;
    const inLastHour = state.timestamps.filter((t) => t > oneHourAgo);
    if (inLastHour.length >= perHour) {
      const oldest = inLastHour[0]!;
      return oldest + 3_600_000 - now + 1;
    }

    return 0;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Reset all windows (useful for testing). */
  reset(): void {
    this.windows.clear();
  }

  /** Reload config from environment variables. */
  reloadConfig(): void {
    this.config = loadConfig();
  }
}

// ─── Singleton Export ────────────────────────────────────────────────────────

export const rateLimiter = new RateLimiter();
