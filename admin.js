// Private drafts are read/written only through the server-verified admin session.
let adminDrafts = [];
let selectedDraft = null;
let draftBusy = false;
let draftDirty = false;
let draftLoadRequest = 0;
const draftForm = document.getElementById('admin-draft-form');
const draftStatus = document.getElementById('draft-status');
document.getElementById('draft-category').innerHTML = CATEGORY_KEYS.map(key => `<option value="${key}">${getCategoryLabel(key)}</option>`).join('');
draftForm.addEventListener('input', () => { draftDirty = true; });

function hasAdminReply(item) { return (item.comments || []).some(comment => comment.isAdmin === true); }
window.setAdminFeedback = function(items) {
    const pending = isAdminLoggedIn ? items.filter(item => !item.deleted && !hasAdminReply(item)).sort((a, b) => String(b.createdAt || '').localeCompare(a.createdAt || '')) : [];
    document.getElementById('feedback-alert-dot').classList.toggle('hidden', !pending.length);
    document.getElementById('admin-feedback-dot').classList.toggle('hidden', !pending.length);
    document.getElementById('admin-feedback-count').textContent = pending.length;
    document.getElementById('admin-feedback-status').textContent = pending.length ? '답글을 남기면 미답변 목록에서 사라집니다.' : '미답변 문의가 없습니다.';
    document.getElementById('admin-feedback-list').innerHTML = pending.map(item => `<a href="?post=${encodeURIComponent(item.id)}" data-post-id="${escapeHtml(item.id)}"><span class="notification-dot" aria-hidden="true"></span>${escapeHtml(item.title)}</a>`).join('');
    if (window.selectedCategoryKey === FEEDBACK_CATEGORY_KEY) window.renderCategoryGrid();
};

window.openAdminPage = function(options = {}) {
    if (!isAdminLoggedIn) { window.openAdminModal(); return; }
    ++lightboxRequest;
    saveCurrentScrollPosition();
    window.selectedCategoryKey = '';
    document.getElementById('page-home').classList.add('hidden');
    document.getElementById('page-category').classList.add('hidden');
    document.getElementById('page-admin').classList.remove('hidden');
    document.getElementById('main-upload-button').classList.remove('hidden');
    if (options.updateHistory !== false) updateAppHistory({ admin: '1' });
    window.lastAppliedRouteKey = 'admin';
    window.scrollTo({ top: 0, behavior: 'instant' });
    document.getElementById('admin-page-title').focus({ preventScroll: true });
    window.loadAdminDrafts();
};

function allowDraftSwitch() { return !draftDirty || confirm('저장하지 않은 수정 내용이 있습니다. 변경 내용을 버릴까요?'); }
window.loadAdminDrafts = async function() {
    if (draftBusy || !allowDraftSwitch()) return;
    const request = ++draftLoadRequest;
    draftStatus.textContent = '초안을 불러오는 중…';
    const result = await window.archiveAction('listDrafts');
    if (request !== draftLoadRequest || !isAdminLoggedIn) return;
    if (!result) { draftStatus.textContent = '초안을 불러오지 못했습니다. 새로고침을 눌러 다시 시도해주세요.'; return; }
    adminDrafts = result.drafts;
    const previous = selectedDraft?.id;
    renderAdminDraftList();
    selectAdminDraft(adminDrafts.find(item => item.id === previous) || adminDrafts.find(item => item.status === 'draft') || adminDrafts[0] || null);
};

function renderAdminDraftList() {
    const list = document.getElementById('admin-draft-list');
    list.replaceChildren();
    adminDrafts.forEach(item => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.draftId = item.id;
        button.setAttribute('aria-pressed', String(selectedDraft?.id === item.id));
        button.innerHTML = `<strong>${escapeHtml(item.title)}</strong><span>${item.status === 'published' ? '게시 완료' : '검토 대기'} · ${getCategoryLabel(item.category)}</span>`;
        button.onclick = () => { if (!draftBusy && allowDraftSwitch()) selectAdminDraft(item); };
        list.appendChild(button);
    });
    draftStatus.textContent = `검토 대기 ${adminDrafts.filter(item => item.status === 'draft').length}개 · 게시 완료 ${adminDrafts.filter(item => item.status === 'published').length}개 (최근 100개)`;
}
function selectAdminDraft(draft) {
    selectedDraft = draft;
    draftDirty = false;
    draftForm.classList.toggle('hidden', !draft);
    document.getElementById('draft-empty').classList.toggle('hidden', !!draft);
    if (draft) {
        for (const [id, key] of [['title','title'],['category','category'],['desc','desc'],['source','source'],['notes','reviewNotes']]) document.getElementById(`draft-${id}`).value = draft[key] || '';
        document.getElementById('draft-images').value = (draft.images || []).join('\n');
        document.getElementById('draft-media').value = (draft.mediaLinks || []).join('\n');
        const published = draft.status === 'published';
        document.getElementById('draft-fields').disabled = published;
        document.querySelector('.draft-actions').classList.toggle('hidden', published);
        const link = document.getElementById('draft-published-link');
        link.classList.toggle('hidden', !published);
        link.href = `?post=${encodeURIComponent(draft.postId || '')}`;
    }
    renderAdminDraftList();
}
function currentDraftContent() {
    const lines = id => document.getElementById(id).value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    return { title: document.getElementById('draft-title').value.trim(), category: document.getElementById('draft-category').value, desc: document.getElementById('draft-desc').value.trim(), source: document.getElementById('draft-source').value.trim(), images: lines('draft-images'), mediaLinks: lines('draft-media'), reviewNotes: document.getElementById('draft-notes').value.trim() };
}
function updateSavedDraft(draft) {
    const index = adminDrafts.findIndex(item => item.id === draft.id);
    if (index < 0) adminDrafts.unshift(draft); else adminDrafts[index] = draft;
    selectAdminDraft(draft);
}
async function withDraftBusy(callback) {
    if (draftBusy) return;
    draftBusy = true;
    document.querySelectorAll('.draft-actions button, .admin-toolbar button').forEach(button => { button.disabled = true; });
    try { await callback(); }
    catch (error) { draftStatus.textContent = error.message || '요청을 처리하지 못했습니다.'; }
    finally {
        draftBusy = false;
        document.querySelectorAll('.draft-actions button, .admin-toolbar button').forEach(button => { button.disabled = false; });
    }
}
window.importDraftFile = async function(event) {
    const file = event.target.files[0]; event.target.value = '';
    if (!file || draftBusy || !allowDraftSwitch()) return;
    await withDraftBusy(async () => {
        if (file.size > 2 * 1024 * 1024) throw new Error('2MB 이하의 JSON 파일을 선택해주세요.');
        let parsed;
        try { parsed = JSON.parse(await file.text()); } catch { throw new Error('JSON 파일 형식을 확인해주세요.'); }
        const result = await window.archiveAction('importDrafts', { drafts: Array.isArray(parsed) ? parsed : parsed.drafts });
        if (!result) return;
        adminDrafts.unshift(...result.drafts); selectAdminDraft(result.drafts[0]);
        showNotification(`초안 ${result.drafts.length}개를 가져왔습니다.`);
    });
};
window.newAdminDraft = async function() {
    if (draftBusy || !allowDraftSwitch()) return;
    await withDraftBusy(async () => {
        const result = await window.archiveAction('importDrafts', { drafts: [{ title: '새 초안', category: 'free-board', desc: '', source: '', images: [], mediaLinks: [], reviewNotes: '' }] });
        if (result) { adminDrafts.unshift(...result.drafts); selectAdminDraft(result.drafts[0]); document.getElementById('draft-title').focus(); }
    });
};
async function saveCurrentDraft() {
    const result = await window.archiveAction('saveDraft', { id: selectedDraft.id, version: selectedDraft.version, draft: currentDraftContent() });
    if (result) updateSavedDraft(result.draft);
    return result;
}
window.saveAdminDraft = async function(event) {
    event.preventDefault();
    if (!selectedDraft || !draftForm.reportValidity()) return;
    await withDraftBusy(async () => { if (await saveCurrentDraft()) showNotification('초안을 저장했습니다.'); });
};
window.publishAdminDraft = async function() {
    if (!selectedDraft || !draftForm.reportValidity() || !confirm('검토한 내용을 공개 게시할까요?')) return;
    await withDraftBusy(async () => {
        if (!await saveCurrentDraft()) return;
        const result = await window.archiveAction('publishDraft', { id: selectedDraft.id, version: selectedDraft.version });
        if (!result) return;
        updateSavedDraft(result.draft);
        window.evidences = window.mergeEvidenceItems([result.post]);
        window.loadCategoryCounts?.();
        showNotification('게시글을 등록했습니다.');
    });
};
window.deleteAdminDraft = async function() {
    if (!selectedDraft || !confirm('이 초안을 삭제할까요?')) return;
    await withDraftBusy(async () => {
        const result = await window.archiveAction('deleteDraft', { id: selectedDraft.id, version: selectedDraft.version });
        if (!result) return;
        adminDrafts = adminDrafts.filter(item => item.id !== selectedDraft.id);
        selectAdminDraft(adminDrafts[0] || null);
        showNotification('초안을 삭제했습니다.');
    });
};
