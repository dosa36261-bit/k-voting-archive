// Run: node scripts/check-ui.mjs (requires the local Playwright dev dependency and Chrome).
// Firebase is removed from the test page; no production reads or writes are made.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const html = await readFile(path.join(root, 'index.html'), 'utf8');
const css = await readFile(path.join(root, 'styles.css'), 'utf8');
const adminJs = await readFile(path.join(root, 'admin.js'), 'utf8');
const moduleSource = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const isolatedHtml = html.replace(/<script type="module">[\s\S]*?<\/script>/, '');
const output = process.env.UI_CHECK_OUTPUT;
if (output) await mkdir(output, { recursive: true });

// A response started in category A must never mutate category B's cursor or data.
async function checkPaginationRace() {
    const requests = [];
    const applied = [];
    const win = {
        categoryPagination: { initialized: false }, currentSortMode: 'updated', evidences: [],
        renderCategoryGrid() {}, applyFetchedEvidences(items) { applied.push(items); }
    };
    const context = vm.createContext({
        window: win, console,
        initializeApp: () => ({}), getFirestore: () => ({}), getStorage: () => ({}),
        getAuth: () => ({}), getFunctions: () => ({}), httpsCallable: () => ({}),
        collection: () => ({}), where: (...parts) => parts, query: (...parts) => parts,
        orderBy: (...parts) => parts, documentId: () => '__name__', limit: n => n, startAfter: value => value,
        getDocs: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
    });
    new vm.Script(moduleSource.replace(/^\s*import .*?;$/gm, '').replace('        startApp();', '')).runInContext(context);
    const first = win.loadCategoryEvidenceBatch('shape-memory', { reset: true });
    const second = win.loadCategoryEvidenceBatch('etc', { reset: true });
    const snapshot = id => ({ docs: [{ id, data: () => ({ category: 'etc', title: '테스트' }) }], forEach(fn) { fn({ id, data: () => ({ category: 'etc', title: '테스트' }) }); } });
    requests[1].resolve(snapshot('new-category'));
    await second;
    requests[0].resolve(snapshot('old-category'));
    await first;
    assert.equal(win.categoryPagination.category, 'etc');
    assert.equal(win.categoryPagination.cursors.etc.id, 'new-category');
    assert.equal(applied.length, 1);
    const failing = win.loadCategoryEvidenceBatch('etc');
    requests[2].reject(new Error('Simulated ordered query failure'));
    await new Promise(resolve => setImmediate(resolve));
    requests[3].reject(new Error('Simulated fallback failure'));
    await assert.rejects(failing);
    assert.equal(win.categoryPagination.error, true);
    assert.equal(win.categoryPagination.isLoading, false);
    // The extra document is a look-ahead, not part of the rendered page.
    for (const size of [24, 25]) {
        const pending = win.loadCategoryEvidenceBatch('etc', { reset: true });
        const docs = Array.from({ length: size }, (_, n) => ({ id: `boundary-${n}`, data: () => ({ category: 'etc', title: '경계' }) }));
        requests.at(-1).resolve({ docs });
        const fetched = await pending;
        assert.equal(fetched.length, 24);
        assert.equal(win.categoryPagination.cursors.etc.id, 'boundary-23');
        assert.equal(win.hasMoreCategoryEvidence(), size === 25);
    }

}
await checkPaginationRace();

const server = createServer((req, res) => {
    if (req.url.startsWith('/admin.js')) { res.setHeader('Content-Type', 'text/javascript'); res.end(adminJs); return; }
    if (req.url.startsWith('/styles.css')) { res.setHeader('Content-Type', 'text/css'); res.end(css); return; }
    if (req.url === '/fixture.svg') {
        res.setHeader('Content-Type', 'image/svg+xml');
        res.end('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#e2e8f0"/><rect x="140" y="70" width="520" height="460" rx="12" fill="white"/><path d="M200 160h360M200 230h300M200 300h330M200 370h250" stroke="#94a3b8" stroke-width="18"/></svg>');
        return;
    }
    if (req.url === '/QR.png' || req.url === '/uploadGuide.mp4') { res.end(); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(isolatedHtml);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => dialog.dismiss());
const categories = ['shape-memory', 'strange-ballot', 'bad-management', 'nec-admin', 'etc', 'free-board'];
const fixture = Array.from({ length: 12 }, (_, index) => ({
    id: index === 0 ? `ev-quote'\";window.__xss=1;//` : `ev-${index}`,
    title: index === 0 ? '긴 제목과 특수문자 <테스트> & 따옴표가 포함된 기록의 표시와 상세 보기 확인' : `자료 화면 확인 ${index + 1}`,
    category: categories[index % categories.length], images: [`${base}/fixture.svg`],
    desc: '자료 내용을 확인하는 테스트입니다.\nhttps://example.com/view?id=1&no=2',
    source: index === 0 ? '매우 긴 출처 '.repeat(20) : '화면 점검용 자료',
    likes: index, comments: [], createdAt: `2026-10-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
}));

async function seed() {
    await page.evaluate(items => {
        window.evidences = items;
        window.mergeEvidenceItems = incoming => [...new Map([...window.evidences, ...incoming].map(item => [item.id, item])).values()];
        window.hasReceivedEvidenceSnapshot = true;
        window.hasVisibleEvidenceData = true;
        window.categoryCounts = Object.fromEntries(['shape-memory','strange-ballot','bad-management','nec-admin','etc','free-board'].map(cat => [cat, 2]));
        window.updateCategoryCounters(); window.renderHeroSlider();
    }, fixture);
}
async function screenshot(name) {
    if (!output) return;
    await page.waitForTimeout(80);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(50);
    await page.screenshot({ path: path.join(output, name + '.png'), fullPage: !/^(post|upload)-/.test(name) });
}
async function noOverflow(name) {
    const sizes = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth,
        clipped: [...document.querySelectorAll('[role="dialog"]:not(.hidden) > div, #lightbox-modal:not(.hidden) .overflow-y-auto')].some(node => node.scrollWidth > node.clientWidth + 1)
    }));
    assert.ok(sizes.document <= sizes.viewport, `${name}: ${JSON.stringify(sizes)}`);
    assert.equal(sizes.clipped, false, `${name}: dialog content overflows`);
}
const audits = [];
async function audit(name) {
    if (!process.env.UI_AXE_PATH) return;
    if (!await page.evaluate(() => !!window.axe)) await page.addScriptTag({ path: process.env.UI_AXE_PATH });
    const result = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } }));
    audits.push({ name, violations: result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })) });
    if (result.violations.length) console.log(JSON.stringify(audits.at(-1), null, 2));
}

try {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => getComputedStyle(document.getElementById('page-category')).display === 'none');
    await seed();
    const firstHero = await page.locator('.hero-card.is-current h3').innerText();
    await page.getByRole('button', { name: '다음 추천 자료' }).click();
    await page.getByRole('button', { name: '이전 추천 자료' }).click();
    assert.equal(await page.locator('.hero-card.is-current h3').innerText(), firstHero);
    assert.equal(await page.locator('.hero-card:not(.is-current)').first().evaluate(el => el.inert), true);
    const square = await page.locator('.hero-card.is-current .hero-image-link').boundingBox();
    assert.ok(Math.abs(square.width - square.height) < 1);
    await audit('home');
    await page.locator('[data-category="all-posts"]').focus();
    await page.keyboard.press('Enter');
    await page.locator('.evidence-card').first().waitFor();
    assert.equal(await page.locator('.evidence-card').count(), 12);
    assert.equal(await page.locator('.evidence-card').first().evaluate(el => Math.round(el.getBoundingClientRect().width)), 296);
    await audit('category');
    await page.locator('#cat-badge').focus();
    await page.evaluate(() => scrollTo(0, 700));
    await page.waitForFunction(() => document.getElementById('site-header').classList.contains('header-hidden'));
    await page.evaluate(() => scrollTo(0, 600));
    await page.waitForFunction(() => !document.getElementById('site-header').classList.contains('header-hidden'));
    await page.evaluate(() => scrollTo(0, 800));
    await page.waitForFunction(() => document.getElementById('site-header').classList.contains('header-hidden'));
    await page.locator('#main-upload-button').focus();
    assert.equal(await page.locator('#site-header').evaluate(el => el.classList.contains('header-hidden')), false);
    await page.evaluate(() => scrollTo(0, 0));

    await page.locator('#grid-search-input').fill('存在しない検索');
    assert.equal(await page.locator('.evidence-card').count(), 0);
    assert.equal(await page.locator('#gallery-empty-action').innerText(), '검색 초기화');
    await page.locator('#gallery-empty-action').click();
    assert.equal(await page.locator('.evidence-card').count(), 12);
    await page.evaluate(() => {
        window.evidences = [];
        window.categoryPagination = { category: 'all-posts', isLoading: true };
        window.renderCategoryGrid();
    });
    assert.equal(await page.locator('#gallery-empty-title').innerText(), '자료를 불러오고 있습니다');
    await page.evaluate(() => {
        window.categoryPagination.isLoading = false;
        window.categoryPagination.error = true;
        window.renderCategoryGrid();
    });
    assert.equal(await page.locator('#gallery-empty-action').innerText(), '다시 불러오기');
    await audit('category-load-error');
    await seed();
    await page.evaluate(() => { window.categoryPagination = { initialized: false, isLoading: false }; window.renderCategoryGrid(); });

    const unusualLink = page.locator('.evidence-card a').filter({ hasText: '긴 제목과 특수문자' });
    await unusualLink.focus(); await page.keyboard.press('Enter');
    await page.locator('#lightbox-modal:not(.hidden)').waitFor();
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    assert.equal(await page.locator('#main-content').evaluate(node => node.inert), true);
    assert.equal(await page.locator('#lightbox-desc a').getAttribute('href'), 'https://example.com/view?id=1&no=2');
    await audit('post');
    await page.locator('#comment-form button[type="submit"]').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '이전 게시글');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement.type), 'submit');

    // Failed saves must leave the current model untouched; concurrent likes save once.
    const likes = await page.evaluate(async () => {
        const item = window.currentGridEvidences[window.currentLightboxIndex];
        const original = item.likes;
        window.archiveAction = async () => null;
        await window.likeCurrentPost();
        const afterFailure = item.likes;
        let resolve, calls = 0;
        window.archiveAction = () => { calls++; return new Promise(done => { resolve = done; }); };
        const pending = window.likeCurrentPost();
        await window.likeCurrentPost();
        resolve({ post: { likes: original + 1 } }); await pending;
        return { original, afterFailure, afterSuccess: item.likes, calls };
    });
    assert.equal(likes.afterFailure, likes.original);
    assert.equal(likes.afterSuccess, likes.original + 1);
    assert.equal(likes.calls, 1);
    await page.locator('#comment-text').fill('저장 실패 확인');
    await page.locator('#comment-password').fill('1234');
    await page.evaluate(() => { window.archiveAction = async () => null; });
    await page.locator('#comment-form button[type="submit"]').click();
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.currentGridEvidences[window.currentLightboxIndex].comments.length), 0);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#main-content').evaluate(node => node.inert), false);
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.postId), fixture[0].id);
    // Regression: a closed modal must stay closed when infinite scrolling merges a batch.
    assert.equal(await page.evaluate(() => !!history.state?.lightboxPost), false);
    await page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
        window.applyFetchedEvidences([{ id: 'next-page', category: 'all-posts', title: '페이지 추가', images: [] }], { allowEmpty: true });
    });
    await page.waitForTimeout(80);
    assert.equal(await page.locator('#lightbox-modal').isVisible(), false);
    await unusualLink.click();
    await page.goBack();
    await page.waitForFunction(() => document.getElementById('lightbox-modal').classList.contains('hidden'));
    await page.goForward();
    await page.locator('#lightbox-modal:not(.hidden)').waitFor();
    await page.locator('[aria-label="다음 게시글"]').click();
    assert.equal(await page.evaluate(() => history.state.lightboxPost), await page.locator('#lightbox-item-id').innerText());
    await page.keyboard.press('Escape');
    await page.evaluate(async () => {
        let resolve;
        window.loadEvidenceById = () => new Promise(done => { resolve = done; });
        const request = window.openLightboxDirectly('late-post');
        window.goHome();
        resolve({ id: 'late-post', category: 'etc', title: '늦은 응답', images: [] });
        await request;
        delete window.loadEvidenceById;
    });
    assert.equal(await page.locator('#lightbox-modal').isVisible(), false);
    await page.evaluate(() => {
        window.selectCategory('all-posts');
        window.hasMoreCategoryEvidence = () => false;
        window.categoryPagination = { category: 'all-posts', initialized: true, isLoading: false, hasMore: { all: false } };
        window.updateLoadMoreControl();
    });
    assert.equal(await page.locator('#load-more-button').isVisible(), false);
    assert.equal(await page.locator('#feed-status-text').innerText(), '마지막 게시글입니다.');
    await page.evaluate(() => window.goHome());
    await page.goBack();
    await page.locator('#page-category:not(.hidden)').waitFor();
    assert.equal(await page.evaluate(() => window.selectedCategoryKey), 'all-posts');



    for (const width of [320, 390, 768, 1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: 950 });
        await page.evaluate(() => window.goHome());
        await noOverflow(`home ${width}`);
        if (width === 390 || width === 1440) await screenshot(`home-${width}`);
        await page.locator('[data-category="all-posts"]').click();
        await noOverflow(`category ${width}`);
        if (width === 390 || width === 1440) await screenshot(`category-${width}`);
        await page.locator('.evidence-card a').filter({ hasText: '긴 제목과 특수문자' }).click();
        await noOverflow(`post ${width}`);
        assert.equal(await page.locator('#lightbox-body > .overflow-y-auto').evaluate(node => node.scrollTop), 0);
        assert.ok(await page.locator('[aria-label="게시글 닫기"]').isVisible());
        const panel = await page.locator('#lightbox-body').boundingBox();
        assert.equal(panel.y, 0);
        assert.equal(panel.height, 950);
        if (width === 390) { await screenshot('post-390'); await audit('post-mobile'); }
        await page.keyboard.press('Escape');
        await page.locator('#main-upload-button').click();
        await noOverflow(`upload ${width}`);
        if (width === 390) { await screenshot('upload-390'); await audit('upload-mobile'); }
        assert.equal(await page.locator('#form-title').evaluate(el => el.labels.length), 1);
        await page.keyboard.press('Escape');
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('#main-upload-button').click();
    const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5j8AAAAASUVORK5CYII=', 'base64');
    await page.locator('#form-files').setInputFiles([
        { name: 'first.png', mimeType: 'image/png', buffer: pixel },
        { name: 'second.png', mimeType: 'image/png', buffer: pixel }
    ]);
    await page.getByRole('button', { name: '이미지 2 앞으로 이동' }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => localUploadedFileList[0].name), 'second.png');
    await audit('upload-with-files');
    await page.keyboard.press('Escape');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const [trigger, modal] of [['이용안내', 'guide-modal'], ['QR코드', 'qr-modal'], ['업로드 방법', 'upload-guide-modal']]) {
        await page.locator('.header-nav').getByRole('button', { name: trigger }).click();
        await page.locator(`#${modal}:not(.hidden)`).waitFor();
        assert.ok(await page.evaluate(id => document.getElementById(id).contains(document.activeElement), modal));
        await noOverflow(modal);
        await audit(modal);
        if (modal === 'upload-guide-modal') assert.equal(await page.locator('#upload-guide-modal video').evaluate(el => el.paused), true);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(40);
        assert.ok((await page.evaluate(() => document.activeElement.textContent)).includes(trigger));
    }
    await page.locator('#admin-entry-button').click();
    await audit('admin');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '버그제보 / 건의' }).click();
    assert.equal(await page.locator('#sort-select').isVisible(), false);
    assert.equal(await page.locator('#gallery-empty-action').innerText(), '문의 작성');
    await audit('feedback-empty');
    // Exercise the human review workflow with a mocked API; no production writes.
    await page.evaluate(() => {
        window.__drafts = [];
        window.archiveAction = async (action, payload = {}) => {
            if (action === 'adminLogin') return { token: 'fixture' };
            if (action === 'listDrafts') return { drafts: structuredClone(window.__drafts) };
            if (action === 'importDrafts') {
                const drafts = payload.drafts.map((draft, index) => ({ ...draft, id: `draft-${index}`, status: 'draft', version: 1 }));
                window.__drafts.push(...drafts); return { drafts: structuredClone(drafts) };
            }
            const draft = window.__drafts.find(item => item.id === payload.id);
            if (action === 'saveDraft') { Object.assign(draft, payload.draft, { version: draft.version + 1 }); return { draft: structuredClone(draft) }; }
            if (action === 'publishDraft') { Object.assign(draft, { status: 'published', postId: 'ev-published' }); return { draft, post: { ...draft, id: 'ev-published' } }; }
        };
    });
    await page.locator('#admin-entry-button').click();
    await page.locator('#admin-pass-input').fill('fixture');
    await page.locator('#admin-modal button[type=submit]').click();
    await page.locator('#page-admin:not(.hidden)').waitFor();
    await page.locator('#draft-import-file').setInputFiles({ name: 'drafts.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ drafts: [{ title: 'AI 초안 검토', category: 'free-board', desc: '내용', source: '', images: [base + '/fixture.svg'], mediaLinks: [], reviewNotes: '검토 메모' }] })) });
    await page.locator('#admin-draft-form:not(.hidden)').waitFor();
    await page.locator('#draft-title').fill('검토를 마친 제목');
    await page.locator('#draft-save-button').click();
    assert.equal(await page.locator('#admin-draft-list strong').innerText(), '검토를 마친 제목');
    await page.evaluate(() => window.setAdminFeedback([{ id: 'pending-feedback', title: '미답변 문의', comments: [] }, { id: 'answered', title: '답변됨', comments: [{ isAdmin: true }] }]));
    assert.equal(await page.locator('#admin-feedback-count').innerText(), '1');
    assert.equal(await page.locator('#feedback-alert-dot').isVisible(), true);
    await audit('admin-workspace');
    await screenshot('admin-1440');
    await page.setViewportSize({ width: 390, height: 950 });
    await noOverflow('admin mobile');
    await audit('admin-workspace-mobile');
    await screenshot('admin-390');
    await page.evaluate(() => window.setAdminFeedback([{ id: 'pending-feedback', comments: [{ isAdmin: true }] }]));
    assert.equal(await page.locator('#feedback-alert-dot').isVisible(), false);
    page.removeAllListeners('dialog'); page.on('dialog', dialog => dialog.accept());
    await page.locator('#draft-publish-button').click();
    await page.locator('#draft-published-link:not(.hidden)').waitFor();
    assert.equal(await page.locator('#draft-title').isDisabled(), true);

    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: ['pagination race, recovery and 24/25 boundary', 'closed-post scroll regression', 'direction-aware header and focus reveal', 'back/forward and stale post fetch', 'private draft review UI and feedback badges', 'native keyboard navigation', 'special-character IDs', 'search and empty recovery', 'dialog focus trap and restore', 'failed saves and duplicate likes', '6 responsive widths', 'keyboard upload reordering', 'reduced-motion video', 'help and feedback dialogs'], audits }, null, 2));
    assert.equal(audits.reduce((total, item) => total + item.violations.length, 0), 0, 'Accessibility violations remain; see audit output.');
} finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}
