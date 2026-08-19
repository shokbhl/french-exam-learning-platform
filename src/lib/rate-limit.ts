/**
 * A fixed-window rate limiter held in process memory.
 *
 * This is deliberately modest about what it provides. Each serverless instance
 * keeps its own counters, so the effective limit across a deployment is the
 * configured limit multiplied by the number of running instances, and every
 * counter resets on redeploy. That is enough to stop one signed-in learner
 * hammering an endpoint in a loop, which is what it is here for. It is not a
 * defence against a distributed attacker, and it is not a licensing control.
 *
 * Moving to a shared store (Redis, or a Postgres table with a window column)
 * is the upgrade path when the limit needs to hold across instances.
 */
type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

export function rateLimit(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || now >= existing.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Drops expired windows so the map cannot grow without bound. */
export function pruneRateLimits(now = Date.now()) {
  for (const [key, window] of windows) {
    if (now >= window.resetAt) windows.delete(key);
  }
}
