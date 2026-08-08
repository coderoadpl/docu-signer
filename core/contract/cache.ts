/**
 * The single source of the public-cache `Cache-Control` header (architecture
 * §HTTP caching). Public routes opt into caching ONLY through `publicCacheControl`
 * — no call site hand-writes a `Cache-Control` string, so the shape
 * (`public, max-age=0, s-maxage=<n>, stale-while-revalidate=<n>`: the browser
 * always revalidates, the edge caches for `s-maxage` and serves stale while it
 * refreshes) is impossible to drift. A config-regression probe enforces that the
 * `s-maxage`/`stale-while-revalidate` tokens appear in this file alone.
 *
 * Authenticated envelopes never reach here: they keep the `respond()` default of
 * `no-store`, and errors on public routes are pinned to `no-store` at that seam
 * too, so a transient failure can never be cached at the edge.
 */
export const PUBLIC_CACHE_PROFILES = {
  /**
   * Discovery of the current content version — deliberately short so a consumer
   * re-checks cheaply; the real payload lives behind the long-cached versioned
   * URL keyed on the value this route returns.
   */
  discovery: { sMaxage: 30, staleWhileRevalidate: 30 },
  /**
   * The version-keyed profile — long-cached because a content change is a new
   * version, hence a new URL, hence a new cache entry (busting by key, never a
   * purge).
   */
  profile: { sMaxage: 300, staleWhileRevalidate: 600 },
} as const;

export type PublicCacheProfile = keyof typeof PUBLIC_CACHE_PROFILES;

export const publicCacheControl = (profile: PublicCacheProfile): string => {
  const { sMaxage, staleWhileRevalidate } = PUBLIC_CACHE_PROFILES[profile];
  return `public, max-age=0, s-maxage=${sMaxage}, stale-while-revalidate=${staleWhileRevalidate}`;
};
