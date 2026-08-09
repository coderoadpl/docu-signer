import { err, notFound, type AppError, type Result } from '#core/domain/index.js';

import type { BackfillPort } from '../ports.js';

export interface BackfillProgress {
  readonly name: string;
  readonly processed: number;
  readonly done: boolean;
}

export const backfillNames = (): string[] => [];

export const runBackfillBatch = async (
  name: string,
  limit: number,
  deps: { backfills: BackfillPort },
): Promise<Result<BackfillProgress, AppError>> => {
  void limit;
  void deps;
  return err(notFound(`No backfill named "${name}"`));
};
