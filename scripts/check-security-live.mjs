// Explicit opt-in: creates one temporary feedback post, then removes its data.
if (!process.argv.includes('--run')) throw new Error('Pass --run to check the deployed API with temporary test data.');
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, getOperatorToken } from './admin-firestore.mjs';
import { postsPath } from '../functions/service.js';
const key = 'AIzaSyB2kFGyKrq2liuD3r0WDkN5lMZTN0va9Ik';
const id = `ev-security-check-${randomUUID()}`;
const password = randomUUID();
const bucket = 'k-voting.firebasestorage.app';
const filename = `${Date.now()}-1-check.png`;
const storagePath = `evidence-images/${id}/${filename}`;
const signup = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
assert.equal(signup.status, 200, 'Anonymous authentication');
const identity = await signup.json();
const checks = [];
async function api(action, payload = {}, expectedStatus = 200) {
  const response = await fetch('https://asia-northeast3-k-voting.cloudfunctions.net/archiveApi', { method: 'POST', headers: { Authorization: `Bearer ${identity.idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { action, id, ...payload } }) });
  const body = await response.json();
  assert.equal(response.status, expectedStatus, `${action}: ${body.error?.message || response.status}`);
  return body.result;
}
try {
  const post = { title: '[자동 검증 후 삭제] 저장 기능 확인', category: 'feedback-board', desc: '보안 배포 기능 검사', source: '', images: [], mediaLinks: [] };
  await api('savePost', { post, password }); checks.push('create');
  await api('savePost', { post: { title: 'forbidden' }, password: 'wrong-password' }, 403); checks.push('reject wrong password');
  await api('savePost', { post: { title: '[자동 검증 후 삭제] 수정 확인' }, password }); checks.push('author edit');
  const added = await api('addComment', { author: '검증', text: '댓글 확인', password });
  assert.equal(added.post.comments.length, 1); assert.equal('passwordHash' in added.post.comments[0], false);
  await api('deleteComment', { commentId: added.post.comments[0].id, password: 'wrong-password' }, 403);
  await api('deleteComment', { commentId: added.post.comments[0].id, password }); checks.push('comment authorization');
  assert.equal((await api('like')).post.likes, 1); assert.equal((await api('like')).post.likes, 1); checks.push('duplicate vote protection');
  await api('adminLogin', { password: randomUUID() }, 403); checks.push('admin password rejection');
  const firestoreUrl = `https://firestore.googleapis.com/v1/projects/k-voting/databases/(default)/documents`;
  const deniedRead = await fetch(`${firestoreUrl}/_archivePostSecrets/${id}?key=${key}`);
  assert.equal(deniedRead.status, 403); checks.push('private verifier read denied');
  const deniedWrite = await fetch(`${firestoreUrl}/${postsPath}/${id}?key=${key}&updateMask.fieldPaths=title`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { title: { stringValue: '[자동 검증 후 삭제] 수정 확인' } } }) });
  assert.equal(deniedWrite.status, 403); checks.push('direct Firestore write denied');
  await api('uploadGrant', { password, files: [filename] });
  const boundary = `boundary-${randomUUID()}`;
  const pixels = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDAAAAABJRU5ErkJggg==', 'base64');
  const metadata = JSON.stringify({ name: storagePath, contentType: 'image/png', metadata: { evidenceId: id } });
  const uploadBody = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: image/png\r\n\r\n`), pixels, Buffer.from(`\r\n--${boundary}--`)]);
  const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o?name=${encodeURIComponent(storagePath)}`;
  const uploadHeaders = { Authorization: `Firebase ${identity.idToken}`, 'X-Goog-Upload-Protocol': 'multipart', 'Content-Type': `multipart/related; boundary=${boundary}` };
  const uploaded = await fetch(uploadUrl, { method: 'POST', headers: uploadHeaders, body: uploadBody });
  const uploadedText = await uploaded.text();
  assert.equal(uploaded.status, 200, `Authorized image upload: ${uploadedText.slice(0, 250)}`); checks.push('authorized image upload');
  const deniedUpload = await fetch(uploadUrl, { method: 'POST', headers: uploadHeaders, body: uploadBody });
  assert.equal(deniedUpload.status, 403); checks.push('image overwrite denied');
  await api('deletePost', { password }); checks.push('author delete');
  console.log(JSON.stringify({ passed: checks }, null, 2));
} finally {
  // Only known identifiers created by this run are removed, using operator IAM.
  await db.doc(`${postsPath}/${id}`).delete();
  await db.doc(`_archivePostSecrets/${id}`).delete();
  await db.doc(`_archiveUploadGrants/${identity.localId}_${id}`).delete();
  await db.doc(`_archiveLikes/${id}/users/${identity.localId}`).delete();
  const cleanup = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(storagePath)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${await getOperatorToken()}` } });
  assert.ok([204, 404].includes(cleanup.status), 'Test image cleanup');
  const deletedIdentity = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: identity.idToken }) });
  assert.equal(deletedIdentity.status, 200, 'Test identity cleanup');
  console.log('Temporary test post, private records, image and anonymous identity removed.');
}
