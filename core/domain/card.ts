import { z } from 'zod';

/**
 * Which board a card belongs to. The substrate is shared by both boards; this
 * discriminator (plus each board's own column set + rules) is what separates
 * them at the use-case boundary. Personal is the default so every pre-existing
 * flow and payload that omits `board` keeps meaning "the personal board".
 */
export const BOARD_IDS = ['personal', 'team'] as const;

export const boardIdSchema = z.enum(BOARD_IDS);

export type BoardId = z.infer<typeof boardIdSchema>;

/**
 * A card is the board-agnostic substrate both boards share. `column` is a plain
 * string here on purpose: the set of legal columns is *data of a board*, not of
 * a card, so the stored shape carries no board's vocabulary and each board
 * reuses this exact type and table. `board` scopes a card to one board;
 * `visited` is the ordered set of columns the card has entered — history the
 * team board's `review-requires-in-dev` guard reads, inert for the personal
 * board. Each board validates `column` against its own set at the use-case
 * boundary; `position` is a contiguous 0-based index within a (board, column)
 * (see the cards use-cases for the index-rewrite repositioning model).
 */
export const cardSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  title: z.string().min(1).max(500),
  board: boardIdSchema,
  column: z.string(),
  position: z.number().int().nonnegative(),
  visited: z.array(z.string()),
  createdAt: z.iso.datetime(),
});

export type Card = z.infer<typeof cardSchema>;

export const newCardSchema = z.object({
  title: z.string().trim().min(1, 'Title must not be empty').max(500, 'Title too long'),
  board: boardIdSchema.default('personal'),
  column: z.string(),
});

/** Input type: `board` is optional at the boundary (defaults to personal). */
export type NewCard = z.input<typeof newCardSchema>;

export const cardMoveSchema = z.object({
  cardId: z.string(),
  board: boardIdSchema.default('personal'),
  toColumn: z.string(),
  toIndex: z.number().int(),
});

/** Input type: `board` is optional at the boundary (defaults to personal). */
export type CardMove = z.input<typeof cardMoveSchema>;

/** The board a list request targets; `board` is optional (defaults to personal). */
export const cardListQuerySchema = z.object({
  board: boardIdSchema.default('personal'),
});

export type CardListQuery = z.input<typeof cardListQuerySchema>;

/**
 * The personal board's column set — free movement, no rules. It lives in
 * `core/domain` (zod-only) because "which columns exist" is a domain fact the
 * server must enforce, not client cosmetics a CLI request could walk past. The
 * team board will add its own set + transition table alongside this one.
 */
export const PERSONAL_BOARD_COLUMNS = ['todo', 'doing', 'done'] as const;

export type PersonalColumn = (typeof PERSONAL_BOARD_COLUMNS)[number];

export const isPersonalColumn = (value: string): value is PersonalColumn =>
  PERSONAL_BOARD_COLUMNS.some((column) => column === value);
