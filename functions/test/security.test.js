import test from 'node:test';
import assert from 'node:assert/strict';
import { createArchiveService, postsPath, countsPath } from '../service.js';
import { hashPassword, verifyPassword, sha256 } from '../passwords.js';

// Serialized transactions model Firestore's retry/commit boundary: each request
// reads the most recently committed state, never a stale browser array.
function fixture() {
  const data = new Map();
  let queue = Promise.resolve();
  const snapshot = ref => ({ exists: data.has(ref.path), data: () => structuredClone(data.get(ref.path)) });
  const db = {
    doc(path) { return { path, get: async () => snapshot({ path }), set: async value => data.set(path, structuredClone(value)) }; },
    runTransaction(fn) {
      const run = queue.then(async () => {
        const writes = [];
        const result = await fn({ get: async ref => snapshot(ref), getAll: async (...refs) => refs.map(snapshot),
          set: (ref, value) => writes.push(() => data.set(ref.path, structuredClone(value))),
          update: (ref, value) => writes.push(() => data.set(ref.path, { ...data.get(ref.path), ...structuredClone(value) })) });
        writes.forEach(write => write()); return result;
      });
      queue = run.catch(() => {}); return run;
    }
  };
  let clock = Date.now();
  const api = createArchiveService(db, { now: () => clock, fail(code, message) { throw Object.assign(new Error(message), { code }); } });
  const call = (input, uid = 'guest') => api(input, { uid, ip: '127.0.0.1' });
  return { call, data, advance: ms => { clock += ms; } };
}
const post = { title: '테스트', category: 'feedback-board', desc: '내용', source: '', images: [], mediaLinks: [] };
const create = f => f.call({ action: 'savePost', id: 'ev-test', password: 'author-password', post });

test('salted password hashes differ; legacy hash is not accepted as a password', async () => {
  const a = await hashPassword('password'); const b = await hashPassword('password');
  assert.notEqual(a.hash, b.hash);
  assert.equal(await verifyPassword('password', a), true);
  assert.equal(await verifyPassword('wrong', a), false);
  const legacy = { scheme: 'sha256', hash: sha256('old-password') };
  assert.equal(await verifyPassword('old-password', legacy), true);
  assert.equal(await verifyPassword(legacy.hash, legacy), false);
});
test('public post contains no verifier; a forged likes/comments/admin flag is ignored', async () => {
  const f = fixture();
  const result = await f.call({ action: 'savePost', id: 'ev-test', password: 'author-password', post: { ...post, likes: 500, comments: [{ isAdmin: true }], passwordHash: 'forged' } });
  assert.equal(result.post.likes, 0); assert.deepEqual(result.post.comments, []);
  assert.equal('passwordHash' in result.post, false);
  assert.equal(f.data.get('_archivePostSecrets/ev-test').password.scheme, 'scrypt');
});
test('wrong password cannot edit, delete, verify or issue an upload grant', async () => {
  const f = fixture(); await create(f);
  for (const action of ['savePost', 'deletePost', 'verifyPost', 'uploadGrant']) {
    await assert.rejects(f.call({ action, id: 'ev-test', password: 'wrong', post, files: ['123-1-test.jpg'] }), { code: 'permission-denied' });
  }
  assert.equal(f.data.get(`${postsPath}/ev-test`).deleted, undefined);
});
test('an author edit retains existing counters/comments and updates category counts atomically', async () => {
  const f = fixture(); await create(f);
  await f.call({ action: 'savePost', id: 'ev-test', password: 'author-password', post: { ...post, category: 'etc', mediaLinks: ['https://example.com'], likes: 100 } });
  assert.equal(f.data.get(countsPath).etc, 1); assert.equal(f.data.get(`${postsPath}/ev-test`).likes, 0);
  await f.call({ action: 'deletePost', id: 'ev-test', password: 'author-password' });
  assert.equal(f.data.get(countsPath).etc, 0);
  await assert.rejects(f.call({ action: 'savePost', id: 'ev-test', password: 'author-password', post }), { code: 'not-found' });
});
test('concurrent likes accumulate and the same identity cannot vote twice', async () => {
  const f = fixture(); await create(f);
  await Promise.all(Array.from({ length: 12 }, (_, n) => f.call({ action: 'like', id: 'ev-test' }, `voter-${n}`)));
  const duplicate = await f.call({ action: 'like', id: 'ev-test' }, 'voter-0');
  assert.equal(duplicate.alreadyLiked, true); assert.equal(duplicate.post.likes, 12);
});
test('concurrent comments survive; deletion targets stable ID and checks its password', async () => {
  const f = fixture(); await create(f);
  await Promise.all(['A', 'B'].map(author => f.call({ action: 'addComment', id: 'ev-test', password: 'comment-pass', author, text: author, isAdmin: true })));
  const comments = f.data.get(`${postsPath}/ev-test`).comments;
  assert.equal(comments.length, 2); assert.equal(comments.every(c => !c.isAdmin && !('passwordHash' in c)), true);
  await assert.rejects(f.call({ action: 'deleteComment', id: 'ev-test', commentId: comments[0].id, password: 'wrong' }), { code: 'permission-denied' });
  await f.call({ action: 'deleteComment', id: 'ev-test', commentId: comments[0].id, password: 'comment-pass' });
  assert.equal(f.data.get(`${postsPath}/ev-test`).comments[0].id, comments[1].id);
});
test('admin sessions are verified, bound to identity, and expire', async () => {
  const f = fixture(); await create(f);
  f.data.set('_archiveAdmin/config', { password: await hashPassword('admin-password') });
  await assert.rejects(f.call({ action: 'adminLogin', password: 'wrong' }), { code: 'permission-denied' });
  const { token } = await f.call({ action: 'adminLogin', password: 'admin-password' });
  await assert.rejects(f.call({ action: 'verifyPost', id: 'ev-test', adminToken: token }, 'different-user'), { code: 'permission-denied' });
  assert.equal((await f.call({ action: 'verifyPost', id: 'ev-test', adminToken: token })).ok, true);
  f.advance(3_600_001);
  await assert.rejects(f.call({ action: 'verifyPost', id: 'ev-test', adminToken: token }), { code: 'permission-denied' });
});
test('legacy posts without a password cannot be claimed by an arbitrary visitor', async () => {
  const f = fixture(); f.data.set(`${postsPath}/legacy`, { ...post, id: 'legacy', comments: [] });
  await assert.rejects(f.call({ action: 'savePost', id: 'legacy', post, password: 'new-password' }), { code: 'permission-denied' });
});
test('admin login brute force is rate limited even across visitor identities on one IP', async () => {
  const f = fixture();
  for (let n = 0; n < 10; n++) await assert.rejects(f.call({ action: 'adminLogin', password: 'wrong' }, `visitor-${n}`), { code: 'permission-denied' });
  await assert.rejects(f.call({ action: 'adminLogin', password: 'wrong' }, 'new-visitor'), { code: 'resource-exhausted' });
});
