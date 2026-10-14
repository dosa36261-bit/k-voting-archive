// Usage: node scripts/import-drafts.mjs path/to/drafts.json [--apply]
// Validates locally by default. --apply writes private drafts using operator IAM.
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { normalizeDraft, draftsPath } from '../functions/drafts.js';
const file = process.argv[2];
if (!file || file.startsWith('--')) throw new Error('Usage: node scripts/import-drafts.mjs drafts.json [--apply]');
const source = JSON.parse(await readFile(file, 'utf8'));
const items = Array.isArray(source) ? source : source.drafts;
if (!Array.isArray(items) || !items.length || items.length > 20) throw new Error('Supply 1–20 drafts.');
const drafts = items.map(normalizeDraft);
console.log(`Validated ${drafts.length} drafts. Nothing is publicly published by this command.`);
if (process.argv.includes('--apply')) {
  const { db } = await import('./admin-firestore.mjs');
  const updatedAt = new Date().toISOString();
  const batch = db.batch();
  const ids = drafts.map(draft => {
    const id = randomUUID();
    batch.set(db.doc(`${draftsPath}/${id}`), { ...draft, id, status: 'draft', version: 1, createdAt: updatedAt, updatedAt });
    return id;
  });
  await batch.commit();
  console.log(JSON.stringify({ imported: ids }));
}
