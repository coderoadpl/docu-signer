import pg from 'pg';

const QUIESCENCE_POLL_INTERVAL_MS = 50;
const QUIESCENCE_TIMEOUT_MS = 10_000;

type DropIntegrationDatabaseOptions = {
  pool: pg.Pool;
  adminDatabaseUrl: string;
  databaseName: string;
};

export const closePoolAndDropIntegrationDatabase = async ({
  pool,
  adminDatabaseUrl,
  databaseName,
}: DropIntegrationDatabaseOptions): Promise<void> => {
  await pool.end();

  const admin = new pg.Client({ connectionString: adminDatabaseUrl });
  await admin.connect();
  try {
    // WHY: pool.end() resolves before client sockets finish closing, so the server must report zero backends before a FORCE drop can avoid 57P01 on a half-closed client.
    const deadline = Date.now() + QUIESCENCE_TIMEOUT_MS;
    let backendCount = -1;
    while (backendCount !== 0) {
      const result = await admin.query<{ backendCount: number }>(
        'SELECT count(*)::int AS "backendCount" FROM pg_stat_activity WHERE datname = $1',
        [databaseName],
      );
      backendCount = result.rows[0]?.backendCount ?? -1;
      if (backendCount !== 0 && Date.now() >= deadline) {
        throw new Error(
          `Timed out after ${QUIESCENCE_TIMEOUT_MS}ms waiting for PostgreSQL backends to leave integration database "${databaseName}" (remaining: ${backendCount}); refusing to drop it`,
        );
      }
      if (backendCount !== 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, QUIESCENCE_POLL_INTERVAL_MS);
        });
      }
    }

    await admin.query(
      `DROP DATABASE IF EXISTS ${pg.escapeIdentifier(databaseName)} WITH (FORCE)`,
    );
  } finally {
    await admin.end();
  }
};
