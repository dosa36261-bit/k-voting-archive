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
