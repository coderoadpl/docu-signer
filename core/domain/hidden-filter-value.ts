import { z } from 'zod';

export const hiddenFilterKindSchema = z.enum(['person', 'tag']);

export type HiddenFilterKind = z.infer<typeof hiddenFilterKindSchema>;

export const hiddenFilterValueTextSchema = z.string().trim().min(1).max(200);

export const hiddenFilterValueSchema = z.object({
  id: z.uuid(),
  tenantId: z.string().min(1),
  kind: hiddenFilterKindSchema,
  value: hiddenFilterValueTextSchema,
});

export interface HiddenFilterValue {
  id: string;
  tenantId: string;
  kind: HiddenFilterKind;
  value: string;
}

export const hiddenFilterValueRefSchema = z.object({
  kind: hiddenFilterKindSchema,
  value: hiddenFilterValueTextSchema,
});

export type HiddenFilterValueRef = z.infer<typeof hiddenFilterValueRefSchema>;
