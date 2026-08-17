import { describe, expect, it } from 'vitest';

import { DEFAULT_DOCUMENT_TYPES } from './document-type.js';
import {
  selectableDocumentTypes,
  uniqueDocumentPersons,
  uniqueDocumentTags,
  visibleFilterValues,
} from './filter-values.js';
import type { HiddenFilterValue } from './hidden-filter-value.js';

const hidden = (kind: 'person' | 'tag', value: string): HiddenFilterValue => ({
  id: `${kind}-${value}`,
  tenantId: 'tenant-default',
  kind,
  value,
});

describe('filter value suggestions', () => {
  it('collects unique persons and tags in Polish order', () => {
    expect(
      uniqueDocumentTags([{ tags: ['ważne', 'podpis'] }, { tags: ['ważne'] }]),
    ).toEqual(['podpis', 'ważne']);
    expect(
      uniqueDocumentPersons([
        { person: 'Anna Nowak' },
        { person: ' Jan Kowalski ' },
        { person: 'Anna Nowak' },
        { person: null },
      ]),
    ).toEqual(['Anna Nowak', 'Jan Kowalski']);
  });

  it('drops hidden values of the requested kind only', () => {
    const hiddenValues = [hidden('person', 'Jan Kowalski'), hidden('tag', 'Jan Kowalski')];
    expect(
      visibleFilterValues(['Anna Nowak', 'Jan Kowalski'], hiddenValues, 'person'),
    ).toEqual(['Anna Nowak']);
    expect(visibleFilterValues(['Jan Kowalski'], hiddenValues, 'tag')).toEqual([]);
    expect(visibleFilterValues(['Anna Nowak'], [], 'person')).toEqual(['Anna Nowak']);
  });

  it('keeps a hidden document type selectable only for the value already in use', () => {
    const documentTypes = DEFAULT_DOCUMENT_TYPES.map((documentType) =>
      documentType.slug === 'rachunek' ? { ...documentType, hidden: true } : documentType,
    );
    expect(selectableDocumentTypes(documentTypes).map((type) => type.slug)).not.toContain(
      'rachunek',
    );
    expect(
      selectableDocumentTypes(documentTypes, 'rachunek').map((type) => type.slug),
    ).toContain('rachunek');
  });
});
