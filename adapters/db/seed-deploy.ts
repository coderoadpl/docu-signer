import { deploySeedEnvSchema } from '#core/server/config.js';

import { createStandaloneDb } from './client.js';
import { configuredSeedAdmins, ensureDeploySeed } from './seed-admins.js';

const env = deploySeedEnvSchema.parse(process.env);
const admins = configuredSeedAdmins(env);

if (admins.length === 0) {
  console.log('Deploy seed skipped: SEED_ADMIN1_EMAIL and SEED_ADMIN1_PASSWORD are not set.');
} else {
  const connection = createStandaloneDb(env.DB_DRIVER, env.DATABASE_URL);
  try {
    const result = await ensureDeploySeed(connection.db, admins, env.APP_BASE_DOMAIN);
    for (const admin of result.admins) {
      console.log(`Deploy seed: ${admin.email} (${admin.role}) ${admin.status}`);
    }
    if (result.domain) {
      console.log(`Deploy seed domain: ${result.domain.domain} ${result.domain.status}`);
    } else {
      console.log('Deploy seed domain skipped: APP_BASE_DOMAIN is not set.');
    }
  } finally {
    await connection.close();
  }
}
