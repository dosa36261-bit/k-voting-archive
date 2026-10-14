// Run with local Firebase CLI credentials. --apply requires a pre-migration backup.
// Password verifiers and session documents must never be exported into public hosting.
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { postsPath, countsPath, categories } from '../functions/service.js';
import { db } from './admin-firestore.mjs';
const apply = process.argv.includes('--apply');
const backupDir = process.env.SECURITY_BACKUP_DIR || `backups/security-${new Date().toISOString().replace(/[:.]/g, '-')}`;
await mkdir(backupDir, { recursive: true });
const snapshot = await db.collection(postsPath).get();
const documents = snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() }));
await writeFile(`${backupDir}/before.json`, JSON.stringify({ createdAt: new Date().toISOString(), documents }, null, 2), { flag: 'wx' });
const summary = { documents: documents.length, active: documents.filter(doc => !doc.data.deleted).length, postPasswords: documents.filter(doc => doc.data.passwordHash).length, comments: documents.reduce((n, doc) => n + (doc.data.comments || []).length, 0), backupDir, apply };
console.log(JSON.stringify(summary));
if (!apply) process.exit(0);
const adminRef = db.doc('_archiveAdmin/config');
if (!(await adminRef.get()).exists) {
  const hash = process.env.ARCHIVE_LEGACY_ADMIN_HASH;
  if (!/^[a-f0-9]{64}$/.test(hash || '')) throw new Error('Set ARCHIVE_LEGACY_ADMIN_HASH before initial migration.');
  await adminRef.create({ password: { scheme: 'sha256', hash } });
}
for (const document of documents) {
  await db.runTransaction(async tx => {
    const postRef = db.doc(`${postsPath}/${document.id}`);
    const secretRef = db.doc(`_archivePostSecrets/${document.id}`);
    const [postSnap, secretSnap] = await tx.getAll(postRef, secretRef);
    const post = postSnap.data();
    const secret = secretSnap.data() || { password: null, comments: {} };
    secret.comments ||= {};
    if (post.passwordHash && !secret.password) secret.password = { scheme: 'sha256', hash: post.passwordHash };
    delete post.passwordHash;
    post.comments = (post.comments || []).map(comment => {
      const clean = { ...comment, id: comment.id || randomUUID() };
      if (comment.passwordHash && !secret.comments[clean.id]) secret.comments[clean.id] = { scheme: 'sha256', hash: comment.passwordHash };
      delete clean.passwordHash;
      return clean;
    });
    tx.set(secretRef, secret);
    tx.set(postRef, post);
  });
}
const after = await db.collection(postsPath).get();
const counts = Object.fromEntries(categories.map(category => [category, after.docs.filter(doc => !doc.data().deleted && doc.data().category === category).length]));
await db.doc(countsPath).set({ ...counts, updatedAt: new Date().toISOString() });
if (after.size !== documents.length || after.docs.some(doc => 'passwordHash' in doc.data() || (doc.data().comments || []).some(comment => 'passwordHash' in comment))) throw new Error('Migration verification failed');
await writeFile(`${backupDir}/verified.json`, JSON.stringify({ documents: after.size, counts, verifiedAt: new Date().toISOString() }, null, 2));
console.log('Migration verified: document count preserved; public password hashes removed.');
