import { z } from 'zod';

export const userPreferenceKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9._:-]+$/u);

export const userPreferenceValueSchema = z.json();

export type UserPreferenceValue = z.infer<typeof userPreferenceValueSchema>;

export const userPreferenceSchema = z.object({
  userId: z.string().min(1),
  key: userPreferenceKeySchema,
  value: userPreferenceValueSchema,
  updatedAt: z.iso.datetime(),
});

export type UserPreference = z.infer<typeof userPreferenceSchema>;

export const setUserPreferenceSchema = z.object({
  value: userPreferenceValueSchema,
});

export type SetUserPreference = z.input<typeof setUserPreferenceSchema>;
