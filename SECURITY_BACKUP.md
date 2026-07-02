# Security And Backup Notes

This project is a public, browser-only archive. Users write directly to Firestore from `index.html`, and image/GIF files are uploaded to Firebase Storage.

## Current Backup Command

Run this from the repository root:

```bash
npm run backup
```

The script creates:

```text
backups/<date>/evidences.json
backups/<date>/manifest.json
backups/<date>/images/
```

`backups/` is ignored by Git so private backup files are not pushed to GitHub.

If the script says `Firestore quota exceeded`, Firebase/Google Cloud read quota is exhausted. Wait for quota reset or enable billing with a budget cap before trying again.

## Owner Checklist

Do these in order.

1. In Firebase Console, open Firestore Database > Rules.
2. Copy the contents of `firestore.rules` into the rules editor.
3. Click Publish.
4. Open Firebase/Google Cloud usage or quotas and check whether Firestore reads are exhausted.
5. If quota is exhausted, wait for the free quota reset or enable Blaze only after setting budget alerts.
6. After quota is available again, run:

```bash
npm run backup
```

7. Confirm that a new `backups/<date>/manifest.json` and `backups/<date>/evidences.json` exist.

If Firebase CLI is installed and logged in, rules can also be deployed with:

```bash
firebase deploy --only firestore:rules
```

## What Is Backed Up

- Firestore post documents from `artifacts/k-voting/public/data/evidences`
- Active and soft-deleted documents
- Image/GIF URLs listed in each post's `images` or legacy `image` field

Video/SNS links are saved in `evidences.json`, but external videos from YouTube/X/Threads are not downloaded.

## Restore Log

- 2026-07-02: Restored 136 legacy Cloudinary image files from local backups to Firebase Storage and replaced the affected Firestore image URLs. Verification afterwards found 0 remaining Cloudinary URLs and 0 broken image URLs.

## Current Safety Improvements

- Firestore `delete` is denied in `firestore.rules`.
- The site now uses soft delete: deleted posts are marked with `deleted: true` and hidden from the UI.
- New posts must include a valid 64-character password hash.
- Public updates are broad enough to support browser-side post edit/delete and comment deletion while preserving document IDs and password hashes.
- Public writes to category count stats are denied.
- Firebase Storage uploads are capped at 25MB and cannot overwrite existing files.

## Remaining Risks

These are not fully solved while the site is a browser-only public app:

- A determined attacker can still send direct Firestore update requests within the public rules. Browser-side post/comment password checks are not a trusted server-side boundary.
- The plaintext admin password is no longer in frontend source code, but the frontend still exposes a verifier hash and should not be treated as real security.
- Post password checks happen in the browser, not on a trusted server.
- Firebase Storage public uploads can still be abused without App Check, server-side rate limits, or authenticated upload mediation.

## Recommended Next Steps

1. Enable a budget alert/limit in Google Cloud before turning on paid Firebase features.
2. Use Firebase scheduled export to Cloud Storage for managed Firestore backups if Blaze billing is enabled.
3. Keep running the local backup script or enable managed Firebase backups.
4. Move admin/delete/edit operations to Firebase Auth plus Cloud Functions.
5. Keep CAPTCHA off unless abuse becomes severe; prefer rate limits and server-side checks first.
