// Operator-authenticated agent access. No exchange file and no publication operation.
import { createDraftService, normalizeDraft } from '../functions/drafts.js';
import { db } from './admin-firestore.mjs';
const action = createDraftService(db, {
  check(condition, message) { if (!condition) throw new Error(message); },
  now: () => Date.now(),
});

export async function listAgentDrafts() {
  return (await action({ action: 'listDrafts' })).drafts;
}

export async function saveAgentDraft(content, options = {}) {
  const draft = normalizeDraft(content);
  if (options.id) {
    if (!Number.isInteger(options.version)) throw new Error('Read the current draft version before updating.');
    return (await action({ action: 'saveDraft', id: options.id, version: options.version, draft })).draft;
  }
  return (await action({ action: 'importDrafts', drafts: [draft] })).drafts[0];
}
