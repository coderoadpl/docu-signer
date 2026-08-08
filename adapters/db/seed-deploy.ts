import { deploySeedEnvSchema } from '#core/server/config.js';

import { createStandaloneDb } from './client.js';
import { configuredSeedAdmins, ensureSeedAdmins } from './seed-admins.js';

const env = deploySeedEnvSchema.parse(process.env);
const admins = configuredSeedAdmins(env);

if (admins.length === 0) {
  console.log('Deploy seed skipped: SEED_ADMIN1_EMAIL and SEED_ADMIN1_PASSWORD are not set.');
} else {
  const connection = createStandaloneDb(env.DB_DRIVER, env.DATABASE_URL);
  try {
    const results = await ensureSeedAdmins(connection.db, admins);
    for (const result of results) {
      console.log(`Deploy seed: ${result.email} (${result.role}) ${result.status}`);
    }
  } finally {
    await connection.close();
  }
}
