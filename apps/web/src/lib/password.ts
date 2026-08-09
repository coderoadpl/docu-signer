import { z } from 'zod';

export const passwordSchema = z.string().min(8, 'Hasło musi mieć co najmniej 8 znaków');
