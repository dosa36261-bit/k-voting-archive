// Private drafts are read/written only through the server-verified admin session.
let adminDrafts = [];
let selectedDraft = null;
let draftBusy = false;
let draftDirty = false;
let draftLoadRequest = 0;
let draftLoading = false;
let activeDraftReviewState = 'draft';
const draftReviewLabels = { draft: '초안', hold: '보류', waiting: '대기' };
const draftForm = document.getElementById('admin-draft-form');
const draftStatus = document.getElementById('draft-status');
document.getElementById('draft-category').innerHTML = CATEGORY_KEYS.map(key => `<option value="${key}">${getCategoryLabel(key)}</option>`).join('');
draftForm.addEventListener('input', event => { draftDirty = true; if (event.target.matches('textarea')) resizeDraftTextarea(event.target); });
function resizeDraftTextarea(field) {
    if (!field.getClientRects().length) return;
    field.style.height = 'auto';
    const style = getComputedStyle(field);
    field.style.height = `${field.scrollHeight + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)}px`;
}
function resizeDraftTextareas() { draftForm.querySelectorAll('textarea').forEach(resizeDraftTextarea); }
let draftFormWidth = 0;
new ResizeObserver(entries => {
    const width = entries[0].contentRect.width;
    if (width > 0 && Math.abs(width - draftFormWidth) > .5) { draftFormWidth = width; resizeDraftTextareas(); }
}).observe(draftForm);
document.fonts?.ready.then(resizeDraftTextareas);
let draftPreviewTimer;
let draftPreviewUrls = [];
let draftImageIndex = 0;
document.getElementById('draft-images').addEventListener('input', () => {
    clearTimeout(draftPreviewTimer);
    draftPreviewTimer = setTimeout(renderDraftImages, 350);
});

function renderDraftImages() {
    clearTimeout(draftPreviewTimer);
    const lines = document.getElementById('draft-images').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    const valid = lines.filter(value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; } });
    draftPreviewUrls = valid.slice(0, 20);
    const list = document.getElementById('draft-image-previews');
    list.replaceChildren();
    document.getElementById('draft-image-count').textContent = draftPreviewUrls.length ? `${draftPreviewUrls.length}장` : '';
    document.getElementById('draft-image-status').textContent = lines.length !== valid.length ? '표시할 수 없는 사진이 있습니다. 등록된 사진 정보를 확인해주세요.' : valid.length > 20 ? '이미지는 최대 20장까지 표시합니다.' : valid.length ? '첫 사진이 썸네일입니다. 사진을 누르면 크게 볼 수 있습니다.' : '등록된 사진이 없습니다.';
    draftPreviewUrls.forEach((url, index) => {
        const card = document.createElement('div');
        card.className = 'draft-image-card'; card.dataset.primary = String(index === 0);
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'draft-image-preview';
        button.setAttribute('aria-label', `초안 이미지 ${index + 1} 확대`);
        const img = document.createElement('img');
        img.alt = `검토용 이미지 ${index + 1}`; img.referrerPolicy = 'no-referrer'; img.loading = 'lazy';
        const caption = document.createElement('span'); caption.textContent = index === 0 ? '대표 썸네일 · 확대 보기' : `이미지 ${index + 1} · 확대 보기`;
        img.onerror = () => { img.classList.add('hidden'); caption.textContent = `이미지 ${index + 1} · 불러오기 실패`; button.classList.add('image-failed'); };
        img.src = url;
        button.append(img, caption); button.onclick = () => openDraftImage(index); card.appendChild(button);
        if (index > 0 && selectedDraft?.status !== 'published') {
            const choose = document.createElement('button');
            choose.type = 'button'; choose.className = 'draft-thumbnail-button'; choose.textContent = '썸네일로 지정';
            choose.setAttribute('aria-label', `이미지 ${index + 1}을 썸네일로 지정`);
            choose.disabled = draftBusy; choose.onclick = () => setDraftThumbnail(index); card.appendChild(choose);
        }
        list.appendChild(card);
    });
}
window.setDraftThumbnail = function(index) {
    if (draftBusy || !selectedDraft || selectedDraft.status === 'published' || index < 1 || !draftPreviewUrls[index]) return;
    const images = [...draftPreviewUrls];
    images.unshift(...images.splice(index, 1));
    document.getElementById('draft-images').value = images.join('\n');
    draftDirty = true; renderDraftImages();
    document.querySelector('.draft-image-preview')?.focus({ preventScroll: true });
    showNotification('대표 썸네일을 바꿨습니다. 저장하면 적용됩니다.');
};
window.openDraftImage = function(index) {
    if (!isAdminLoggedIn || !draftPreviewUrls[index]) return;
    draftImageIndex = index;
    const img = document.getElementById('draft-viewer-image');
    const error = document.getElementById('draft-viewer-error');
    const zoom = document.getElementById('draft-image-zoom');
    img.classList.remove('hidden'); error.classList.add('hidden');
    document.getElementById('draft-viewer-stage').classList.remove('actual-size');
    zoom.setAttribute('aria-pressed', 'false'); zoom.textContent = '원본 크기'; zoom.disabled = false;
    img.alt = `초안 검토용 이미지 ${index + 1}`;
    img.onerror = () => { img.classList.add('hidden'); error.classList.remove('hidden'); zoom.disabled = true; };
    img.src = draftPreviewUrls[index];
    document.getElementById('draft-image-original').href = draftPreviewUrls[index];
    document.getElementById('draft-viewer-position').textContent = `${index + 1} / ${draftPreviewUrls.length}`;
    document.getElementById('draft-image-prev').disabled = document.getElementById('draft-image-next').disabled = draftPreviewUrls.length < 2;
    setModalOpen('draft-image-modal', true);
};
window.closeDraftImage = function() { setModalOpen('draft-image-modal', false); document.getElementById('draft-viewer-image').removeAttribute('src'); };
window.stepDraftImage = function(step) { if (draftPreviewUrls.length > 1) openDraftImage((draftImageIndex + step + draftPreviewUrls.length) % draftPreviewUrls.length); };
window.toggleDraftImageZoom = function() {
    const actual = document.getElementById('draft-viewer-stage').classList.toggle('actual-size');
    const button = document.getElementById('draft-image-zoom');
    button.textContent = actual ? '화면에 맞추기' : '원본 크기'; button.setAttribute('aria-pressed', String(actual));
};
document.addEventListener('keydown', event => {
    if (document.getElementById('draft-image-modal').classList.contains('hidden') || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); stepDraftImage(event.key === 'ArrowLeft' ? -1 : 1);
});
window.resetDraftWorkspace = function() {
    ++draftLoadRequest; clearTimeout(draftPreviewTimer); closeDraftImage();
    adminDrafts = []; selectedDraft = null; draftDirty = false; draftPreviewUrls = []; activeDraftReviewState = 'draft';
    draftForm.reset(); document.getElementById('draft-image-previews').replaceChildren();
    document.getElementById('draft-images').value = '';
    draftForm.classList.add('hidden'); document.getElementById('draft-published-history').open = false;
    renderAdminDraftList();
};

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
function getDraftReviewState(draft) { return Object.hasOwn(draftReviewLabels, draft?.reviewState) ? draft.reviewState : 'draft'; }
function draftsInReviewState(state = activeDraftReviewState) { return adminDrafts.filter(item => item.status === 'draft' && getDraftReviewState(item) === state); }
window.setDraftReviewTab = function(state) {
    if (draftBusy || !Object.hasOwn(draftReviewLabels, state) || !allowDraftSwitch()) return false;
    activeDraftReviewState = state;
    selectAdminDraft(draftsInReviewState()[0] || null);
    return true;
};
document.getElementById('draft-review-tabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const states = Object.keys(draftReviewLabels);
    const current = states.indexOf(activeDraftReviewState);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? states.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + states.length) % states.length;
    if (setDraftReviewTab(states[next])) document.getElementById(`draft-tab-${states[next]}`).focus();
});
window.loadAdminDrafts = async function() {
    if (draftBusy || !allowDraftSwitch()) return;
    ++draftLoadRequest;
    draftLoading = true;
    draftStatus.textContent = '초안을 불러오는 중…';
    try {
        await withDraftBusy(async isCurrent => {
            const result = await window.archiveAction('listDrafts');
            if (!isCurrent()) return;
            if (!result) { draftStatus.textContent = '초안을 불러오지 못했습니다. 새로고침을 눌러 다시 시도해주세요.'; return; }
            adminDrafts = result.drafts;
            const previous = adminDrafts.find(item => item.id === selectedDraft?.id);
            const visible = previous?.status === 'published' || (previous && getDraftReviewState(previous) === activeDraftReviewState);
            selectAdminDraft((visible && previous) || draftsInReviewState()[0] || null);
        });
    } finally { draftLoading = false; updateDraftControls(); }
};

function renderAdminDraftList() {
    const list = document.getElementById('admin-draft-list');
    const historyList = document.getElementById('admin-published-list');
    list.replaceChildren();
    historyList.replaceChildren();
    const visible = draftsInReviewState();
    const published = adminDrafts.filter(item => item.status === 'published');
    for (const [state] of Object.entries(draftReviewLabels)) {
        const tab = document.getElementById(`draft-tab-${state}`);
        tab.setAttribute('aria-selected', String(state === activeDraftReviewState));
        tab.tabIndex = state === activeDraftReviewState ? 0 : -1;
        tab.querySelector('[data-review-count]').textContent = draftsInReviewState(state).length;
    }
    document.getElementById('draft-review-panel').setAttribute('aria-labelledby', `draft-tab-${activeDraftReviewState}`);
    function appendItem(item, target) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.draftId = item.id;
        button.setAttribute('aria-pressed', String(selectedDraft?.id === item.id));
        button.innerHTML = `<strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(getCategoryLabel(item.category))}</span>`;
        button.onclick = () => { if (!draftBusy && allowDraftSwitch()) selectAdminDraft(item); };
        target.appendChild(button);
    }
    visible.forEach(item => appendItem(item, list));
    published.forEach(item => appendItem(item, historyList));
    if (!visible.length) {
        const empty = document.createElement('p');
        empty.className = 'draft-list-empty'; empty.textContent = `${draftReviewLabels[activeDraftReviewState]}에 등록된 글이 없습니다.`;
        list.appendChild(empty);
    }
    document.getElementById('draft-published-history').classList.toggle('hidden', !published.length);
    document.getElementById('draft-published-count').textContent = published.length;
    draftStatus.textContent = `${draftReviewLabels[activeDraftReviewState]} ${visible.length}개 · 전체 ${adminDrafts.filter(item => item.status === 'draft').length}개`;
    updateDraftControls();
}
function selectAdminDraft(draft) {
    closeDraftImage();
    selectedDraft = draft;
    draftDirty = false;
    draftForm.classList.toggle('hidden', !draft);
    document.getElementById('draft-empty').classList.toggle('hidden', !!draft);
    document.getElementById('draft-empty').textContent = `${draftReviewLabels[activeDraftReviewState]}에 등록된 글이 없습니다. 다른 탭을 선택하거나 새 초안을 만드세요.`;
    if (draft) {
        for (const [id, key] of [['title','title'],['category','category'],['desc','desc'],['source','source'],['notes','reviewNotes']]) document.getElementById(`draft-${id}`).value = draft[key] || '';
        document.getElementById('draft-images').value = (draft.images || []).join('\n');
        document.getElementById('draft-media').value = (draft.mediaLinks || []).join('\n');
        renderDraftImages();
        const published = draft.status === 'published';
        const link = document.getElementById('draft-published-link');
        link.classList.toggle('hidden', !published);
        link.href = `?post=${encodeURIComponent(draft.postId || '')}`;
        if (published) document.getElementById('draft-published-history').open = true;
        resizeDraftTextareas();
    } else {
        draftForm.reset(); document.getElementById('draft-images').value = '';
        draftPreviewUrls = []; document.getElementById('draft-image-previews').replaceChildren();
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
function updateDraftControls() {
    const published = selectedDraft?.status === 'published';
    document.getElementById('draft-fields').disabled = draftBusy || published;
    document.querySelector('.draft-actions').classList.toggle('hidden', published);
    document.getElementById('draft-review-actions').classList.toggle('hidden', published);
    document.querySelectorAll('.draft-actions button, .admin-toolbar button, .draft-thumbnail-button').forEach(button => { button.disabled = draftBusy; });
    document.querySelectorAll('[data-review-state]').forEach(button => {
        const active = button.dataset.reviewState === getDraftReviewState(selectedDraft);
        button.disabled = draftBusy || published || active;
        button.setAttribute('aria-pressed', String(active));
        button.title = `${draftReviewLabels[button.dataset.reviewState]}로 이동`;
    });
    document.getElementById('draft-refresh-button').setAttribute('aria-busy', String(draftLoading));
}
async function withDraftBusy(callback) {
    if (draftBusy) return;
    const request = draftLoadRequest;
    const isCurrent = () => request === draftLoadRequest && isAdminLoggedIn;
    draftBusy = true;
    updateDraftControls();
    try { await callback(isCurrent); }
    catch (error) { if (isCurrent()) draftStatus.textContent = error.message || '요청을 처리하지 못했습니다.'; }
    finally { draftBusy = false; updateDraftControls(); }
}
window.newAdminDraft = async function() {
    if (draftBusy || !allowDraftSwitch()) return;
    await withDraftBusy(async isCurrent => {
        const result = await window.archiveAction('importDrafts', { drafts: [{ title: '새 초안', category: 'free-board', desc: '', source: '', images: [], mediaLinks: [], reviewNotes: '' }] });
        if (result && isCurrent()) { activeDraftReviewState = 'draft'; adminDrafts.unshift(...result.drafts); selectAdminDraft(result.drafts[0]); }
    });
    document.getElementById('draft-title').focus();
};
async function saveCurrentDraft(isCurrent) {
    const result = await window.archiveAction('saveDraft', { id: selectedDraft.id, version: selectedDraft.version, draft: currentDraftContent() });
    if (!isCurrent()) return null;
    if (result) updateSavedDraft(result.draft);
    return result;
}
window.saveAdminDraft = async function(event) {
    event.preventDefault();
    if (!selectedDraft || !draftForm.reportValidity()) return;
    await withDraftBusy(async isCurrent => { if (await saveCurrentDraft(isCurrent)) showNotification('초안을 저장했습니다.'); });
};
window.moveAdminDraft = async function(state) {
    if (draftBusy || !selectedDraft || selectedDraft.status !== 'draft' || !Object.hasOwn(draftReviewLabels, state) || state === getDraftReviewState(selectedDraft) || !draftForm.reportValidity()) return;
    const previousIndex = draftsInReviewState().findIndex(item => item.id === selectedDraft.id);
    let moved = false;
    await withDraftBusy(async isCurrent => {
        const result = await window.archiveAction('moveDraft', { id: selectedDraft.id, version: selectedDraft.version, reviewState: state, draft: currentDraftContent() });
        if (!result || !isCurrent()) return;
        const index = adminDrafts.findIndex(item => item.id === result.draft.id);
        adminDrafts[index] = result.draft;
        const remaining = draftsInReviewState();
        selectAdminDraft(remaining[Math.min(Math.max(previousIndex, 0), remaining.length - 1)] || null);
        showNotification(`${draftReviewLabels[state]}로 옮겼습니다.`);
        moved = true;
    });
    if (moved) {
        if (selectedDraft) { draftForm.scrollIntoView({ block: 'start', behavior: 'instant' }); document.getElementById('draft-title').focus({ preventScroll: true }); }
        else document.getElementById(`draft-tab-${activeDraftReviewState}`).focus();
    }
};
window.publishAdminDraft = async function() {
    if (!selectedDraft || !draftForm.reportValidity() || !confirm('검토한 내용을 공개 게시할까요?')) return;
    await withDraftBusy(async isCurrent => {
        if (!await saveCurrentDraft(isCurrent)) return;
        const result = await window.archiveAction('publishDraft', { id: selectedDraft.id, version: selectedDraft.version });
        if (!result || !isCurrent()) return;
        updateSavedDraft(result.draft);
        window.evidences = window.mergeEvidenceItems([result.post]);
        window.loadCategoryCounts?.();
        showNotification('게시글을 등록했습니다.');
    });
};
window.deleteAdminDraft = async function() {
    if (!selectedDraft || !confirm('이 초안을 삭제할까요?')) return;
    await withDraftBusy(async isCurrent => {
        const result = await window.archiveAction('deleteDraft', { id: selectedDraft.id, version: selectedDraft.version });
        if (!result || !isCurrent()) return;
        adminDrafts = adminDrafts.filter(item => item.id !== selectedDraft.id);
        selectAdminDraft(draftsInReviewState()[0] || null);
        showNotification('초안을 삭제했습니다.');
    });
};
