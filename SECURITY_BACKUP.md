# Security And Backup Notes

The static frontend reads public Firestore documents. All writes use the Firebase callable `archiveApi` in `asia-northeast3`. The existing administrator password screen is preserved; password verification now happens on the server.

## Access control

- Firestore denies every direct browser write, including post changes and category counts. Private collections are not readable by clients.
- Post/comment verifiers are in `_archivePostSecrets`; the administrator verifier is in `_archiveAdmin/config`. New passwords use salted scrypt. Legacy SHA-256 verifiers accept the original password and are never accepted as bearer credentials.
- Administrator login creates a random, one-hour session bound to the anonymous Firebase user. Its token stays in browser memory. Changing a frontend variable cannot grant server authority.
- Comments use stable IDs. Comments, votes and category counters are updated by server transactions.
- Likes are limited per anonymous Firebase identity. Clearing browser data can create a new identity; this is not proof of a unique person.
- Storage uploads need anonymous authentication and a 15-minute grant for specific filenames. The server checks the post password before granting uploads to an existing post. Size/MIME/no-overwrite restrictions remain enforced by Storage rules.
- API limits are checked by both network address and UID. App Check is not currently enabled.

## Deployment and verification

```powershell
npm ci --prefix functions
npm test --prefix functions
node scripts/check-ui.mjs
firebase deploy --only functions:archive,firestore:rules,storage --project k-voting
```

On first deployment, allow the Firebase CLI to configure the cross-service
Storage role (`roles/firebaserules.firestoreServiceAgent`). Non-interactive
deployment skips this setup; the Storage service account must have the role
before upload grants can be read. Allow time for IAM propagation.

`node scripts/check-security-live.mjs --run` explicitly creates a temporary
feedback post and image to test the deployed API and rules, then removes them.
The 2026-10-14 deployment passed 11 live checks, including direct-write denial,
private-verifier read denial, password checks, duplicate likes, authorized image
upload and overwrite denial. A browser check also verified the actual SDK upload
flow. All 239 original posts and 21 comments were preserved without content changes.

The existing billed project is used. The function has zero minimum instances, a maximum of three instances, and a 60-second timeout. Container artifact cleanup is enabled during deployment. Budget alerts do not constitute a hard spending cap.

## Backups

`npm run backup` saves public post metadata and images to ignored `backups/<date>/`. Video/SNS links are retained, but remote videos are not downloaded.

Private password verifiers require a separate operator-authenticated backup:

```powershell
node scripts/backup-security.mjs
```

This reuses the local Firebase CLI login and saves only under ignored `backups/`. Preserve these backups securely; do not publish or commit them. Anonymous sessions, transient upload grants and rate counters do not need to be restored.

## Migration

`node scripts/migrate-security.mjs` creates a read-only metadata backup and prints a summary. `--apply` requires direct public writes to be closed first. It moves existing verifiers, assigns stable comment IDs, removes public verifier fields and recalculates counts. Initial administrator migration reads `ARCHIVE_LEGACY_ADMIN_HASH` from the process environment. Subsequent runs keep existing private verifiers.

Do not roll back to public write rules. Restore post metadata and private verifiers with operator credentials if needed. `npm run rebuild-counts` also requires the operator login.

## Remaining limitations

Previously exposed legacy hashes may exist in old caches or Git history. Removing them from the current public documents cannot retract old copies. New passwords are salted and future successful author edits upgrade legacy post verifiers. The administrator password remains unchanged as requested.

Anonymous identities and rate limits reduce abuse but cannot prevent every spam or storage-abuse attempt. App Check and monitored usage limits remain possible future improvements.

## Restore log

- 2026-07-02: Restored 136 legacy Cloudinary images to Firebase Storage; verified zero remaining Cloudinary URLs and zero broken image URLs.
- 2026-10-14: Backed up 239 posts (226 active) and 21 comments before the server-side security migration. Images are unchanged by this migration.


## Private admin draft workflow

The admin workspace uses the same server-verified, one-hour password session.
`_archiveDrafts` is denied by the existing catch-all Firestore rules and is only
read/written through admin callable actions or the operator's IAM credentials.
`reviewNotes` never becomes public post content. Version checks reject stale
changes; transactional publication and deterministic post IDs prevent duplicates.
`node scripts/backup-security.mjs` now includes `_archiveDrafts`.

Agents use `scripts/agent-drafts.mjs` with existing operator IAM to list and save
private drafts directly, without an exchange file. The helper shares the backend
content whitelist and version checks and exposes no publication function.
Alternatively, the authenticated AI workspace provides a direct editor.
Only an explicit publication request authorizes publishing. Humans use the normal
post editor. Published drafts remain as history; subsequent edits use the post
editor. The workspace currently shows the latest 100 drafts/publications.
