import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "k-voting";
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || "(default)";
const API_KEY = process.env.FIREBASE_API_KEY || "AIzaSyB2kFGyKrq2liuD3r0WDkN5lMZTN0va9Ik";
const COLLECTION_PATH = "artifacts/k-voting/public/data/evidences";
const BACKUP_ROOT = process.env.BACKUP_ROOT || "backups";

const now = new Date();
const stamp = now.toISOString().replace(/[:.]/g, "-");
const backupDir = join(BACKUP_ROOT, stamp);
const imageDir = join(backupDir, "images");

await mkdir(imageDir, { recursive: true });

const evidences = await fetchAllEvidences();
const imageResults = await downloadEvidenceImages(evidences);

await writeJson(join(backupDir, "evidences.json"), evidences);
await writeJson(join(backupDir, "manifest.json"), {
  createdAt: now.toISOString(),
  projectId: PROJECT_ID,
  databaseId: DATABASE_ID,
  collectionPath: COLLECTION_PATH,
  evidenceCount: evidences.length,
  activeEvidenceCount: evidences.filter(item => !item.deleted).length,
  deletedEvidenceCount: evidences.filter(item => item.deleted).length,
  imageCount: imageResults.filter(item => item.ok).length,
  failedImageCount: imageResults.filter(item => !item.ok).length,
  imageResults
});

console.log(`Backup saved: ${backupDir}`);
console.log(`Documents: ${evidences.length}`);
console.log(`Images: ${imageResults.filter(item => item.ok).length} saved, ${imageResults.filter(item => !item.ok).length} failed`);

async function fetchAllEvidences() {
  const docs = [];
  let pageToken = "";

  do {
    const url = new URL(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/${COLLECTION_PATH}`);
    url.searchParams.set("pageSize", "300");
    url.searchParams.set("key", API_KEY);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 429) {
        throw new Error(
          "Firestore quota exceeded. Firebase 무료 읽기 한도 또는 Google Cloud API 할당량을 확인한 뒤 다시 실행하세요."
        );
      }
      throw new Error(`Firestore backup failed: ${response.status} ${response.statusText} ${await response.text()}`);
    }

    const payload = await response.json();
    for (const doc of payload.documents || []) {
      const id = doc.name.split("/").pop();
      docs.push({ id, ...decodeFirestoreFields(doc.fields || {}) });
    }
    pageToken = payload.nextPageToken || "";
  } while (pageToken);

  docs.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return docs;
}

async function downloadEvidenceImages(evidences) {
  const results = [];
  const seenUrls = new Set();

  for (const evidence of evidences) {
    const images = getEvidenceImages(evidence);
    for (let index = 0; index < images.length; index++) {
      const url = images[index];
      if (!isHttpUrl(url) || seenUrls.has(url)) continue;
      seenUrls.add(url);

      const filename = makeImageFilename(evidence, index, url);
      const outputPath = join(imageDir, filename);
      try {
        await downloadFile(url, outputPath);
        results.push({ ok: true, evidenceId: evidence.id, url, file: outputPath });
      } catch (error) {
        results.push({ ok: false, evidenceId: evidence.id, url, error: error.message });
      }
    }
  }

  return results;
}

function getEvidenceImages(evidence) {
  const images = [];
  if (Array.isArray(evidence.images)) images.push(...evidence.images);
  if (evidence.image) images.push(evidence.image);
  return images.filter(Boolean);
}

async function downloadFile(url, outputPath) {
  await mkdir(dirname(outputPath), { recursive: true });
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`download failed: ${response.status} ${response.statusText}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(outputPath));
}

function decodeFirestoreFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)]));
}

function decodeFirestoreValue(value) {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeFirestoreValue);
  if ("mapValue" in value) return decodeFirestoreFields(value.mapValue.fields || {});
  return value;
}

async function writeJson(path, data) {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function makeImageFilename(evidence, index, url) {
  const parsed = new URL(url);
  const fallbackExt = extname(parsed.pathname).split("?")[0] || ".jpg";
  const ext = fallbackExt.length <= 8 ? fallbackExt : ".jpg";
  const base = [evidence.title, evidence.source, evidence.id]
    .filter(Boolean)
    .join("_");
  return `${sanitizeFilename(base || "evidence")}_${index + 1}${ext}`;
}

function sanitizeFilename(value) {
  return String(value)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
