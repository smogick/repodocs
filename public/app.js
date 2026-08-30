(function () {
  const state = {
    cards: [],
    filterRoot: null,
    filterStatus: null,
    query: '',
    contentMatches: null, // null = no full-text search active; else Map(cardPath -> [{file, snippets}])
    searchSeq: 0, // guards against out-of-order async search responses
    selected: null, // card object
    activeFile: null, // relative file path within card dir, e.g. 'README.md'
    dirty: false,
  };

  const ROOT_ORDER = ['projects', 'areas', 'resources', 'archive'];
  let searchDebounce = null;

  const els = {
    search: document.getElementById('search'),
    filters: document.getElementById('filters'),
    cardList: document.getElementById('card-list'),
    mainHeader: document.getElementById('main-header'),
    frontmatterBar: document.getElementById('frontmatter-bar'),
    fileTabs: document.getElementById('file-tabs'),
    editorToolbar: document.getElementById('editor-toolbar'),
    rawPane: document.getElementById('raw-pane'),
    previewPane: document.getElementById('preview-pane'),
    saveBtn: document.getElementById('save-btn'),
    reindexBtn: document.getElementById('reindex-btn'),
    saveStatus: document.getElementById('save-status'),
  };

  const ROOT_LABELS = { projects: 'Проекты', areas: 'Области', resources: 'Ресурсы', archive: 'Архив' };

  async function loadCards() {
    const res = await fetch('/api/cards');
    state.cards = await res.json();
    renderFilters();
    renderList();
  }

  function renderFilters() {
    const roots = ['projects', 'areas', 'resources', 'archive'];
    const statuses = Array.from(new Set(state.cards.map((c) => c.status))).sort();
    els.filters.innerHTML = '';
    roots.forEach((r) => {
      const chip = document.createElement('div');
      chip.className = 'filter-chip' + (state.filterRoot === r ? ' active' : '');
      chip.textContent = ROOT_LABELS[r] || r;
      chip.onclick = () => {
        state.filterRoot = state.filterRoot === r ? null : r;
        renderFilters();
        renderList();
      };
      els.filters.appendChild(chip);
    });
    statuses.forEach((s) => {
      const chip = document.createElement('div');
      chip.className = 'filter-chip' + (state.filterStatus === s ? ' active' : '');
      chip.textContent = s;
      chip.onclick = () => {
        state.filterStatus = state.filterStatus === s ? null : s;
        renderFilters();
        renderList();
      };
      els.filters.appendChild(chip);
    });
  }

  function matchesMetadata(card, q) {
    if (!q) return true;
    const hay = [card.title, card.summary, (card.tags || []).join(' '), (card.stack || []).join(' '), card.slug]
      .join(' ')
      .toLowerCase();
    return hay.includes(q.toLowerCase());
  }

  // Debounced full-text search across file contents (not just metadata).
  // Runs alongside the instant metadata filter so the list responds
  // immediately while content results fill in a moment later.
  function scheduleContentSearch(q) {
    clearTimeout(searchDebounce);
    if (!q || q.trim().length < 2) {
      state.contentMatches = null;
      renderList();
      return;
    }
    searchDebounce = setTimeout(async () => {
      const seq = ++state.searchSeq;
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (seq !== state.searchSeq) return; // a newer search superseded this one
        const map = new Map();
        (data || []).forEach((r) => map.set(r.path, r.files));
        state.contentMatches = map;
        renderList();
      } catch (err) {
        // silently ignore — metadata filter still works without full-text search
      }
    }, 250);
  }

  function renderList() {
    const q = state.query.trim();
    const visibleByRoot = ROOT_ORDER.map((root) => {
      const cards = state.cards.filter((c) => {
        if (c.root !== root) return false;
        if (state.filterRoot && c.root !== state.filterRoot) return false;
        if (state.filterStatus && c.status !== state.filterStatus) return false;
        if (!q) return true;
        const metaMatch = matchesMetadata(c, q);
        const contentMatch = state.contentMatches && state.contentMatches.has(c.path);
        return metaMatch || contentMatch;
      });
      return { root, cards };
    }).filter((g) => g.cards.length > 0);

    els.cardList.innerHTML = '';
    if (visibleByRoot.length === 0) {
      const empty = document.createElement('div');
      empty.id = 'empty-state';
      empty.textContent = 'Ничего не найдено';
      els.cardList.appendChild(empty);
      return;
    }
    visibleByRoot.forEach(({ root, cards }) => {
      const section = document.createElement('div');
      section.className = 'section-header';
      section.textContent = `${ROOT_LABELS[root] || root} · ${cards.length}`;
      els.cardList.appendChild(section);
      cards.forEach((card) => {
        const item = document.createElement('div');
        item.className = 'card-item' + (state.selected && state.selected.path === card.path ? ' selected' : '');
        const snippetsHtml = renderSnippetsFor(card);
        item.innerHTML = `
          <div class="row1">
            <div class="card-title"><span class="status-dot status-${card.status}"></span>${escapeHtml(card.title)}</div>
          </div>
          <div class="card-summary">${escapeHtml(card.summary || '')}</div>
          <div class="card-meta"><span class="type-badge">${card.type}</span>${(card.stack || []).join(', ')}</div>
          ${snippetsHtml}
        `;
        item.addEventListener('click', (e) => {
          const matchTarget = e.target.closest('.match-file');
          if (matchTarget) {
            e.stopPropagation();
            selectCard(card, matchTarget.dataset.file);
          } else {
            selectCard(card);
          }
        });
        els.cardList.appendChild(item);
      });
    });
  }

  function renderSnippetsFor(card) {
    if (!state.contentMatches || !state.contentMatches.has(card.path)) return '';
    const files = state.contentMatches.get(card.path);
    const rows = files
      .slice(0, 3)
      .map((f) => {
        const snippet = (f.snippets && f.snippets[0]) || '';
        return `<div class="match-file" data-file="${escapeHtml(f.file)}">${escapeHtml(f.file)}</div><div class="match-snippet">…${escapeHtml(snippet)}…</div>`;
      })
      .join('');
    return `<div class="card-matches">${rows}</div>`;
  }

  async function selectCard(card, preferredFile) {
    if (state.dirty && !confirm('Есть несохранённые изменения. Продолжить без сохранения?')) return;
    state.selected = card;
    state.activeFile = preferredFile || card.mainFile || 'README.md';
    state.dirty = false;
    renderList();
    renderHeader();
    renderFileTabs();
    await loadFile(state.activeFile);
  }

  function renderHeader() {
    const c = state.selected;
    if (!c) {
      els.mainHeader.innerHTML = '<div id="empty-header"></div>';
      els.frontmatterBar.innerHTML = '';
      return;
    }
    els.mainHeader.innerHTML = `<h2>${escapeHtml(c.title)}</h2><div class="sub">${c.path}</div>`;
    const links = Object.entries(c.links || {})
      .filter(([, v]) => v)
      .map(([k, v]) => `<b>${k}</b>: ${escapeHtml(v)}`)
      .join(' &nbsp;·&nbsp; ');
    els.frontmatterBar.innerHTML = `
      <span><b>status</b>: ${c.status}</span>
      <span><b>stack</b>: ${(c.stack || []).join(', ') || '—'}</span>
      <span><b>tags</b>: ${(c.tags || []).join(', ') || '—'}</span>
      <span><b>owner</b>: ${c.owner || '—'}</span>
      <span><b>updated</b>: ${c.updated || '—'}</span>
      ${links ? `<span>${links}</span>` : ''}
    `;
  }

  function renderFileTabs() {
    const c = state.selected;
    els.fileTabs.innerHTML = '';
    if (!c) return;
    const files = c.files.length ? c.files : ['README.md'];
    files.forEach((f) => {
      const tab = document.createElement('div');
      tab.className = 'file-tab' + (state.activeFile === f ? ' active' : '');
      tab.textContent = f;
      tab.onclick = async () => {
        if (state.dirty && !confirm('Есть несохранённые изменения. Продолжить без сохранения?')) return;
        state.activeFile = f;
        renderFileTabs();
        await loadFile(f);
      };
      els.fileTabs.appendChild(tab);
    });
  }

  async function loadFile(relFile) {
    const c = state.selected;
    const fullPath = `${c.baseDir}/${relFile}`;
    els.editorToolbar.style.display = 'flex';
    els.rawPane.innerHTML = '<textarea id="raw-editor">Загрузка...</textarea>';
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(fullPath)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ошибка загрузки');
      els.rawPane.innerHTML = `<textarea id="raw-editor" spellcheck="false"></textarea>`;
      const ta = document.getElementById('raw-editor');
      ta.value = data.content;
      ta.oninput = () => {
        state.dirty = true;
        els.saveStatus.textContent = 'не сохранено';
        renderPreview(ta.value);
      };
      renderPreview(data.content);
      els.saveStatus.textContent = '';
      state.dirty = false;
      setupSyncScroll(ta, els.previewPane);
    } catch (err) {
      els.rawPane.innerHTML = `<div id="empty-state">Ошибка: ${escapeHtml(String(err.message || err))}</div>`;
      els.previewPane.innerHTML = '';
    }
  }

  // Keep the raw editor and rendered preview scrolled to roughly the same
  // position (by scroll percentage, since the two don't share line numbers).
  function setupSyncScroll(source, target) {
    let syncing = false;
    function sync(from, to) {
      if (syncing) return;
      syncing = true;
      const range = from.scrollHeight - from.clientHeight;
      const ratio = range > 0 ? from.scrollTop / range : 0;
      const targetRange = to.scrollHeight - to.clientHeight;
      to.scrollTop = ratio * targetRange;
      requestAnimationFrame(() => {
        syncing = false;
      });
    }
    source.addEventListener('scroll', () => sync(source, target));
    target.addEventListener('scroll', () => sync(target, source));
  }

  async function saveCurrent() {
    const c = state.selected;
    if (!c) return;
    const ta = document.getElementById('raw-editor');
    if (!ta) return;
    const fullPath = `${c.baseDir}/${state.activeFile}`;
    els.saveStatus.textContent = 'сохранение...';
    try {
      const res = await fetch('/api/file', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: fullPath, content: ta.value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ошибка сохранения');
      state.dirty = false;
      els.saveStatus.textContent = 'сохранено ✓';
      if (state.activeFile === c.mainFile) {
        await loadCards();
        // loadCards() replaces state.cards with fresh objects; re-point
        // state.selected at the matching fresh one and re-render the
        // header/frontmatter bar so edited fields show up immediately,
        // without needing to reselect the card or reload the page.
        const refreshed = state.cards.find((x) => x.path === c.path);
        if (refreshed) {
          state.selected = refreshed;
          renderHeader();
          renderFileTabs();
        }
      }
    } catch (err) {
      els.saveStatus.textContent = 'ошибка: ' + (err.message || err);
    }
  }

  function renderPreview(md) {
    // Strip frontmatter block for preview.
    const body = md.replace(/^---\n[\s\S]*?\n---\n?/, '');
    const rawHtml = marked.parse(body, { gfm: true, breaks: false });
    els.previewPane.innerHTML = DOMPurify.sanitize(rawHtml, { ADD_ATTR: ['target'] });
    wireInternalLinks();
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // --- Internal link resolution: relative .md links in preview open inside
  // the app (switch card/file) instead of doing a full page navigation. ---

  function currentDir() {
    const c = state.selected;
    const full = `${c.baseDir}/${state.activeFile}`;
    const parts = full.split('/');
    parts.pop();
    return parts.join('/');
  }

  function resolveRelative(baseDir, rel) {
    if (/^\//.test(rel)) return rel.replace(/^\/+/, '');
    const stack = baseDir ? baseDir.split('/').filter(Boolean) : [];
    for (const part of rel.split('/')) {
      if (part === '' || part === '.') continue;
      if (part === '..') stack.pop();
      else stack.push(part);
    }
    return stack.join('/');
  }

  function findCardForPath(resolvedPath) {
    for (const c of state.cards) {
      const candidates = c.files && c.files.length ? c.files : [c.mainFile];
      for (const f of candidates) {
        if (`${c.baseDir}/${f}` === resolvedPath) return { card: c, file: f };
      }
    }
    return null;
  }

  function wireInternalLinks() {
    const anchors = els.previewPane.querySelectorAll('a[href]');
    anchors.forEach((a) => {
      const href = a.getAttribute('href');
      if (!href || /^([a-z]+:)?\/\//i.test(href) || href.startsWith('mailto:') || href.startsWith('#')) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener');
        return;
      }
      const withoutAnchor = href.split('#')[0];
      if (!withoutAnchor) return; // pure in-page anchor, leave as-is
      const resolved = resolveRelative(currentDir(), withoutAnchor);
      a.setAttribute('href', '/' + resolved);
      a.dataset.internal = resolved;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        navigateInternal(resolved);
      });
    });
  }

  async function navigateInternal(resolvedPath) {
    if (state.dirty && !confirm('Есть несохранённые изменения. Продолжить без сохранения?')) return;
    const match = findCardForPath(resolvedPath);
    if (match) {
      state.selected = match.card;
      state.activeFile = match.file;
      state.dirty = false;
      renderList();
      renderHeader();
      renderFileTabs();
      await loadFile(match.file);
      return;
    }
    // Fallback: a real repo file not tied to any indexed card (e.g. schema/, CLAUDE.md).
    const segments = resolvedPath.split('/');
    const fileName = segments.pop();
    const baseDir = segments.join('/');
    if (!/\.md$/i.test(fileName)) {
      console.warn('Ссылка ведёт не на markdown-файл, пропускаю навигацию:', resolvedPath);
      return;
    }
    state.selected = {
      title: fileName,
      path: resolvedPath,
      baseDir,
      mainFile: fileName,
      files: [fileName],
      root: '',
      type: 'file',
      status: '',
      stack: [],
      tags: [],
      owner: '',
      updated: '',
      links: {},
    };
    state.activeFile = fileName;
    state.dirty = false;
    renderList();
    renderHeader();
    renderFileTabs();
    await loadFile(fileName);
  }

  els.search.addEventListener('input', (e) => {
    state.query = e.target.value;
    renderList();
    scheduleContentSearch(state.query);
  });

  els.saveBtn.addEventListener('click', saveCurrent);
  els.reindexBtn.addEventListener('click', async () => {
    els.saveStatus.textContent = 'пересборка индекса...';
    const res = await fetch('/api/reindex', { method: 'POST' });
    const data = await res.json();
    els.saveStatus.textContent = res.ok ? 'INDEX.md обновлён ✓' : 'ошибка: ' + data.error;
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      saveCurrent();
    }
  });

  loadCards();
})();
