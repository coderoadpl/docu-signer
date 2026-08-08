# PostgreSQL backup and disaster recovery

This package runs on the owner's k3s VPS. It does not run in GitHub Actions and no production credential belongs in GitHub, this repository, a shell command, or shell history.

The CronJob connects directly to the production Neon database once per hour with PostgreSQL 16 `pg_dump`. It streams a custom-format dump into GPG AES-256 symmetric encryption, writes it atomically to a k3s `local-path` PVC, and uploads that same encrypted file and a SHA-256 sidecar to an S3-compatible bucket with rclone. A run is successful only after both the local artifact and the offsite copy succeed.

Validation is end to end: the artifact is decrypted again and its catalog read with `pg_restore --list` before it is published. That check needs a transient plaintext copy, which is written to the backup container's private `emptyDir` and deleted immediately — never to the PVC, never to the volume shared with the upload container, and never offsite. Only the encrypted `.dump.gpg` and its checksum leave the node.

Local encrypted backups are retained for 14 days (`RETENTION_DAYS` in `cronjob.yaml`). Rotation runs as soon as the local artifact is final, before the run waits on the upload, so a prolonged offsite outage cannot fill the PVC with an unbounded backlog. Offsite lifecycle and retention are owned by the bucket and should keep at least 35 days with object versioning or object lock when the provider supports it. The bucket must be in a failure domain independent of the VPS and Neon.

The cold standby is the repository's Docker self-host stack: Node, PostgreSQL 16, and Caddy — the `docker-compose.prod.yml` target described in [the self-host section of `demo/README.md`](../../README.md). During an incident, restore a dump into its local PostgreSQL service, verify it, start the application, and flip low-TTL DNS to the VPS.

The operating target is a roughly one-hour RPO and a 30–60 minute RTO, and both numbers only hold under stated conditions. The RPO is the age of the newest *successful* run, so the honest worst case is one schedule interval plus one dump duration — and everything written after it is lost unless Neon itself survives and Neon PITR can be used instead. The RTO assumes the standby VPS already holds the production commit **and a pre-built application image**; a cold `docker compose build` on an unprepared host adds several minutes and breaks the budget below. Measure both in the quarterly drill rather than trusting the table.

## Files

- `namespace.yaml` creates the isolated namespace.
- `secret.template.yaml` documents required Secret keys and contains placeholders only.
- `pvc.yaml` requests 20 GiB from k3s `local-path`.
- `cronjob.yaml` installs the hourly backup.
- `restore.sh` replaces the cold standby database from an encrypted dump.

## Prerequisites

- A Kubernetes 1.27-or-newer k3s cluster on the owner's VPS and `kubectl` configured for it.
- The k3s `local-path` StorageClass.
- Network egress from the namespace to Neon and the S3 endpoint.
- An existing private S3-compatible bucket and credentials restricted to that bucket and prefix.
- A direct, non-pooled production Neon connection string with read access sufficient for `pg_dump`.
- OpenSSL on the owner-controlled machine used to generate the key.
- Docker with Compose v2, GPG, `sha256sum`, and the repository checkout on the cold-standby VPS.
- Enough PVC and offsite capacity for the selected retention, plus node ephemeral storage for one decrypted copy of an artifact — the verification step decrypts into the pod's `emptyDir`.

The manifests run `postgres:16-bookworm` and `rclone/rclone:1.71.0`. Confirm both tags resolve on the VPS before the first run and raise them to the current PostgreSQL 16.x and rclone 1.x builds if they do not; the only hard constraint is that `pg_dump` stays major version 16, matching the self-host stack's `postgres:16`.

The default 20 GiB PVC holds 14 days of hourly artifacts only while each encrypted dump stays under roughly 60 MiB. Read the real artifact size after the first run and either grow the PVC or shorten `RETENTION_DAYS` before the window closes.

PostgreSQL extensions used by production must also exist in the cold-standby PostgreSQL image. Test this quarterly rather than discovering an extension mismatch during an incident.

## Create and protect the key

Generate the symmetric encryption key on an owner-controlled machine:

```bash
umask 077
openssl rand -base64 48 > /root/agentproofarch-backup-passphrase
chmod 600 /root/agentproofarch-backup-passphrase
```

Store a second copy in the owner's password manager or offline recovery vault. Loss of both copies makes every backup unrecoverable. Rotating this key requires retaining the old key until every backup encrypted with it has expired.

## Install

Run these commands from this directory on the k3s VPS:

```bash
kubectl apply -f namespace.yaml
install -m 600 /dev/null /root/agentproofarch-backup.env
```

Open `/root/agentproofarch-backup.env` in a local editor and enter exactly these keys:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@NEON_HOST/DATABASE?sslmode=require
S3_PROVIDER=Other
S3_ENDPOINT=https://S3_ENDPOINT
S3_REGION=REGION
S3_ACCESS_KEY_ID=ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY=SECRET_ACCESS_KEY
S3_BUCKET=BUCKET
S3_PREFIX=agentproofarch/production
```

Use Neon's direct endpoint rather than its pooled endpoint. Keep Neon at a server version PostgreSQL 16 `pg_dump` can read until this package and the self-host stack are upgraded together. Use the rclone S3 provider name required by the service, such as `AWS`, `Cloudflare`, `Minio`, or `Other`. Keep the prefix free of a leading slash. `secret.template.yaml` is a reference template; never apply it without replacing every placeholder, and never commit a populated copy.

Create the Secret without putting values on a command line:

```bash
kubectl create secret generic agentproofarch-backup-secrets \
  --namespace agentproofarch-backup \
  --from-env-file=/root/agentproofarch-backup.env \
  --from-file=backup-passphrase=/root/agentproofarch-backup-passphrase \
  --dry-run=client \
  --output yaml |
  kubectl apply -f -
kubectl apply -f pvc.yaml
kubectl apply -f cronjob.yaml
kubectl get cronjob,pvc -n agentproofarch-backup
```

Keep the root-owned source files off shared or agent-accessible machines. The Secret is the live k3s copy; the independently stored encryption key is part of DR.

To change the local retention or PVC size, edit the manifest before installation. Reducing an existing PVC is not supported. Ensure the bucket lifecycle is configured independently because the CronJob never deletes offsite objects.

## First-run verification

Start one job immediately:

```bash
job="agentproofarch-backup-manual-$(date -u +%Y%m%d%H%M%S)"
kubectl create job \
  --namespace agentproofarch-backup \
  --from=cronjob/agentproofarch-postgres-backup \
  "$job"
kubectl wait \
  --namespace agentproofarch-backup \
  --for=condition=complete \
  --timeout=45m \
  "job/$job"
kubectl logs --namespace agentproofarch-backup "job/$job" --container backup
kubectl logs --namespace agentproofarch-backup "job/$job" --container upload
```

Both logs must name the same `.dump.gpg` artifact, and the job must complete. Confirm that the artifact and its `.sha256` sidecar exist in the bucket. Confirm the CronJob's next schedule:

```bash
kubectl get cronjob agentproofarch-postgres-backup \
  --namespace agentproofarch-backup
kubectl get jobs \
  --namespace agentproofarch-backup \
  --sort-by=.metadata.creationTimestamp
```

Finish installation only after downloading the first offsite object to an isolated location and completing the restore drill below. A successful upload alone does not prove recoverability.

## Routine monitoring

Alert when no successful Job has completed for two hours, when a Job fails, when PVC use exceeds 80%, or when the bucket rejects uploads. Kubernetes retains only a small Job history, so ship Job status and container logs to the owner's monitoring system.

After changing the Neon URL, S3 credentials, endpoint, bucket, or encryption key, update the Secret with the same `kubectl create secret ... --dry-run=client | kubectl apply -f -` flow and run an immediate verification job.

## Restore drill

Use an isolated VPS or an isolated Compose project. Check out the exact production commit when possible. Do not point the drill at production DNS.

Prepare the stack first, from the repository's `demo/` directory, following [the self-host section of `demo/README.md`](../../README.md). Building the image up front is what keeps the measured RTO honest — a build during an incident is not part of the budget:

```bash
cp .env.example .env    # fresh BETTER_AUTH_SECRET, local Postgres credentials,
                        # base URL, domain and Caddy settings — never production values
docker compose -f docker-compose.prod.yml build app
```

Download one `.dump.gpg` object and its `.sha256` sidecar from offsite storage into a root-only directory. Give the sidecar the exact name `<dump>.sha256`. Then run from this directory:

```bash
PASSPHRASE_FILE=/root/agentproofarch-backup-passphrase \
RESTORE_CONFIRM=restore-agentproofarch \
./restore.sh /root/restore/agentproofarch-YYYYMMDDTHHMMSSZ.dump.gpg
```

The script defaults `COMPOSE_DIR` to the repository's `demo/` directory and `COMPOSE_FILE` to `docker-compose.prod.yml`; override them only for an isolated Compose project. It requires and verifies the sidecar, fully authenticates the encrypted dump into root-only temporary space, checks the dump catalog before destructive work, requires PostgreSQL client major 16, stops the app and Caddy, replaces the Compose database, restores without production ownership or grants, analyzes it, removes the plaintext temporary copy, and leaves public services stopped. Set `TMPDIR` to a root-only filesystem with enough free space for the decrypted dump when `/tmp` is too small.

Start and verify the application. The entrypoint runs migrations on startup and finds the restored schema already at the current revision:

```bash
cd ../..
docker compose -f docker-compose.prod.yml up -d app
curl --fail --silent --show-error http://127.0.0.1:47100/api/health/live
curl --fail --silent --show-error http://127.0.0.1:47100/api/health/ready
docker compose -f docker-compose.prod.yml logs --tail=100 app
```

Run the repository's remote smoke flow against the isolated endpoint if it is reachable under a drill-only hostname. Verify a known tenant, user, and recent record without exposing their contents in logs. Start Caddy only after its DNS and `APP_BASE_URL` settings are correct:

```bash
docker compose -f docker-compose.prod.yml --profile edge up -d caddy
```

Record the selected artifact timestamp, restore start and finish times, application-ready time, dump age, row-count checks, and any manual intervention. Destroy or securely erase drill data after recording non-sensitive results.

## Cold-standby failover

Keep the Docker self-host configuration prepared on the owner's VPS, but do not run the app publicly until failover. "Prepared" means the production commit is checked out, `.env` is filled in with standby-only values, and `docker compose -f docker-compose.prod.yml build app` has already produced the image — the RTO budget below assumes all three. Set the production DNS TTL to 300 seconds or lower during normal operations; lowering it after an outage does not expire already cached records.

Use this incident sequence:

1. Declare the incident, freeze production releases and writes where possible, and record the start time.
2. Decide whether Neon PITR or the latest successful offsite dump gives the best safe recovery point. Record the chosen recovery timestamp and expected data-loss window.
3. Confirm the VPS is on the production commit with a built image and a configured `.env`; rebuild only if it drifted. Use a standby-only auth secret held by the owner; never copy production credentials through GitHub.
4. Download the chosen encrypted dump and sidecar from offsite storage. Verify their timestamps and permissions.
5. Run `restore.sh`. Keep the application and Caddy stopped after it finishes.
6. Start the app, run liveness, readiness, login, tenant-routing, and critical-data checks over the VPS address or a hosts-file override.
7. Start Caddy and confirm the internal domain-check path remains network-internal.
8. Change the production A/AAAA or CNAME record to the VPS. Remove stale address families that do not route to the VPS.
9. Watch authoritative DNS, public resolution, TLS issuance, error rate, and login from an external network until the low TTL has elapsed.
10. Announce recovery with the restore point, estimated data loss, and observed RTO. Keep releases frozen until backup and monitoring are healthy on the standby.

Suggested RTO budget:

| Window | Outcome |
|---|---|
| 0–10 min | Incident declared, restore point selected, DNS owner ready |
| 10–30 min | Dump downloaded, decrypted, restored, and analyzed |
| 30–45 min | App, tenant routing, auth, and critical data verified |
| 45–60 min | DNS flipped, TLS and external checks green |

Do not overwrite or delete the incident dump, source sidecar, old DNS values, or Neon recovery points until the owner explicitly closes the incident. Failback is a separate migration: quiesce writes, take a fresh backup from the active VPS database, restore into a new managed target, verify, then flip DNS under another change window.

## Quarterly failover-test checklist

- [ ] Name an owner, test window, rollback decision-maker, and communications channel.
- [ ] Confirm production DNS TTL is 300 seconds or lower at least one old-TTL interval before the test.
- [ ] Confirm the latest successful Kubernetes Job is less than two hours old.
- [ ] Confirm local PVC rotation leaves the expected 14-day encrypted window and free space remains above 20%.
- [ ] Confirm the standby VPS still holds the production commit and a pre-built application image.
- [ ] Confirm offsite lifecycle, versioning or object lock, access logging, and credential expiry.
- [ ] Select a random offsite backup from the quarter rather than the newest object.
- [ ] Recover the encryption key from the independent password manager or offline vault.
- [ ] Verify the SHA-256 sidecar, decrypt, list the dump, and restore it into an isolated PostgreSQL 16 Compose stack.
- [ ] Verify required PostgreSQL extensions, schema migration startup, liveness, readiness, authentication, tenant routing, and representative recent data.
- [ ] Measure achieved RPO from artifact time and RTO from declaration to external readiness.
- [ ] Exercise the DNS change and rollback on a drill hostname, or perform an approved production failover and failback window.
- [ ] Verify Caddy obtains TLS only for a verified tenant domain and the internal check is not publicly reachable.
- [ ] Confirm a new backup succeeds after the restored stack is active.
- [ ] Restore original DNS, stop public standby services, and securely erase drill data.
- [ ] Record evidence, timings, gaps, owners, and due dates; treat any failed restore or missed hourly backup as an incident.
