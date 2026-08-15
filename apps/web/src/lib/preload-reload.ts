const PRELOAD_RELOAD_COOLDOWN_MS = 30_000;

export const shouldReloadAfterPreloadError = (
  lastReloadAt: number | null,
  now: number,
): boolean =>
  lastReloadAt === null ||
  !Number.isFinite(lastReloadAt) ||
  now - lastReloadAt >= PRELOAD_RELOAD_COOLDOWN_MS;
