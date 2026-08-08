import pkg from '../../../package.json' with { type: 'json' };

/** Single release-identity source, derived from package.json — never hardcoded. */
export const APP_VERSION = pkg.version;
