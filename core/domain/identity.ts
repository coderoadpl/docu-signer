import { z } from 'zod';

export const staffRoleSchema = z.enum(['owner', 'admin']);

export type StaffRole = z.infer<typeof staffRoleSchema>;

export interface Identity {
  userId: string;
  email: string;
  name: string;
  tenantId: string | null;
  tenantSlug: string | null;
  tenantName: string | null;
  staffRole: StaffRole | null;
  memberId: string | null;
}
