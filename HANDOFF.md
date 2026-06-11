# K Voting Archive Handoff

## Site Purpose

This is a public citizen archive for collecting election-related issue reports, images, GIFs, videos, source links, and comments. The site is not intended to represent a political party or ideology; the stated purpose is to preserve records related to election integrity and make them easy to browse, share, and discuss.

Live site:

- https://k-voting.vercel.app/

Repository:

- https://github.com/dosa36261-bit/k-voting-archive

## Project Shape

This is a very small static site:

- `index.html`: all UI, styles, Firebase client code, Firebase Storage upload code, and app logic live here.
- `firestore.rules`: suggested Firestore rules for the Firebase console.
- `vercel.json`: rewrites all routes to `index.html` so shared links do not show Vercel `Not Found`.
- `QR.png`: QR image shown from the header QR button for public sharing.
- `HANDOFF.md`: this file.

## Operating Notes For Future Agents

- When the operator asks for code/content changes, make the change, run feasible checks, review the diff, and create a git commit unless the operator explicitly says not to commit.
- Keep changes scoped to this static app unless the operator specifically asks for a larger restructure.

There is no build step, package manager, framework, backend server, or bundler. Vercel deploys the static files directly from GitHub.

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
      passwordHash: "sha256...",
      isAdmin: false
    }
  ],
  passwordHash: "sha256...",
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
- Post links use `/?post=ev-...` and old `#post=ev-...` links are still understood.
- `vercel.json` prevents shared links from showing Vercel `Not Found`.
- Likes are limited to one per browser using `localStorage`, not true account-based identity.
- Post edit/delete uses the post password; admin can edit/delete without post password.
- Comments use author, text, and comment password. Comments can be deleted by admin or by matching comment password.
- Admin comments are stored with `isAdmin: true` and render as bold `관리자`.
- Old comments without passwords can only be deleted by admin.
- The footer has an independent inquiry board view. Inquiry posts use category `feedback-board` and the normal comment system as replies.
- The header QR button opens `QR.png` with sharing copy.
- Category and post navigation update browser history so mobile back/forward stays inside the app before leaving the page.

## Admin Behavior

Admin login is client-side only and compares the SHA-256 hash of the typed password:

```js
const ADMIN_PASSWORD_HASH = "6e74b0e24cc5de672103e711e8239771d00fdbf012b2633e09f25de74014a6b0";
```

This removes the plaintext admin password from the frontend source, but it is still not real security. Anyone inspecting the source can see the verifier hash, and the app still relies on client-side checks. It is only a convenience UI gate. Actual destructive operations are possible if Firestore rules allow them.

Admin can:

- Delete posts.
- Edit posts without entering post password.
- Delete comments without comment password.

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
- `hashPassword`

## Keyboard Behavior

- ESC closes writing modal, post lightbox, guide modal, and admin modal.
- Backspace closes the post lightbox or returns from category page to main, unless an input/textarea/select is focused.
- Arrow left/right navigates posts/slides, but not while typing in inputs.

## Known Limitations And Risks

- No real user accounts.
- Like limiting is localStorage-based, so another browser/device can like again.
- Post/comment password hashes are stored client-side in Firestore. Better than plaintext, but not strong authentication.
- Firestore `delete` is denied, but public updates are still broad enough to support browser-side post edit/delete and comment deletion. This is vulnerable to direct Firestore requests because passwords are checked in the client.
- Firebase Storage writes are public client writes under `evidence-images/`, guarded by `storage.rules` for file size, image MIME type, metadata, filename, and no-overwrite checks. This is still abuse-prone without Auth/App Check.
- X/Twitter real video thumbnails cannot be extracted reliably from a static frontend. The app uses official embeds and a fallback X thumbnail card.
- X embeds may fail for private/deleted/restricted posts or if X blocks embedding.

## Recommended Next Improvements

- Move admin edit/delete/moderation operations to serverless API routes or Firebase Auth plus Cloud Functions.
- Enable App Check and billing/budget alerts before heavier public traffic.
- Consider migrating from one-file HTML to a small framework only if the UI keeps growing.

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
