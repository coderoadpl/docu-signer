import { Container, Typography } from '@mui/material';

import { ApiTokenSection } from './ApiTokenSection.js';
import { PasskeySection } from './PasskeySection.js';
import { PasswordSection } from './PasswordSection.js';
import { ProfileSection } from './ProfileSection.js';
import { TwoFactorSection } from './TwoFactorSection.js';
import { TenantSettingsSection } from './TenantSettingsSection.js';
import { InvitationsSection } from './InvitationsSection.js';
import { DocumentTypesSection } from './DocumentTypesSection.js';
import { HiddenFilterValuesSection } from './HiddenFilterValuesSection.js';

export const SettingsPage = () => (
  <Container disableGutters sx={{ maxWidth: '44rem !important', px: '1.25rem', py: '2.5rem' }}>
    <Typography variant="h1" sx={{ mb: '0.5rem' }}>
      Konto
    </Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: '1.5rem' }}>
      Zarządzaj profilem, zabezpieczeniami konta i ustawieniami organizacji.
    </Typography>
    <ProfileSection />
    <TenantSettingsSection />
    <DocumentTypesSection />
    <HiddenFilterValuesSection />
    <InvitationsSection />
    <PasswordSection />
    <TwoFactorSection />
    <PasskeySection />
    <ApiTokenSection />
  </Container>
);
