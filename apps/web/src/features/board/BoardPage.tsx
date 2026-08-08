import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Container,
  InputBase,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';

import { boardSelectors, send, subscribe, type BoardCard } from './index.web.js';

/**
 * Board view — talks ONLY to the island seam (the web composition index.web.ts):
 * it reads through `boardSelectors` and emits intents through `send`. It never
 * imports api.ts, the core factory, a descriptor or the store, so the core can
 * graduate rungs without touching this file. Card movement is driven by accessible
 * buttons (the primary, dependency-free mechanism).
 */
export const BoardPage = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const cards = useQuery(boardSelectors.list);
  const overlay = useSyncExternalStore(subscribe, boardSelectors.snapshot);

  const errorCode = cards.error instanceof ApiError ? cards.error.appError.code : null;
  const unauthorized = errorCode === 'unauthorized';
  // No tenant resolved (apex host): the app shell at "/app" owns tenant selection.
  const tenantless = errorCode === 'tenant_not_found';

  useEffect(() => {
    if (unauthorized) void navigate({ to: '/login' });
    else if (tenantless) void navigate({ to: '/app' });
  }, [unauthorized, tenantless, navigate]);

  useEffect(() => {
    if (overlay.committedRev === 0) return;
    void queryClient.invalidateQueries(boardSelectors.invalidates());
  }, [overlay.committedRev, queryClient]);

  const board = boardSelectors.board(cards.data?.cards ?? []);
  const canUndo = boardSelectors.canUndo();
  const columns = boardSelectors.columns;

  // Never render an operable-looking board without auth + tenant context —
  // the effect above is already redirecting.
  if (unauthorized || tenantless) return null;

  return (
    <Container disableGutters sx={{ maxWidth: '60rem !important', px: '1.25rem', py: '3rem' }}>
      <Stack direction="row" useFlexGap sx={{ alignItems: 'baseline', columnGap: '1rem', mb: '1.5rem' }}>
        <Typography variant="h1">Board</Typography>
        <Box sx={{ flex: 1 }} />
        {canUndo ? (
          <Button variant="outlined" onClick={() => send({ type: 'undoRequested' })}>
            undo
          </Button>
        ) : null}
        <Button
          variant="text"
          onClick={() => {
            send({ type: 'refreshRequested' });
            void queryClient.invalidateQueries(boardSelectors.invalidates());
          }}
        >
          refresh
        </Button>
      </Stack>

      {cards.isPending ? <Typography>loading…</Typography> : null}
      {cards.isError ? <Alert>{cards.error.message}</Alert> : null}

      <Stack direction="row" useFlexGap sx={{ gap: '1rem', alignItems: 'flex-start' }}>
        {columns.map((column, columnIndex) => {
          const leftColumn = columns[columnIndex - 1];
          const rightColumn = columns[columnIndex + 1];
          return (
            <Paper
              key={column}
              component="section"
              variant="outlined"
              aria-label={column}
              sx={{ flex: 1, p: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}
            >
              <Typography variant="overline" component="h2">
                {column}
              </Typography>
              <Stack useFlexGap sx={{ gap: '0.5rem' }}>
                {board[column].map((card, cardIndex) => (
                  <CardRow
                    key={card.id}
                    card={card}
                    columnName={column}
                    cardIndex={cardIndex}
                    columnCount={board[column].length}
                    leftColumn={leftColumn}
                    rightColumn={rightColumn}
                    leftColumnSize={leftColumn === undefined ? 0 : board[leftColumn].length}
                    rightColumnSize={rightColumn === undefined ? 0 : board[rightColumn].length}
                  />
                ))}
              </Stack>
              <AddCardForm column={column} />
            </Paper>
          );
        })}
      </Stack>
    </Container>
  );
};

const CardRow = ({
  card,
  columnName,
  cardIndex,
  columnCount,
  leftColumn,
  rightColumn,
  leftColumnSize,
  rightColumnSize,
}: {
  card: BoardCard;
  columnName: string;
  cardIndex: number;
  columnCount: number;
  leftColumn: string | undefined;
  rightColumn: string | undefined;
  leftColumnSize: number;
  rightColumnSize: number;
}) => {
  // A pending card's id is not yet server-confirmed: a move fired now targets
  // an id the server may not know and rolls back. The seam refuses moves until
  // the op settles (same rule as the team board).
  const saving = card.pending;
  const savingSuffix = saving ? ' (saving)' : '';
  return (
  <Paper
    variant="outlined"
    elevation={0}
    aria-busy={card.pending}
    sx={{ p: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}
  >
    <Typography>{card.title}</Typography>
    <Stack direction="row" useFlexGap sx={{ gap: '0.25rem' }}>
      <Button
        size="small"
        aria-label={`Move ${card.title} left${savingSuffix}`}
        disabled={saving || leftColumn === undefined}
        onClick={() =>
          leftColumn === undefined
            ? undefined
            : send({
                type: 'cardMoved',
                cardId: card.id,
                fromColumn: columnName,
                fromIndex: cardIndex,
                toColumn: leftColumn,
                toIndex: leftColumnSize,
                toColumnSize: leftColumnSize,
              })
        }
      >
        ◀
      </Button>
      <Button
        size="small"
        aria-label={`Move ${card.title} up${savingSuffix}`}
        disabled={saving || cardIndex === 0}
        onClick={() =>
          send({
            type: 'cardMoved',
            cardId: card.id,
            fromColumn: columnName,
            fromIndex: cardIndex,
            toColumn: columnName,
            toIndex: cardIndex - 1,
            toColumnSize: columnCount,
          })
        }
      >
        ▲
      </Button>
      <Button
        size="small"
        aria-label={`Move ${card.title} down${savingSuffix}`}
        disabled={saving || cardIndex === columnCount - 1}
        onClick={() =>
          send({
            type: 'cardMoved',
            cardId: card.id,
            fromColumn: columnName,
            fromIndex: cardIndex,
            toColumn: columnName,
            toIndex: cardIndex + 1,
            toColumnSize: columnCount,
          })
        }
      >
        ▼
      </Button>
      <Button
        size="small"
        aria-label={`Move ${card.title} right${savingSuffix}`}
        disabled={saving || rightColumn === undefined}
        onClick={() =>
          rightColumn === undefined
            ? undefined
            : send({
                type: 'cardMoved',
                cardId: card.id,
                fromColumn: columnName,
                fromIndex: cardIndex,
                toColumn: rightColumn,
                toIndex: rightColumnSize,
                toColumnSize: rightColumnSize,
              })
        }
      >
        ▶
      </Button>
    </Stack>
  </Paper>
  );
};

const AddCardForm = ({ column }: { column: string }) => {
  const [title, setTitle] = useState('');
  return (
    <Paper
      component="form"
      variant="outlined"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        const trimmed = title.trim();
        if (trimmed === '') return;
        send({ type: 'cardAdded', title: trimmed, column });
        setTitle('');
      }}
      sx={{ mt: 'auto', display: 'flex', gap: '0.4rem', p: '0.25rem' }}
    >
      <InputBase
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="new card…"
        inputProps={{ 'aria-label': `New card in ${column}` }}
        sx={{ flex: 1, '& input': { p: '0.4rem 0.6rem' } }}
      />
      <Button type="submit" size="small" variant="contained">
        add
      </Button>
    </Paper>
  );
};
