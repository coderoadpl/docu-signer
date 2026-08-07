import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterAll, afterEach } from 'vitest';

import { server } from './server.js';

/**
 * Start MSW at module scope, before any test file (and thus `api.ts`) is
 * imported: the Better Auth client grabs `globalThis.fetch` the moment its
 * adapter is constructed, so interception must already be installed — otherwise
 * it captures the pre-MSW fetch and its requests bypass the mock server.
 */
server.listen({ onUnhandledRequest: 'error' });

/**
 * jsdom and undici expose AbortSignal from different realms, so the signal
 * TanStack Query and the Better Auth client attach fails undici's `instanceof`
 * check — inside MSW's request cloning for `fetch`, and inside `new Request()`
 * (Better Auth builds its own timeout signal there). Tests never abort, so drop
 * the signal at both seams, layered on top of MSW's patched fetch.
 */
const dropSignal = (init?: RequestInit): RequestInit | undefined =>
  init === undefined ? init : { ...init, signal: null };

const patchedFetch = globalThis.fetch;
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
  patchedFetch(input, dropSignal(init));
const OriginalRequest = globalThis.Request;
globalThis.Request = class extends OriginalRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, dropSignal(init));
  }
};

afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
