import { type MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Paper, ToggleButton, ToggleButtonGroup } from '@mui/material';
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
  visTimelineWindowForRange,
  type VisTimelineRange,
} from './documents.logic.js';

const DEFAULT_RANGE = 'three-months';
const rangeSchema = z.enum(['three-months', 'year', 'all']);
const selectPayloadSchema = z.object({ items: z.array(z.union([z.string(), z.number()])) });

const options: TimelineOptions = {
  stack: true,
  orientation: 'top',
  selectable: true,
  multiselect: false,
  editable: false,
  zoomable: true,
  moveable: true,
  margin: { item: 6, axis: 12 },
  zoomMin: 7 * 86_400_000,
  zoomMax: 5 * 365 * 86_400_000,
  tooltip: { followMouse: true, overflowMethod: 'cap' },
  format: {
    minorLabels: formatVisTimelineMinorLabel,
    majorLabels: formatVisTimelineMajorLabel,
  },
};

const timelineSx = {
  mt: 3,
  overflow: 'hidden',
  '& .timeline-controls': { borderBottom: 1, borderColor: 'divider' },
  '& .vis-timeline': { borderColor: 'divider', fontFamily: 'inherit' },
  '& .vis-labelset .vis-label': { color: 'text.primary', borderColor: 'divider' },
  '& .vis-labelset .vis-label .vis-inner': { px: 2, py: 1 },
  '& .vis-time-axis .vis-text': { color: 'text.secondary', fontSize: 12 },
  '& .vis-time-axis .vis-grid.vis-minor, & .vis-grid.vis-vertical': { borderColor: 'divider' },
  '& .vis-panel': { backgroundColor: 'background.paper', borderColor: 'divider' },
  '& .vis-item.doc': { backgroundColor: 'transparent', borderColor: 'transparent' },
  '& .vis-item.doc .vis-item-content': {
    borderRadius: 1,
    color: 'common.white',
    fontWeight: 600,
    px: 1,
    py: 0.5,
  },
  '& .vis-item.vis-point.doc .vis-item-content': { marginLeft: 0.5 },
  '& .doc-mark': { display: 'inline-block', fontWeight: 700, marginRight: 0.75 },
  '& .doc--umowa-uod .vis-item-content': { backgroundColor: DOCUMENT_TYPE_COLORS['umowa-uod'] },
  '& .doc--uchwala .vis-item-content': { backgroundColor: DOCUMENT_TYPE_COLORS.uchwala },
  '& .doc--protokol .vis-item-content': { backgroundColor: DOCUMENT_TYPE_COLORS.protokol },
  '& .doc--rachunek .vis-item-content': { backgroundColor: DOCUMENT_TYPE_COLORS.rachunek },
  '& .doc--inny .vis-item-content': { backgroundColor: DOCUMENT_TYPE_COLORS.inny },
  '& .doc--umowa-uod .vis-dot': { borderColor: DOCUMENT_TYPE_COLORS['umowa-uod'] },
  '& .doc--uchwala .vis-dot': { borderColor: DOCUMENT_TYPE_COLORS.uchwala },
  '& .doc--protokol .vis-dot': { borderColor: DOCUMENT_TYPE_COLORS.protokol },
  '& .doc--rachunek .vis-dot': { borderColor: DOCUMENT_TYPE_COLORS.rachunek },
  '& .doc--inny .vis-dot': { borderColor: DOCUMENT_TYPE_COLORS.inny },
};

export const DocumentTimelineView = ({
  documents,
  dateFrom,
  dateTo,
  onOpenDocument,
}: {
  documents: DocumentWithFiles[];
  dateFrom: string;
  dateTo: string;
  onOpenDocument: (documentId: string) => void;
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<Timeline | null>(null);
  const itemsRef = useRef<DataSet<DataItem> | null>(null);
  const groupsRef = useRef<DataSet<DataGroup> | null>(null);
  const onOpenDocumentRef = useRef(onOpenDocument);
  const [range, setRange] = useState<VisTimelineRange>(DEFAULT_RANGE);
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
    // WHY start/end instead of setWindow: vis-timeline fits the whole data span
    // on the first data change unless the window was given as an option.
    const timeline = new Timeline(container, items, groups, {
      ...options,
      ...(visTimelineWindowForRange(DEFAULT_RANGE, new Date()) ?? {}),
    });
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
  }, [data]);

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline || (!dateFrom && !dateTo)) return;
    const current = timeline.getWindow();
    timeline.setWindow(dateFrom || current.start, dateTo || current.end, { animation: false });
  }, [dateFrom, dateTo]);

  const changeRange = (_event: MouseEvent<HTMLElement>, next: unknown) => {
    const parsed = rangeSchema.safeParse(next);
    if (!parsed.success) return;
    setRange(parsed.data);
    const timeline = timelineRef.current;
    if (!timeline) return;
    const nextWindow = visTimelineWindowForRange(parsed.data, new Date());
    if (nextWindow) timeline.setWindow(nextWindow.start, nextWindow.end, { animation: false });
    else timeline.fit({ animation: false });
  };

  return (
    <Paper variant="outlined" sx={timelineSx}>
      <Box className="timeline-controls" sx={{ overflowX: 'auto', p: 1.5 }}>
        <ToggleButtonGroup exclusive size="small" value={range} onChange={changeRange}>
          <ToggleButton value="three-months">Poprz.–bież.–nast.</ToggleButton>
          <ToggleButton value="year">Rok</ToggleButton>
          <ToggleButton value="all">Wszystko</ToggleButton>
        </ToggleButtonGroup>
      </Box>
      <Box ref={containerRef} role="region" aria-label="Os czasu dokumentów" sx={{ minHeight: 180 }} />
    </Paper>
  );
};
