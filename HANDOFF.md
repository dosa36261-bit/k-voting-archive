# K Voting Archive Handoff

## Site Purpose

This is a public citizen archive for collecting election-related issue reports, images, GIFs, videos, source links, and comments. The site is not intended to represent a political party or ideology; the stated purpose is to preserve records related to election integrity and make them easy to browse, share, and discuss.

Live site:

- https://k-voting.vercel.app/

Repository:

- https://github.com/dosa36261-bit/k-voting-archive

## Project Shape

This is a very small static site:

- `index.html`: all UI, styles, Firebase client code, Cloudinary upload code, and app logic live here.
- `firestore.rules`: suggested Firestore rules for the Firebase console.
- `vercel.json`: rewrites all routes to `index.html` so shared links do not show Vercel `Not Found`.
- `HANDOFF.md`: this file.

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

### Cloudinary

Images and GIFs are uploaded to Cloudinary, not Firebase Storage.

Current values in `index.html`:

```js
const CLOUDINARY_CLOUD_NAME = "dz4iuka76";
const CLOUDINARY_UPLOAD_PRESET = "kvoting_unsigned";
const MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024;
```

The upload preset is unsigned. The site code limits uploads to:

- JPEG
- PNG
- GIF
- WEBP
- 10MB max

Do not reintroduce Firebase Storage unless the operator explicitly accepts Blaze/pay-as-you-go billing risk.

## Data Model

Each post document roughly looks like:

```js
{
  id: "ev-...",
  title: "...",
  category: "shape-memory" | "strange-ballot" | "bad-management" | "nec-admin" | "etc" | "free-board",
  images: ["https://res.cloudinary.com/..."],
  mediaLinks: ["https://x.com/...", "https://youtube.com/..."],
  source: "...",
  desc: "...",
  likes: 0,
  comments: [
    {
      author: "...",
      text: "...",
      passwordHash: "sha256..."
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

## Current Feature Summary

- Category browsing.
- Main page hero shows recommended/random posts from top-liked candidates per category.
- Post creation with title, category, password, images/GIFs or video/SNS links, source, and content.
- Image upload by file picker, drag/drop, or Ctrl+V while the writing modal is open.
- Cloudinary stores image/GIF files.
- YouTube links render as embedded players.
- X/Twitter post links render with the official X/Twitter embed widget when possible.
- X-only posts get a custom X thumbnail card, not a real video frame thumbnail.
- Content URLs are linkified.
- Post links use `/?post=ev-...` and old `#post=ev-...` links are still understood.
- `vercel.json` prevents shared links from showing Vercel `Not Found`.
- Likes are limited to one per browser using `localStorage`, not true account-based identity.
- Post edit/delete uses the post password; admin can edit/delete without post password.
- Comments use author, text, and comment password. Comments can be deleted by admin or by matching comment password.
- Old comments without passwords can only be deleted by admin.

## Admin Behavior

Admin login is client-side only:

```js
const ADMIN_PASSWORD = "KVote_Secure_Admin_#9982_Pass";
```

This is not real security. Anyone inspecting the source can see it. It is only a convenience UI gate. Actual destructive operations are possible if Firestore rules allow them.

Admin can:

- Delete posts.
- Edit posts without entering post password.
- Delete comments without comment password.

## Important Functions In `index.html`

Firebase:

- `window.saveEvidenceToFirestore`
- `window.deleteEvidenceFromFirestore`

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
- `uploadImagesToCloudinary`

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
- Firestore rules have been kept permissive during development. Tighten them before serious public use.
- Cloudinary unsigned upload preset can be abused if exposed. The code limits file size/type client-side, but server-side preset limits should also be configured if the UI allows it.
- X/Twitter real video thumbnails cannot be extracted reliably from a static frontend. The app uses official embeds and a fallback X thumbnail card.
- X embeds may fail for private/deleted/restricted posts or if X blocks embedding.

## Recommended Next Improvements

- Move write/delete operations to serverless API routes to enforce passwords and admin authority server-side.
- Add stricter Firestore rules once the data shape is stable.
- Add Cloudinary upload preset restrictions in the Cloudinary console if available.
- Add App Check or abuse protection if public usage grows.
- Consider migrating from one-file HTML to a small framework only if the UI keeps growing.

## Common Troubleshooting

### Users see Vercel `Not Found`

Check that `vercel.json` is deployed and Vercel production deployment uses the latest commit. The rewrite should send all routes to `/index.html`.

### GIF/image fails to upload

Check:

- File is 10MB or less.
- File type is jpeg/png/gif/webp.
- Cloudinary cloud name and unsigned preset are correct.
- Cloudinary preset is enabled and unsigned.
- Browser console for Cloudinary error text.

### Post saves image but then says Firestore/network error

Cloudinary upload succeeded but Firestore write failed. Check Firestore rules and console errors.

### New code is on GitHub but not live

Open Vercel Deployments and redeploy latest `main` commit.
