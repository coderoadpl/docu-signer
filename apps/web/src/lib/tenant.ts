/**
 * URL of a sibling tenant on the same base domain (acme.localhost →
 * globex.localhost), or `null` on a `<project>.vercel.app` apex: Vercel refuses
 * to add a subdomain under a project's own `*.vercel.app` ("<team> does not have
 * access to *.<project>.vercel.app domains"), so tenant subdomains cannot exist
 * there. Browser multi-tenancy needs a real wildcard base domain (ADR-0003);
 * until then tenant switching is the CLI's `--tenant`.
 */
export const tenantUrl = (slug: string): string | null => {
  const { protocol, hostname, port } = window.location;
  const parts = hostname.split('.');
  const base = parts.length > 1 ? parts.slice(1).join('.') : hostname;
  if (base === 'vercel.app') return null;
  return `${protocol}//${slug}.${base}${port ? `:${port}` : ''}`;
};

/** Stable accent hue per tenant so each tenant is visibly its own world. */
export const tenantHue = (slug: string): number => {
  let hash = 0;
  for (const char of slug) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return Math.round((hash * 137.508) % 360);
};
