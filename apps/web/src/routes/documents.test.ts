import { describe, expect, it } from 'vitest';

import { legacyDocumentsRedirect } from './documents.js';

describe('legacyDocumentsRedirect', () => {
  it('moves legacy trash links to the trash route', () => {
    expect(legacyDocumentsRedirect('?tab=kosz&tag=ważne')).toEqual({ to: '/app/kosz' });
  });

  it('strips the legacy folders tab and keeps valid document filters', () => {
    expect(legacyDocumentsRedirect('?tab=teczki&tag=ważne&szkice=all')).toEqual({
      to: '/app/documents',
      search: { tag: 'ważne', szkice: 'all' },
    });
  });

  it('leaves current document searches unchanged', () => {
    expect(legacyDocumentsRedirect('?widok=os-czasu')).toBeNull();
  });
});
