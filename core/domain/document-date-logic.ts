export interface DocumentDateIntervalSource {
  documentDate: string;
  periodStart?: string | null | undefined;
  periodEnd?: string | null | undefined;
}

export const documentDateInterval = (
  document: DocumentDateIntervalSource,
): { start: string; end: string } => ({
  start: document.periodStart ?? document.documentDate,
  end: document.periodEnd ?? document.documentDate,
});

export const documentCoveredYears = (
  document: DocumentDateIntervalSource,
): number[] => {
  const interval = documentDateInterval(document);
  const startYear = Number(interval.start.slice(0, 4));
  const endYear = Number(interval.end.slice(0, 4));
  return Array.from({ length: endYear - startYear + 1 }, (_unused, index) => startYear + index);
};
