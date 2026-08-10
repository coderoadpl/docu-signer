import {
  err,
  ok,
  updateTenantSettingsSchema,
  validation,
  type AppError,
  type Result,
  type TenantSettings,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { TenantSettingsRepository } from '../ports.js';

export interface TenantSettingsDeps {
  tenantSettings: TenantSettingsRepository;
}

export const DEFAULT_TENANT_SETTINGS = {
  storeSignatureRecords: true,
  pdfSealEnabled: false,
  dateMode: 'declared',
} as const;

export const getTenantSettings = async (
  ctx: Ctx,
  deps: TenantSettingsDeps,
): Promise<Result<TenantSettings, AppError>> => {
  const scope = authorizeTenant(ctx, 'tenant-settings:manage');
  if (!scope.ok) return scope;
  const settings = await deps.tenantSettings.get(scope.value);
  return ok(settings ?? { tenantId: scope.value, ...DEFAULT_TENANT_SETTINGS });
};

export const updateTenantSettings = async (
  ctx: Ctx,
  input: unknown,
  deps: TenantSettingsDeps,
): Promise<Result<TenantSettings, AppError>> => {
  const scope = authorizeTenant(ctx, 'tenant-settings:manage');
  if (!scope.ok) return scope;
  const parsed = updateTenantSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return err(validation('Invalid tenant settings', parsed.error.flatten()));
  }
  const current = await deps.tenantSettings.get(scope.value);
  const base = current ?? { tenantId: scope.value, ...DEFAULT_TENANT_SETTINGS };
  return ok(await deps.tenantSettings.set(scope.value, {
    storeSignatureRecords:
      parsed.data.storeSignatureRecords ?? base.storeSignatureRecords,
    pdfSealEnabled: parsed.data.pdfSealEnabled ?? base.pdfSealEnabled,
    dateMode: parsed.data.dateMode ?? base.dateMode,
  }));
};
