import { describe, expect, it } from 'vitest';

import * as contract from '#core/contract/index.js';

describe('contract barrel', () => {
  it('re-exports the envelope, http-status and routes surface', () => {
    expect(typeof contract.toEnvelope).toBe('function');
    expect(typeof contract.envelopeSchema).toBe('function');
    expect(contract.HTTP_STATUS_BY_ERROR_CODE.internal).toBe(500);
    expect(contract.EXIT_CODE_BY_ERROR_CODE.internal).toBe(10);
    expect(contract.API_ROUTES.health.path).toBe('/api/health');
    expect(contract.TENANT_HEADER).toBe('x-tenant');
  });
});
