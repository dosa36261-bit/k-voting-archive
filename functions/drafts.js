import { randomUUID } from 'node:crypto';

export const draftCategories = ['shape-memory', 'strange-ballot', 'bad-management', 'nec-admin', 'etc', 'free-board'];
export const draftReviewStates = ['draft', 'hold', 'waiting'];
export const draftsPath = '_archiveDrafts';
// Upper bound for one listDrafts response; ~1.8KB per draft keeps this far below the callable payload limit.
export const draftListLimit = 2000;
export const draftActions = new Set(['listDrafts', 'importDrafts', 'saveDraft', 'moveDraft', 'publishDraft', 'deleteDraft']);

// Shared by the callable backend and the operator's AI-draft import CLI.
// Whitelist content fields; imported status/permissions can never publish a post.
export function normalizeDraft(input) {
  const string = (value, max, name, required = false) => {
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`${name} 입력을 확인해주세요.`);
    return value.trim();
  };
  const urls = (values, name) => {
    if (!Array.isArray(values) || values.length > 20) throw new Error(`${name}는 최대 20개입니다.`);
    return values.map(value => {
      const result = string(value, 6000, name, true);
      let url;
      try { url = new URL(result); } catch { throw new Error(`${name} 주소를 확인해주세요.`); }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error(`${name} 주소를 확인해주세요.`);
      return result;
    });
  };
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('초안 형식을 확인해주세요.');
  if (!draftCategories.includes(input.category)) throw new Error('초안 게시판을 선택해주세요.');
  return {
    title: string(input.title, 120, '제목', true), category: input.category,
    desc: string(input.desc ?? '', 20000, '내용'), source: string(input.source ?? '', 160, '출처'),
    images: urls(input.images ?? [], '이미지'), mediaLinks: urls(input.mediaLinks ?? [], '영상 링크'),
    reviewNotes: string(input.reviewNotes ?? '', 4000, '검토 메모'),
  };
}

export function createDraftService(db, { check, now, postsPath, countsPath }) {
  const normalize = value => {
    try { return normalizeDraft(value); }
    catch (error) { check(false, error.message); }
  };
  return async function draftAction(input) {
    const updatedAt = new Date(now()).toISOString();
    if (input.action === 'listDrafts') {
      const snapshot = await db.collection(draftsPath).orderBy('updatedAt', 'desc').limit(draftListLimit).get();
      return { drafts: snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })) };
    }
    if (input.action === 'importDrafts') {
      check(Array.isArray(input.drafts) && input.drafts.length > 0 && input.drafts.length <= 20, '초안을 1~20개 선택해주세요.');
      const drafts = input.drafts.map(value => ({ ...normalize(value), id: randomUUID(), status: 'draft', reviewState: 'draft', version: 1, createdAt: updatedAt, updatedAt }));
      await db.runTransaction(async tx => {
        drafts.forEach(draft => tx.set(db.doc(`${draftsPath}/${draft.id}`), draft));
      });
      return { drafts };
    }
    check(typeof input.id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(input.id), '초안을 선택해주세요.');
    const ref = db.doc(`${draftsPath}/${input.id}`);
    return db.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      check(snapshot.exists, '초안을 찾을 수 없습니다.', 'not-found');
      const draft = snapshot.data();
      // Retrying a completed publication returns its original post, never a duplicate.
      if (input.action === 'publishDraft' && draft.status === 'published') {
        const published = await tx.get(db.doc(`${postsPath}/${draft.postId}`));
        check(published.exists && !published.data().deleted, '게시물이 삭제되었습니다.', 'not-found');
        return { draft, post: published.data(), alreadyPublished: true };
      }
      check(draft.status === 'draft', '게시한 초안은 수정할 수 없습니다. 게시글에서 수정해주세요.', 'failed-precondition');
      check(Number.isInteger(input.version) && input.version === draft.version, '다른 창에서 변경된 초안입니다. 새로고침 후 다시 확인해주세요.', 'aborted');
      if (input.action === 'deleteDraft') { tx.delete(ref); return { ok: true }; }
      if (input.action === 'saveDraft') {
        const result = { ...draft, ...normalize(input.draft), updatedAt, version: draft.version + 1 };
        tx.set(ref, result);
        return { draft: result };
      }
      if (input.action === 'moveDraft') {
        check(draftReviewStates.includes(input.reviewState), '이동할 검토 상태를 선택해주세요.');
        // Save current edits and change the private review queue in one transaction.
        const result = { ...draft, ...normalize(input.draft), reviewState: input.reviewState, updatedAt, version: draft.version + 1 };
        tx.set(ref, result);
        return { draft: result };
      }
      const { reviewNotes, ...content } = normalize(draft);
      check(content.images.length || content.mediaLinks.length, '게시하려면 이미지 또는 영상 링크를 추가해주세요.');
      const id = `ev-draft-${draft.id}`;
      const postRef = db.doc(`${postsPath}/${id}`);
      const [existing, counts] = await tx.getAll(postRef, db.doc(countsPath));
      check(!existing.exists, '같은 초안의 게시물이 이미 있습니다.', 'already-exists');
      const post = { ...content, id, likes: 0, comments: [], createdAt: updatedAt, updatedAt };
      const result = { ...draft, status: 'published', postId: id, publishedAt: updatedAt, updatedAt, version: draft.version + 1 };
      tx.set(postRef, post);
      tx.set(db.doc(`_archivePostSecrets/${id}`), { password: null, comments: {} });
      tx.set(ref, result);
      tx.set(db.doc(countsPath), { ...(counts.data() || {}), [content.category]: Number(counts.data()?.[content.category] || 0) + 1, updatedAt });
      return { draft: result, post };
    });
  };
}
