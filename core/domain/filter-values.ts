import type { DocumentType } from './document-type.js';
import type { DocumentWithFiles } from './document.js';
import type { HiddenFilterKind, HiddenFilterValue } from './hidden-filter-value.js';

export const uniqueDocumentPersons = (
  documents: Array<Pick<DocumentWithFiles, 'person'>>,
): string[] =>
  Array.from(
    new Set(
      documents
        .map((document) => document.person?.trim())
        .filter((person): person is string => Boolean(person)),
    ),
  ).sort((left, right) => left.localeCompare(right, 'pl'));

export const uniqueDocumentTags = (
  documents: Array<Pick<DocumentWithFiles, 'tags'>>,
): string[] =>
  Array.from(new Set(documents.flatMap((document) => document.tags))).sort((left, right) =>
    left.localeCompare(right, 'pl'),
  );

export const visibleFilterValues = (
  values: readonly string[],
  hiddenFilterValues: readonly HiddenFilterValue[],
  kind: HiddenFilterKind,
): string[] => {
  const hidden = new Set(
    hiddenFilterValues.filter((entry) => entry.kind === kind).map((entry) => entry.value),
  );
  return values.filter((value) => !hidden.has(value));
};

export const selectableDocumentTypes = (
  documentTypes: readonly DocumentType[],
  currentSlug?: string,
): DocumentType[] =>
  documentTypes.filter(
    (documentType) => !documentType.hidden || documentType.slug === currentSlug,
  );
