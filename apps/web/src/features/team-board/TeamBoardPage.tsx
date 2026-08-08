import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Container,
  InputBase,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';
import { TEAM_BOARD_ENTRY_COLUMN } from '#core/domain/index.js';
import type { Card, MoveVerdict, TeamColumn } from '#core/domain/index.js';

import { send, subscribe, teamBoardSelectors, type TeamCard } from './index.web.js';

const COLUMN_LABELS: Record<TeamColumn, string> = {
  todo: 'Do zrobienia',
  'in-dev': 'W realizacji',
  review: 'Weryfikacja',
  done: 'Gotowe',
};

const RULE_LABELS: Record<string, string> = {
  'wip-limit': 'limit pracy w toku',
  'done-only-from-review': 'ukończenie tylko po weryfikacji',
  'review-requires-in-dev': 'weryfikacja wymaga realizacji',
  'unknown-card': 'nieznana karta',
};

const ruleLabel = (rule: string): string => RULE_LABELS[rule] ?? rule;

/**
 * Team board view — talks ONLY to the island seam (the web composition
 * index.web.ts): it reads through `teamBoardSelectors` and emits intents through
 * `send`, never importing api.ts, the core factory, a descriptor or the machine.
 * This is the demo's whole point: the domain guards
 * are VISIBLE. Each column-move button asks the oracle (`teamBoardSelectors.verdict`)
 * whether the move is legal; an illegal one renders DISABLED with the rejecting
 * rule as its accessible label, tooltip and a visible caption. WIP counters show
 * each bounded column's occupancy against its limit (e.g. "2/3").
 */
export const TeamBoardPage = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const cards = useQuery(teamBoardSelectors.list);
  const overlay = useSyncExternalStore(subscribe, teamBoardSelectors.snapshot);

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
    void queryClient.invalidateQueries(teamBoardSelectors.invalidates());
  }, [overlay.committedRev, queryClient]);

  const board = teamBoardSelectors.board(cards.data?.cards ?? []);
  const grouped = teamBoardSelectors.grouped(board);
  const columns = teamBoardSelectors.columns;
  const rejection = teamBoardSelectors.lastRejection();

  // Never render an operable-looking board without auth + tenant context —
  // the effect above is already redirecting.
  if (unauthorized || tenantless) return null;

  return (
    <Container disableGutters sx={{ maxWidth: '70rem !important', px: '1.25rem', py: '3rem' }}>
      <Stack direction="row" useFlexGap sx={{ alignItems: 'baseline', columnGap: '1rem', mb: '1.5rem' }}>
        <Typography variant="h1">Tablica zespołu</Typography>
        <Box sx={{ flex: 1 }} />
        <Button
          variant="text"
          onClick={() => {
            send({ type: 'refreshRequested' });
            void queryClient.invalidateQueries(teamBoardSelectors.invalidates());
          }}
        >
          Odśwież
        </Button>
      </Stack>

      {cards.isPending ? <Typography>Ładowanie…</Typography> : null}
      {cards.isError ? <Alert severity="error">{cards.error.message}</Alert> : null}
      {rejection ? (
        <Alert severity="warning" sx={{ mb: '1rem' }} role="status">
          Ruch zablokowany przez regułę „{ruleLabel(rejection.rule)}”.
        </Alert>
      ) : null}

      <Stack direction="row" useFlexGap sx={{ gap: '1rem', alignItems: 'flex-start' }}>
        {columns.map((column, columnIndex) => {
          const limit = teamBoardSelectors.wipLimit(column);
          const occupancy = teamBoardSelectors.occupancy(board, column);
          const over = limit !== undefined && occupancy >= limit;
          return (
            <Paper
              key={column}
              component="section"
              variant="outlined"
              aria-label={COLUMN_LABELS[column]}
              sx={{ flex: 1, p: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}
            >
              <Stack direction="row" useFlexGap sx={{ alignItems: 'baseline', columnGap: '0.5rem' }}>
                <Typography variant="overline" component="h2">
                  {COLUMN_LABELS[column]}
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Typography
                  variant="caption"
                  color={over ? 'error' : 'text.secondary'}
                  aria-label={`${COLUMN_LABELS[column]}: praca w toku ${occupancy}${limit === undefined ? '' : ` z ${limit}`}`}
                  sx={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {limit === undefined ? occupancy : `${occupancy}/${limit}`}
                </Typography>
              </Stack>
              <Stack useFlexGap sx={{ gap: '0.5rem' }}>
                {grouped[column].map((card) => (
                  <CardRow
                    key={card.id}
                    card={card}
                    columnName={column}
                    leftColumn={columns[columnIndex - 1]}
                    rightColumn={columns[columnIndex + 1]}
                    board={board}
                  />
                ))}
              </Stack>
              {column === TEAM_BOARD_ENTRY_COLUMN ? <AddCardForm column={column} /> : null}
            </Paper>
          );
        })}
      </Stack>
    </Container>
  );
};

const MoveButton = ({
  card,
  columnName,
  toColumn,
  direction,
  board,
}: {
  card: TeamCard;
  columnName: TeamColumn;
  toColumn: TeamColumn | undefined;
  direction: '◀' | '▶';
  board: readonly Card[];
}) => {
  if (toColumn === undefined) {
    return (
      <Button size="small" disabled aria-hidden>
        {direction}
      </Button>
    );
  }
  const verdict: MoveVerdict = teamBoardSelectors.verdict(board, card.id, toColumn);
  const blocked = !verdict.allowed;
  const reason = verdict.allowed ? undefined : verdict.rule;
  // A pending card's id/column are not yet server-confirmed: a move fired now
  // targets an id the server may not know (404) or a stale column (rule
  // rejection), then rolls back. The seam refuses moves until the op settles.
  const saving = !blocked && card.pending;
  const label = blocked
    ? `Przenieś ${card.title} do kolumny ${COLUMN_LABELS[toColumn]} (zablokowane: ${ruleLabel(reason ?? '')})`
    : saving
      ? `Przenieś ${card.title} do kolumny ${COLUMN_LABELS[toColumn]} (zapisywanie)`
      : `Przenieś ${card.title} do kolumny ${COLUMN_LABELS[toColumn]}`;
  const button = (
    <Button
      size="small"
      aria-label={label}
      disabled={blocked || saving}
      onClick={() =>
        send({
          type: 'cardMoveRequested',
          cardId: card.id,
          fromColumn: columnName,
          toColumn,
          board,
        })
      }
    >
      {direction} {COLUMN_LABELS[toColumn]}
    </Button>
  );
  return blocked ? (
    <Tooltip title={`zablokowane: ${ruleLabel(reason ?? '')}`}>
      <Box component="span">{button}</Box>
    </Tooltip>
  ) : (
    button
  );
};

const CardRow = ({
  card,
  columnName,
  leftColumn,
  rightColumn,
  board,
}: {
  card: TeamCard;
  columnName: TeamColumn;
  leftColumn: TeamColumn | undefined;
  rightColumn: TeamColumn | undefined;
  board: readonly Card[];
}) => {
  const leftVerdict = leftColumn === undefined ? undefined : teamBoardSelectors.verdict(board, card.id, leftColumn);
  const rightVerdict =
    rightColumn === undefined ? undefined : teamBoardSelectors.verdict(board, card.id, rightColumn);
  const blockedReasons = [leftVerdict, rightVerdict].flatMap((verdict) =>
    verdict === undefined || verdict.allowed ? [] : [verdict.rule],
  );
  return (
    <Paper
      variant="outlined"
      elevation={0}
      aria-busy={card.pending}
      sx={{ p: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}
    >
      <Typography>{card.title}</Typography>
      <Stack direction="row" useFlexGap sx={{ gap: '0.25rem' }}>
        <MoveButton card={card} columnName={columnName} toColumn={leftColumn} direction="◀" board={board} />
        <Box sx={{ flex: 1 }} />
        <MoveButton card={card} columnName={columnName} toColumn={rightColumn} direction="▶" board={board} />
      </Stack>
      {blockedReasons.length > 0 ? (
        <Typography variant="caption" color="text.secondary">
          zablokowane: {Array.from(new Set(blockedReasons)).map(ruleLabel).join(', ')}
        </Typography>
      ) : null}
    </Paper>
  );
};

const AddCardForm = ({ column }: { column: TeamColumn }) => {
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
        placeholder="Nowa karta…"
        inputProps={{ 'aria-label': `Nowa karta w kolumnie ${COLUMN_LABELS[column]}` }}
        sx={{ flex: 1, '& input': { p: '0.4rem 0.6rem' } }}
      />
      <Button type="submit" size="small" variant="contained">
        Dodaj
      </Button>
    </Paper>
  );
};
