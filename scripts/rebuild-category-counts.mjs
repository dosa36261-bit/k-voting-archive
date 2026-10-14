import { db } from './admin-firestore.mjs';
import { categories, countsPath, postsPath } from '../functions/service.js';
const snapshot = await db.collection(postsPath).get();
const counts = Object.fromEntries(categories.map(category => [category, snapshot.docs.filter(doc => !doc.data().deleted && doc.data().category === category).length]));
await db.doc(countsPath).set({ ...counts, updatedAt: new Date().toISOString() });
console.log('Category counts rebuilt with operator credentials:', counts);
