const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "k-voting";
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || "(default)";
const API_KEY = process.env.FIREBASE_API_KEY || "AIzaSyB2kFGyKrq2liuD3r0WDkN5lMZTN0va9Ik";
const EVIDENCE_COLLECTION_PATH = "artifacts/k-voting/public/data/evidences";
const STATS_DOC_PATH = "artifacts/k-voting/public/data/stats/categoryCounts";
const CATEGORY_KEYS = ["shape-memory", "strange-ballot", "bad-management", "nec-admin", "etc", "free-board"];

const counts = Object.fromEntries(CATEGORY_KEYS.map(category => [category, 0]));
let pageToken = "";

do {
  const url = new URL(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/${EVIDENCE_COLLECTION_PATH}`);
  url.searchParams.set("pageSize", "300");
  url.searchParams.set("key", API_KEY);
  if (pageToken) url.searchParams.set("pageToken", pageToken);

  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("Firestore quota exceeded. Wait for quota reset, then run npm run rebuild-counts again.");
    }
    throw new Error(`Could not read evidences: ${response.status} ${response.statusText} ${await response.text()}`);
  }

  const payload = await response.json();
  for (const doc of payload.documents || []) {
    const data = decodeFirestoreFields(doc.fields || {});
    if (data.deleted) continue;
    if (CATEGORY_KEYS.includes(data.category)) counts[data.category]++;
  }
  pageToken = payload.nextPageToken || "";
} while (pageToken);

const updateUrl = new URL(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/${STATS_DOC_PATH}`);
updateUrl.searchParams.set("key", API_KEY);

const response = await fetch(updateUrl, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    fields: encodeFirestoreFields({
      ...counts,
      updatedAt: new Date().toISOString()
    })
  })
});

if (!response.ok) {
  throw new Error(`Could not write category counts: ${response.status} ${response.statusText} ${await response.text()}`);
}

console.log("Category counts rebuilt:");
console.log(counts);

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

function encodeFirestoreFields(data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encodeFirestoreValue(value)]));
}

function encodeFirestoreValue(value) {
  if (typeof value === "number" && Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === "number") return { doubleValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (value === null) return { nullValue: null };
  return { stringValue: String(value) };
}
