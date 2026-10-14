import { mkdir, writeFile } from 'node:fs/promises';
import { db } from './admin-firestore.mjs';
const directory = `backups/private-${new Date().toISOString().replace(/[:.]/g, '-')}`;
await mkdir(directory, { recursive: true });
for (const collection of ['_archivePostSecrets', '_archiveAdmin']) {
  const snapshot = await db.collection(collection).get();
  await writeFile(`${directory}/${collection}.json`, JSON.stringify(snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() })), null, 2));
}
console.log(`Private security backup saved locally: ${directory}`);
