# Nightly backup runbook

The nightly backup cron runs from the private `docu-signer--backup` repository,
whose workflow checks out this repo and runs `scripts/backup.ts` at `01:17 UTC`
every day and can also be dispatched manually. That is 03:17 in Warsaw during
summer time and 02:17 during winter time. An unconfigured repository skips the
job cleanly. Configured failures remain red so GitHub notifications can alert
the owner.

The job writes a full, self-contained ZIP to the dedicated CodeRoad Shared
Drive folder. It downloads the newest valid prior ZIP from Drive as a local
mirror, then downloads only new or changed private Vercel Blobs. If no prior ZIP
is valid, the log explicitly announces a full Blob download. A new archive is
verified in Drive before retention moves older copies to Trash. Retention keeps
seven distinct daily copies and one representative from each of the four most
recent UTC weeks, preferring Sunday.

The same folder contains `docu-signer-backup-transfer-ledger.json`. Before any
Blob body is downloaded, the job reserves that run's planned bytes in this
small ledger and reads the reservation back. A failed run therefore consumes
its reservation instead of silently losing transfer accounting; successful
month-to-date usage is also recorded inside `backup.json` and the ZIP's Drive
metadata. Do not edit or delete the ledger during a month.

## Archive contents

- `database.sql`: plain
  `pg_dump --format=plain --no-owner --no-acl --exclude-schema=neon_auth`
  output from the direct, unpooled Neon connection. The platform-provisioned
  `neon_auth` schema is deliberately absent from every dump: the application
  never writes it, and the read-only backup role cannot lock its tables.
- `blobs/<pathname>`: every private Vercel Blob at its exact logical pathname.
- `blobs-manifest.json`: pathname, ETag, size, content type, and SHA-256 for each
  Blob.
- `INDEX.txt`: human-readable document-to-file-to-`blobs/<pathname>` listing,
  with Blob objects missing from `document_files.storage_key` under `ORPHANS`.
- `backup.json`: format and source metadata plus per-run and month-to-date Blob
  download bytes.
- `SHA256SUMS`: SHA-256 for every other file in the archive.
- `RESTORE.txt`: the concise restore checklist bundled with the data.

## Owner setup checklist

1. In Google Cloud Console, select or create a small CodeRoad project. Open
   **APIs & Services → Library**, find **Google Drive API**, and click
   **Enable**.
2. Open **IAM & Admin → Service Accounts → Create service account**. Create a
   dedicated backup identity, open it, choose **Keys → Add key → Create new
   key → JSON**, and save the one downloaded JSON key securely.
3. In Google Drive while signed in to CodeRoad, open **Shared drives → New** and
   create `Docu Signer Backups`. In **Manage members**, add the service account
   email from the JSON as **Content manager**. The Workspace administrator must
   allow Shared Drives and, when Google classifies the service account as
   external, external members. Use **Manager** only if permanent deletion rather
   than normal Trash retention is deliberately required.
4. Inside that Shared Drive, create the folder `docu-signer`. Open it and copy
   the folder ID from the URL segment after `/folders/`.
5. In Neon Console, open the production project and click **Connect**. Turn
   **Connection pooling** off and copy the direct connection string. Confirm its
   hostname does not contain `-pooler`.
6. In GitHub open the private `docu-signer--backup` repository's
   **Settings → Secrets and variables → Actions**. Create these
   repository secrets:
   - `NEON_DATABASE_URL_UNPOOLED`: the direct Neon production URL.
   - `BLOB_READ_WRITE_TOKEN`: the credential for the private production Blob
     store.
   - `GOOGLE_SERVICE_ACCOUNT_JSON`: the complete downloaded JSON key, including
     its private-key line breaks.
7. On the **Variables** tab create `GOOGLE_DRIVE_FOLDER_ID` with the folder ID
   from step 4. The workflow also accepts a repository secret with that name,
   but a variable is preferred because the ID is not a credential.
8. In that repository's **Actions → backup → Run workflow**, dispatch the first
   run. Confirm the
   log says the upload was verified, then inspect the ZIP in the Shared Drive.
   Enable GitHub Actions failure notifications for the repository owner. Once a
   month, confirm the newest timestamp and test the ZIP checksum listing.

Optional repository variables change the guards:
`BACKUP_BLOB_MONTHLY_DOWNLOAD_LIMIT_BYTES` defaults to 5 GB and
`BACKUP_DATABASE_DAILY_MAX_BYTES` defaults to 100 MB.

## Restore one ZIP

1. Disable application writes. Download one ZIP, unpack it, and from its root
   run `sha256sum --check SHA256SUMS`. Confirm every manifest entry has a matching
   `blobs/<pathname>` file and that the manifest count, byte totals, individual
   sizes, and SHA-256 values match. Stop on any mismatch.
2. Create an empty target Neon database, preferably on the same or a newer
   PostgreSQL major version, and copy its direct/unpooled URL. Restore with:

   ```bash
   psql "$TARGET_DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f database.sql
   ```

3. Create an empty **private** Vercel Blob store. For every entry in
   `blobs-manifest.json`, upload `blobs/<pathname>` with the existing Vercel Blob
   SDK using exactly:
   `put(pathname, stream, { access: 'private', addRandomSuffix: false, contentType, token })`.
   Restoring to an empty store avoids mixing versions; do not overwrite or prune
   a nonempty store without a separately reviewed migration plan.
4. Use `INDEX.txt` to map pathnames back to human documents during triage. Query
   every restored `document_files.storage_key` and confirm that pathname exists
   in the new store with the manifest size and content type. Download and compare
   SHA-256 for every object. Investigate every `ORPHANS` entry before deciding
   whether to re-upload or discard it.
5. Set the deployment's new `DATABASE_URL`, direct database URL, and Blob-store
   token. Deploy, then smoke-test sign-in, document listing, preview, and
   download. Re-enable user access and writes only after all checks pass.

The Blob hostname may change during restore. No database rewrite is needed
because `document_files.storage_key` stores the logical pathname.

## Free-plan guards and paid-tier triggers

- Vercel Hobby includes 1 GB Blob storage, 10 GB monthly Blob transfer, 10,000
  Simple Operations, and 2,000 Advanced Operations. It blocks access instead of
  billing overage. The backup ceiling reserves half of the transfer allowance
  for the application; raise it only after moving to Vercel Pro or reviewing
  actual usage.
- Neon Free includes 0.5 GB database storage and 5 GB monthly public network
  transfer. Daily `pg_dump` is skipped above 100 MiB by default because a full
  dump every day would endanger that allowance. At the warning, change the cron
  to weekly or upgrade to Neon Launch before resuming.
- Upgrade Workspace storage or shorten retention before the Shared Drive's
  pooled storage fills.
- GitHub Free includes 2,000 private-repository Actions minutes per month. This
  job should remain well below that, but sustained growth or a larger runner can
  require paid Actions usage.
