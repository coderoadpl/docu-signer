import { z } from 'zod';

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 63;

/**
 * Names that collide with platform subdomains, auth routes or reserved words.
 * A tenant slug becomes a subdomain, so none of these may ever be taken.
 */
export const RESERVED_SLUGS: readonly string[] = [
  'www',
  'api',
  'app',
  'admin',
  'auth',
  'login',
  'logout',
  'register',
  'signin',
  'signup',
  'static',
  'assets',
  'cdn',
  'mail',
  'smtp',
  'ftp',
  'internal',
  'health',
  'status',
  'support',
  'help',
  'dashboard',
  'billing',
  'settings',
  'account',
];

const canonicalPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const isReserved = (slug: string): boolean => RESERVED_SLUGS.includes(slug);

/**
 * Canonicalize free text into a slug candidate: lowercase, collapse every run
 * of non-alphanumerics to a single hyphen, trim hyphens off both ends.
 */
export const normalizeSlug = (raw: string): string =>
  raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Validates an already-canonical slug: charset, length bounds, not reserved. */
export const canonicalSlugSchema = z
  .string()
  .min(SLUG_MIN_LENGTH, `Slug must be at least ${SLUG_MIN_LENGTH} characters`)
  .max(SLUG_MAX_LENGTH, `Slug must be at most ${SLUG_MAX_LENGTH} characters`)
  .regex(canonicalPattern, 'Slug must be lowercase letters, digits and single hyphens')
  .refine((slug) => !isReserved(slug), { message: 'Slug is reserved' });

/** The value-object schema: normalizes free input, then enforces the canonical shape. */
export const slugSchema = z.string().transform(normalizeSlug).pipe(canonicalSlugSchema);

export type Slug = z.infer<typeof canonicalSlugSchema>;
