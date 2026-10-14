import { randomBytes, randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword, validPassword, sha256 } from './passwords.js';
import { draftActions, createDraftService } from './drafts.js';

export const categories = ['shape-memory', 'strange-ballot', 'bad-management', 'nec-admin', 'etc', 'free-board'];
export const postsPath = 'artifacts/k-voting/public/data/evidences';
export const countsPath = 'artifacts/k-voting/public/data/stats/categoryCounts';
const actions = new Set(['adminLogin', 'verifyPost', 'uploadGrant', 'savePost', 'deletePost', 'like', 'addComment', 'deleteComment', ...draftActions]);

export function createArchiveService(db, { fail, timestamp = value => value, now = () => Date.now() }) {
  function check(condition, message, code = 'invalid-argument') { if (!condition) fail(code, message); }
  const draftAction = createDraftService(db, { check, now, postsPath, countsPath });
  function text(value, max, required = false) {
    check(typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0), '입력 내용의 길이를 확인해주세요.');
    return value.trim();
  }
  function urls(value, existing = []) {
    check(Array.isArray(value) && value.length <= 20, '이미지와 링크는 각각 20개까지 등록할 수 있습니다.');
    return value.map(url => {
      check(typeof url === 'string' && (existing.includes(url) || (url.length <= 6000 && /^https?:\/\/[^\s]+$/i.test(url))), '올바른 이미지 또는 링크 주소를 입력해주세요.');
      return url;
    });
  }
  async function rateLimit(uid, ip, action) {
    const period = 60_000;
    const limit = action === 'adminLogin' || action === 'uploadGrant' ? 10 : 100;
    const key = action === 'adminLogin' ? 'admin' : action === 'uploadGrant' ? 'upload' : 'write';
    const refs = [db.doc(`_archiveRateLimits/${sha256('ip:' + ip)}-${key}`), db.doc(`_archiveRateLimits/${sha256('uid:' + uid)}-${key}`)];
    await db.runTransaction(async tx => {
      const snapshots = await tx.getAll(...refs);
      snapshots.forEach((snap, i) => {
        const previous = snap.data();
        const active = previous && previous.until > now();
        check(!active || previous.count < limit, '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', 'resource-exhausted');
        tx.set(refs[i], { count: active ? previous.count + 1 : 1, until: active ? previous.until : now() + period });
      });
    });
  }
  async function isAdmin(token, uid) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return false;
    const session = (await db.doc(`_archiveAdminSessions/${sha256(token)}`).get()).data();
    return !!session && session.uid === uid && session.expiresAt > now();
  }
  async function authorize(secret, password, admin) {
    check(admin || await verifyPassword(password, secret?.password), '비밀번호가 다르거나 이 작업을 수행할 권한이 없습니다.', 'permission-denied');
  }
  function adjustCounts(tx, snapshot, oldCategory, newCategory) {
    if (oldCategory === newCategory) return;
    const data = snapshot.data() || {};
    const next = Object.fromEntries(categories.map(category => [category, Math.max(0, Number(data[category] || 0) + (category === newCategory ? 1 : 0) - (category === oldCategory ? 1 : 0))]));
    tx.set(db.doc(countsPath), { ...next, updatedAt: new Date(now()).toISOString() });
  }
  return async function archiveAction(input, context) {
    check(input && typeof input === 'object' && actions.has(input.action), '지원하지 않는 요청입니다.');
    const { action, id, password, adminToken } = input;
    const { uid, ip } = context;
    check(typeof uid === 'string' && uid.length > 0, '인증이 필요합니다.', 'unauthenticated');
    await rateLimit(uid, ip, action);
    if (action === 'adminLogin') {
      const config = (await db.doc('_archiveAdmin/config').get()).data();
      check(await verifyPassword(password, config?.password), '비밀번호가 다릅니다.', 'permission-denied');
      const token = randomBytes(32).toString('hex');
      const expiresAt = now() + 60 * 60_000;
      await db.doc(`_archiveAdminSessions/${sha256(token)}`).set({ uid, expiresAt });
      return { token, expiresAt };
    }
    const admin = await isAdmin(adminToken, uid);
    if (adminToken) check(admin, '관리자 인증이 만료되었습니다. 다시 로그인해주세요.', 'permission-denied');
    if (draftActions.has(action)) {
      check(admin, '관리자만 초안을 관리할 수 있습니다.', 'permission-denied');
      return draftAction(input);
    }
    check(typeof id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(id), '올바른 게시글을 선택해주세요.');
    const postRef = db.doc(`${postsPath}/${id}`);
    const secretRef = db.doc(`_archivePostSecrets/${id}`);
    const newPassword = action === 'savePost' || action === 'addComment'
      ? (validPassword(password) ? await hashPassword(password) : null) : null;
    return db.runTransaction(async tx => {
      const [postSnap, secretSnap, countsSnap] = await tx.getAll(postRef, secretRef, db.doc(countsPath));
      const post = postSnap.data();
      const secret = secretSnap.data() || {};
      const exists = postSnap.exists;
      if (exists) check(post.deleted !== true, '삭제된 게시글입니다.', 'not-found');
      const updatedAt = new Date(now()).toISOString();
      if (action === 'verifyPost') {
        check(exists, '게시글을 찾을 수 없습니다.', 'not-found');
        await authorize(secret, password, admin);
        return { ok: true };
      }
      if (action === 'uploadGrant') {
        if (exists) await authorize(secret, password, admin);
        else check(admin || validPassword(password), '게시글 비밀번호는 4~128자로 입력해주세요.');
        check(Array.isArray(input.files) && input.files.length > 0 && input.files.length <= 20, '업로드할 파일을 확인해주세요.');
        const files = input.files.map(file => {
          check(typeof file === 'string' && /^[0-9]+-[0-9]+-[A-Za-z0-9._-]{1,100}\.(jpg|jpeg|png|gif|webp)$/.test(file), '파일 이름을 확인해주세요.');
          return file;
        });
        tx.set(db.doc(`_archiveUploadGrants/${uid}_${id}`), { files, expiresAt: timestamp(now() + 15 * 60_000) });
        return { ok: true };
      }
      if (action === 'savePost') {
        if (exists) await authorize(secret, password, admin);
        else check(admin || newPassword, '게시글 비밀번호는 4~128자로 입력해주세요.');
        const data = input.post;
        check(data && typeof data === 'object', '게시글 내용을 확인해주세요.');
        const content = {
          title: text(data.title ?? post?.title ?? '', 120, true),
          category: data.category ?? post?.category,
          desc: text(data.desc ?? post?.desc ?? '', 20000),
          source: text(data.source ?? post?.source ?? '', 160),
          images: urls(data.images ?? post?.images ?? (post?.image ? [post.image] : []), post?.images ?? (post?.image ? [post.image] : [])),
          mediaLinks: urls(data.mediaLinks ?? post?.mediaLinks ?? [])
        };
        check([...categories, 'feedback-board'].includes(content.category), '올바른 게시판을 선택해주세요.');
        check(content.category === 'feedback-board' || content.images.length || content.mediaLinks.length, '이미지 또는 링크를 등록해주세요.');
        const result = { ...(post || {}), ...content, id, likes: exists ? Number(post.likes || 0) : 0, comments: exists ? post.comments || [] : [], createdAt: post?.createdAt || updatedAt, updatedAt };
        delete result.passwordHash;
        tx.set(postRef, result);
        if (!exists) tx.set(secretRef, { password: newPassword, comments: {} });
        // Upgrade legacy password verifiers after a successful author edit.
        else if (!admin && secret.password?.scheme === 'sha256') tx.set(secretRef, { ...secret, password: newPassword });
        adjustCounts(tx, countsSnap, post?.category, content.category);
        return { post: result };
      }
      check(exists, '게시글을 찾을 수 없습니다.', 'not-found');
      if (action === 'deletePost') {
        await authorize(secret, password, admin);
        tx.update(postRef, { deleted: true, deletedAt: updatedAt, updatedAt });
        adjustCounts(tx, countsSnap, post.category, null);
        return { ok: true };
      }
      if (action === 'like') {
        const likeRef = db.doc(`_archiveLikes/${id}/users/${uid}`);
        const liked = await tx.get(likeRef);
        if (liked.exists) return { post, alreadyLiked: true };
        const result = { ...post, likes: Number(post.likes || 0) + 1 };
        tx.set(likeRef, { createdAt: updatedAt });
        tx.update(postRef, { likes: result.likes });
        return { post: result };
      }
      const comments = post.comments || [];
      const commentSecrets = { ...(secret.comments || {}) };
      let nextComments;
      if (action === 'addComment') {
        check(comments.length < 500, '댓글은 500개까지 등록할 수 있습니다.');
        check(admin || newPassword, '댓글 비밀번호는 4~128자로 입력해주세요.');
        const comment = { id: randomUUID(), author: admin ? '관리자' : text(input.author, 40, true), text: text(input.text, 1000, true), isAdmin: admin, createdAt: updatedAt };
        nextComments = [...comments, comment];
        commentSecrets[comment.id] = admin ? null : newPassword;
      } else {
        check(typeof input.commentId === 'string', '댓글을 선택해주세요.');
        const comment = comments.find(item => item.id === input.commentId);
        check(comment, '이미 삭제되었거나 찾을 수 없는 댓글입니다.', 'not-found');
        check(admin || (!comment.isAdmin && await verifyPassword(password, commentSecrets[comment.id])), '비밀번호가 다르거나 이 댓글을 삭제할 권한이 없습니다.', 'permission-denied');
        nextComments = comments.filter(item => item.id !== comment.id);
        delete commentSecrets[comment.id];
      }
      tx.update(postRef, { comments: nextComments });
      tx.set(secretRef, { ...secret, comments: commentSecrets });
      return { post: { ...post, comments: nextComments } };
    });
  };
}
