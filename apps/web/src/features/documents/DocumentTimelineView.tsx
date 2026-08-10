import { useEffect, useMemo, useRef } from 'react';
import { Box, Paper } from '@mui/material';
import { z } from 'zod';
import {
  DataSet,
  Timeline,
  type DataGroup,
  type DataItem,
  type TimelineOptions,
} from 'vis-timeline/standalone';
import 'vis-timeline/styles/vis-timeline-graph2d.min.css';

import { type DocumentWithFiles } from '#core/domain/index.js';

import {
  DOCUMENT_TYPE_COLORS,
  formatVisTimelineMajorLabel,
  formatVisTimelineMinorLabel,
  groupDocumentsForTimeline,
  toVisTimelineData,
  visTimelineFittedWindow,
} from './documents.logic.js';

const selectPayloadSchema = z.object({ items: z.array(z.union([z.string(), z.number()])) });

const options: TimelineOptions = {
  stack: true,
  orientation: 'top',
  selectable: true,
  multiselect: false,
  editable: false,
  zoomable: true,
  moveable: true,
  margin: { item: 8, axis: 12 },
  zoomMin: 7 * 86_400_000,
  zoomMax: 5 * 365 * 86_400_000,
  tooltip: { followMouse: true, overflowMethod: 'cap' },
  format: {
    minorLabels: formatVisTimelineMinorLabel,
    majorLabels: formatVisTimelineMajorLabel,
  },
};

const docTypePalette = Object.fromEntries(
  Object.entries(DOCUMENT_TYPE_COLORS).map(([docType, color]) => [
    `& .doc--${docType}`,
    { '--doc-color': color, '--doc-tint': `${color}14` },
  ]),
);

const chipSurface = {
  backgroundColor: 'background.paper',
  border: '1px solid var(--doc-color)',
  borderRadius: 1.5,
};

const chipSelected = {
  backgroundColor: 'var(--doc-tint)',
  boxShadow: 'inset 0 0 0 1px var(--doc-color)',
};

const timelineSx = {
  mt: 3,
  overflow: 'hidden',
  '& .vis-timeline': { border: 0, fontFamily: 'inherit' },
  '& .vis-labelset .vis-label': { color: 'text.primary', borderColor: 'divider' },
  '& .vis-labelset .vis-label .vis-inner': { px: 2, py: 1 },
  '& .vis-time-axis .vis-text': { color: 'text.secondary', fontSize: 12 },
  '& .vis-time-axis .vis-grid.vis-minor, & .vis-grid.vis-vertical': { borderColor: 'divider' },
  '& .vis-panel': { backgroundColor: 'background.paper', borderColor: 'divider' },
  ...docTypePalette,
  '& .vis-item.doc': { color: 'var(--doc-color)', fontSize: 13, fontWeight: 600 },
  // Chips keep their full width whatever the period measures, so a title is
  // never sliced by the bar it belongs to.
  '& .vis-item.doc .vis-item-overflow': { overflow: 'visible' },
  '& .vis-item.doc .vis-item-content': { ...chipSurface, lineHeight: '22px', px: 1, py: 0 },
  '& .vis-item.doc .vis-item-content > span:first-of-type': { fontWeight: 700, mr: '5px' },
  '& .vis-item.doc .vis-item-content > span:last-of-type': {
    display: 'inline-block',
    maxWidth: 260,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    verticalAlign: 'bottom',
  },
  '& .vis-item.vis-range.doc': {
    background: 'linear-gradient(var(--doc-color), var(--doc-color)) bottom / 100% 2px no-repeat',
    border: 0,
    pb: '5px',
  },
  '& .vis-item.vis-point.doc': { background: 'none', border: 0 },
  '& .vis-item.vis-dot.doc': {
    width: 8,
    height: 8,
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: 'var(--doc-color)',
    borderRadius: '50%',
    backgroundColor: 'background.paper',
  },
  '& .vis-item.doc.vis-selected .vis-item-content': chipSelected,
};

export const DocumentTimelineView = ({
  documents,
  onOpenDocument,
}: {
  documents: DocumentWithFiles[];
  onOpenDocument: (documentId: string) => void;
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<Timeline | null>(null);
  const itemsRef = useRef<DataSet<DataItem> | null>(null);
  const groupsRef = useRef<DataSet<DataGroup> | null>(null);
  const onOpenDocumentRef = useRef(onOpenDocument);
  const data = useMemo(
    () => toVisTimelineData(groupDocumentsForTimeline(documents)),
    [documents],
  );

  useEffect(() => {
    onOpenDocumentRef.current = onOpenDocument;
  }, [onOpenDocument]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const items = new DataSet<DataItem>();
    const groups = new DataSet<DataGroup>();
    const timeline = new Timeline(container, items, groups, options);
    timeline.on('select', (payload?: unknown) => {
      const parsed = selectPayloadSchema.safeParse(payload);
      if (!parsed.success) return;
      const id = parsed.data.items.at(0);
      if (id !== undefined) onOpenDocumentRef.current(String(id));
    });
    itemsRef.current = items;
    groupsRef.current = groups;
    timelineRef.current = timeline;
    return () => {
      timeline.destroy();
      timelineRef.current = null;
      itemsRef.current = null;
      groupsRef.current = null;
    };
  }, []);

  useEffect(() => {
    groupsRef.current?.clear();
    groupsRef.current?.add(data.groups);
    itemsRef.current?.clear();
    itemsRef.current?.add(data.items);
    // WHY deferred: vis-timeline runs its own fit on the first data change and
    // overwrites a window set synchronously here.
    const frame = requestAnimationFrame(() => {
      const panel = containerRef.current?.querySelector('.vis-panel.vis-center');
      const fitted = visTimelineFittedWindow(data.items, panel?.clientWidth ?? 0);
      if (fitted) timelineRef.current?.setWindow(fitted.start, fitted.end, { animation: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [data]);

  return (
    <Paper variant="outlined" sx={timelineSx}>
      <Box ref={containerRef} role="region" aria-label="Oś czasu dokumentów" sx={{ minHeight: 180 }} />
    </Paper>
  );
};
