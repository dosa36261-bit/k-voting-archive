# K Voting Archive Handoff

## Site Purpose

This is a public citizen archive for collecting election-related issue reports, images, GIFs, videos, source links, and comments. The site is not intended to represent a political party or ideology; the stated purpose is to preserve records related to election integrity and make them easy to browse, share, and discuss.

Live site:

- https://k-voting.vercel.app/

Repository:

- https://github.com/dosa36261-bit/k-voting-archive

## Project Shape

This is a very small static site:

- `index.html`: UI markup, Firebase client code, Firebase Storage upload code, and app logic.
- `styles.css`: shared UI surfaces, card layout, responsive styles, focus and reduced-motion rules.
- `scripts/check-ui.mjs`: isolated Playwright regression checks; Firebase is removed from the fixture page so it never reads or writes production data. Requires Playwright and Chrome. Run `node scripts/check-ui.mjs`.
- `UI_REVIEW.md`: UI review coverage, verification, and remaining code risks.
- `firestore.rules`: deployed public-read-only rules; all writes use the callable backend.
- `vercel.json`: rewrites all routes to `index.html` so shared links do not show Vercel `Not Found`.
- `QR.png`: QR image shown from the header QR button for public sharing.
- `AGENT.md`: this file.

## Operating Notes For Future Agents

- When the operator asks for code/content changes, make the change, run feasible checks, review the diff, create a git commit, and push that commit to the configured Git remote unless the operator explicitly says not to commit or not to push.
- The operator has granted Git, Firebase, and browser/devtools automation permissions for this project. Use the available local credentials/session and tooling as needed to finish the task end to end.
- Treat GitHub push as part of normal task completion, not a separate optional step. For this repo, push finished work to `origin main` after committing unless the task is intentionally local-only.
- Do not commit unrelated local artifacts such as `node_modules/` unless the operator explicitly asks. If the worktree has unrelated changes, leave them alone and stage only the files needed for the task.
- Keep changes scoped to this static app unless the operator specifically asks for a larger restructure.

Vercel deploys the static frontend directly from GitHub. The trusted write backend is `functions/` (Firebase callable `archiveApi`, Node 22, asia-northeast3). Run `npm ci --prefix functions` and `npm test --prefix functions`. Deploy with `firebase deploy --only functions:archive,firestore:rules,storage --project k-voting`.

## External Services

### Vercel

Vercel hosts the static site. The production branch should be `main`. If GitHub has the latest commit but the live site looks stale, check the Vercel Deployments tab and redeploy the latest commit.

### Firebase Firestore

Firestore stores post metadata and comments.

Current Firestore path:

```text
artifacts/k-voting/public/data/evidences/{evidenceId}
```

Important constants in `index.html`:

```js
const appId = 'k-voting';
const collectionName = 'evidences';
```

Firebase config is embedded in `index.html`. This is normal for Firebase web client config. Real security depends on Firebase rules.

### Firebase Storage

Images and GIFs are uploaded to Firebase Storage.

Current values in `index.html`:

```js
const MAX_IMAGE_FILE_SIZE = 25 * 1024 * 1024;
const MAX_IMAGE_UPLOAD_COUNT = 20;
const MAX_MEDIA_LINK_COUNT = 20;
```

Storage path:

```text
evidence-images/{evidenceId}/{fileName}
```

The site code and `storage.rules` limit uploads to:

- JPEG
- PNG
- GIF
- WEBP
- 25MB max per file
- 20 images/GIFs max per post
- 20 media links max per post

## Data Model

Each post document roughly looks like:

```js
{
  id: "ev-...",
  title: "...",
  category: "shape-memory" | "strange-ballot" | "bad-management" | "nec-admin" | "etc" | "free-board" | "feedback-board",
  images: ["https://firebasestorage.googleapis.com/..."],
  mediaLinks: ["https://x.com/...", "https://youtube.com/..."],
  source: "...",
  desc: "...",
  likes: 0,
  comments: [
    {
      author: "...",
      text: "...",
      id: "stable-comment-uuid",
      isAdmin: false
    }
  ],
  createdAt: "ISO date",
  updatedAt: "ISO date"
}
```

Some older posts may still have older shapes:

- `image` instead of `images`
- no `passwordHash`
- no `mediaLinks`
- old comments without `passwordHash`

The UI has compatibility helpers for these cases. Be careful not to break old data.

The inquiry board uses the same evidence post shape with category `feedback-board`, but it is not counted in the main category counters and is not shown in the main hero.

## Current Feature Summary

- Category browsing.
- Main page has an `all-posts` virtual category for viewing posts from all main categories together.
- Main page hero shows recommended/random posts from top-liked candidates per category.
- Post creation with title, category, password, images/GIFs or video/SNS links, source, and content.
- Image upload by file picker, drag/drop, or Ctrl+V while the writing modal is open.
- Firebase Storage stores image/GIF files.
- YouTube links render as embedded players.
- X/Twitter post links render with the official X/Twitter embed widget when possible.
- X-only posts get a custom X thumbnail card, not a real video frame thumbnail.
- Content URLs are linkified.
- Copied/shared post links use `/?post=ev-...` and old `#post=ev-...` links are still understood. Normal in-site post opening keeps the category URL and uses history state so mobile Back closes the post modal before leaving the category.
- `vercel.json` prevents shared links from showing Vercel `Not Found`.
- Likes are deduplicated transactionally by Firebase anonymous UID, with localStorage for immediate UI feedback. Clearing browser identity can still bypass this; it is not one-person-one-vote.
- Post edit/delete uses the post password; admin can edit/delete without post password.
- Comments use author, text, and comment password. Comments can be deleted by admin or by matching comment password.
- Admin comments are stored with `isAdmin: true` and render as bold `관리자`.
- Old comments without passwords can only be deleted by admin.
- The footer has an independent inquiry board view. Inquiry posts use category `feedback-board` and the normal comment system as replies.
- The header QR button opens `QR.png` with sharing copy.
- Category and post navigation update browser history so mobile back/forward stays inside the app before leaving the page.

## Admin Behavior

The existing password modal sends the entered password to `archiveApi`. The server verifies the private `_archiveAdmin/config` record and issues a random session token bound to the anonymous Firebase UID for one hour. The browser keeps that token in memory only. Frontend admin flags have no authority.

Post/comment verifiers live in `_archivePostSecrets`, denied to browser reads and writes. New passwords use salted scrypt; migrated SHA-256 verifiers accept the original plaintext password, never the hash itself. Successful author edits upgrade legacy post verifiers. Keep every private collection denied in Firestore rules.

All post changes, comment operations, likes and counts run through server transactions. Storage requires an authenticated, short-lived upload grant for the exact filenames, issued after checking post authorization. Anonymous authentication is transparent to visitors.

## Important Functions In `index.html`

Firebase:

- `window.saveEvidenceToFirestore`
- `window.deleteEvidenceFromFirestore`
- `window.uploadImagesToFirebaseStorage`

Rendering:

- `window.renderHeroSlider`
- `window.renderCategoryGrid`
- `window.showLightbox`
- `renderPostComments`

Post actions:

- `window.saveEvidence`
- `window.editCurrentPost`
- `window.deleteEvidence`
- `window.likeCurrentPost`
- `window.copyCurrentPostLink`

Comment actions:

- `window.addComment`
- `window.deleteComment`

Uploads:

- `processFiles`
- `prepareImagesForSave`

Helpers:

- `getImages`
- `getMediaLinks`
- `getThumbnail`
- `linkifyText`
- `functions/passwords.js`: server-only password hashing and verification

## Keyboard Behavior

- ESC closes writing modal, post lightbox, guide modal, and admin modal.
- Backspace closes the post lightbox or returns from category page to main, unless an input/textarea/select is focused.
- Arrow left/right navigates posts/slides, but not while typing in inputs.

## Known Limitations And Risks

- Anonymous identities are browser identities, not verified people. Network/UID rate limits reduce abuse but App Check is not enabled.
- Legacy password hashes existed in public documents and Git history before migration. They have been removed from current public documents; changing an exposed or weak password remains advisable.
- Admin sessions expire after one hour and on reload. Use the same existing password modal to log in again.
- New server code runs on the existing billed Firebase project with zero minimum instances and a maximum of three instances.
- Recent-order pagination still fetches document IDs before client sorting; full-dataset updated-date ordering is not guaranteed.
- X embeds may fail for private/deleted/restricted posts or when X blocks embedding.

## Security Operations

- `scripts/admin-firestore.mjs` reuses local Firebase CLI OAuth credentials in memory. Never put credentials or service-account keys in source.
- `node scripts/backup-security.mjs` saves private verifier/config backups under ignored `backups/`. The ordinary `npm run backup` covers public metadata and images only.
- `node scripts/migrate-security.mjs` creates a metadata backup and reports counts; `--apply` migrates only after direct client writes have been closed. Initial setup requires `ARCHIVE_LEGACY_ADMIN_HASH` in the process environment. Never roll back to public write rules.
- `npm run rebuild-counts` now requires the local operator Firebase login and backend dependencies.
- Validate with `npm test --prefix functions` and `node scripts/check-ui.mjs`; optional axe coverage uses `UI_AXE_PATH`.

## Common Troubleshooting

### Users see Vercel `Not Found`

Check that `vercel.json` is deployed and Vercel production deployment uses the latest commit. The rewrite should send all routes to `/index.html`.

### GIF/image fails to upload

Check:

- File is 25MB or less.
- File type is jpeg/png/gif/webp.
- `storage.rules` is deployed.
- Firebase Storage bucket exists and billing/quota are healthy.
- Browser console for Firebase Storage error text.

### Post saves image but then says Firestore/network error

Firebase Storage upload succeeded but Firestore write failed. Check Firestore rules and console errors.

### New code is on GitHub but not live

Open Vercel Deployments and redeploy latest `main` commit.

## Recent Implementation Notes

- Cards are native links with delegated `data-category` and `data-post-id` navigation. Keep database values out of inline JavaScript attributes.
- Open and close overlays through `setModalOpen` so background inertness, scroll locking, focus trapping and focus return stay consistent.
- Pagination requests capture their state object. Ignore stale results after switching categories or sort order.
- Hero candidates are shuffled only when the candidate set changes so Previous and Next use a stable sequence.
- Upload previews in the writing form can be reordered by dragging thumbnails. The save flow preserves that preview order in the stored `images` array.
- Upload previews also have keyboard-accessible move and remove buttons.
- Body text URL linkification must avoid double-escaping query strings. In particular, links like `https://gall.dcinside.com/mgallery/board/view?id=uspolitics&no=3225244` should open with the real `&no=` query parameter, not a literal `&amp;no=`.


## Image-first redesign and admin drafts (2026-10-14)

- The home page starts with a larger centered card and smaller fading neighbors, square thumbnails, excerpts, likes/comments, manual arrows, keycap-style keyboard hints and reduced-motion support. Category links retain their original descriptions and individual colors. The header tagline is restored.
- Gallery thumbnails are square; title-adjacent blue numbers are comment counts, and likes use 👍 plus the count. A missing source renders no placeholder.
- Pagination reads 25 documents, renders 24 and retains the 25th as look-ahead evidence for the next request. IntersectionObserver preloads near the end. Only errors show a retry button.
- Never replay routing on every data refresh. Closing a modal must replace history state even when the URL does not change, clearing `lightboxPost`. Async post fetches carry a request sequence so navigation cancels stale opens.
- Shared post URLs wait for the Firebase module and verify the server record even if a cached record exists. Preserve deletion tombstones until the single merge inside `applyFetchedEvidences`; do not pre-merge fetched batches or skip writing an empty cache.
- The sticky header hides on downward scroll and returns on upward scroll. Keep it visible at the top or when keyboard focus enters it. Transform only; do not change document geometry.
- `admin.js` implements the admin workspace after the existing password login. Unanswered feedback means no comment with `isAdmin === true`; the admin-only red dot and inbox update from Firestore snapshots.
- `functions/drafts.js` implements private draft actions. Every action requires a server-verified admin session. Saves/deletion/publication check a draft version. Publication atomically creates the post, private admin-only authorization, category count and published draft. Retries return the same post.

### Direct agent drafting

Read `AGENTS.md` for the operator's editorial rules. Choose a clear evidence photo for the thumbnail, include all relevant photos of the same issue, use a short concrete headline and numbered one-sentence points, and put the election/location in `source`. Put article/video/SNS references in `mediaLinks`. Do not add routine defensive disclaimers to the public text or make unsupported technical claims.

Agents write directly through the AI draft workspace or `scripts/agent-drafts.mjs` using authorized operator IAM. The module exports `listAgentDrafts()` and `saveAgentDraft(content, { id, version })`; omit the second argument to create a new private draft. There is no JSON exchange-file workflow. Humans use the regular post form; ordinary admin login stays on the current page and AI drafts are a separate footer entry. Publication still requires an explicit user request.

Private drafts live in `_archiveDrafts` and are included in `scripts/backup-security.mjs`. They are never in public post documents until approved; `reviewNotes` stays private. The list shows up to `draftListLimit` (2000, in `functions/drafts.js`) drafts/publications, most recently updated first. Automated research scheduling or an LLM service is not wired in this scaffold.

### Review queues (2026-10-15)

- The workspace has **초안 / 보류 / 대기** tabs. `reviewState` is `draft`, `hold`, or `waiting`; missing values on older documents mean `draft`. All three remain private with `status: 'draft'`. Only the explicit publication action creates a public post.
- `moveDraft` requires the same verified admin session and current draft version as editing. It saves the current content and the review state in one transaction. Ordinary saves preserve the queue. Published records cannot be moved and remain accessible in the collapsed publication history.
- Moving a record keeps the current tab open and selects its next record. Failed moves keep the current edit intact. Refresh preserves the selected tab. Tab navigation supports Left/Right/Home/End.
- Reviewers see the photos rather than raw image addresses. A **썸네일로 지정** button moves a chosen image to the first position without dropping the other images; saving or moving the draft persists that order. Content, references and private notes grow to fit their text.
- Include every relevant evidence photo for the same issue, and choose the clearest first photo for the thumbnail. One representative photo is not a one-image limit. Prefer photos that explain the issue on their own; avoid material that requires playing a video to understand it. Use short, direct titles, put the place in `source`, and describe the visible issue in plain language.

Validation: `npm test --prefix functions` (15 security/concurrency cases) and `node scripts/check-ui.mjs` (6 responsive widths, navigation/scroll regression, review queue transitions, expanding fields and image/thumbnail review). Use `UI_AXE_PATH` for accessibility coverage.


The operator subsequently requested removal of the redesign example `ev-draft-246bb565-a373-47ff-8f3e-9c18eb528ec9` and its private published draft `246bb565-a373-47ff-8f3e-9c18eb528ec9`. Do not recreate or republish it. The ignored historical `backups/check-admin-ui.mjs` script would recreate that old example; do not run it unchanged.

`admin.js` renders private draft images with contain-fit thumbnails, an isolated review dialog, original-size zoom and a new-window source link. Only HTTP(S) image URLs without credentials are previewed; failed loads remain visible as errors. The preview never invokes public post routing. Published drafts can still be inspected, and logout clears private previews. The review draft `21c8a90f-8099-406e-98cc-bb7f907daa27` uses one photograph from a 2022-02-09 Herald Economy report on disputed Paju-eul ballots. It must remain private until the administrator explicitly publishes it. Its content distinguishes the allegation, the reported NEC response and outstanding verification.
