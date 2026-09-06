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
    originalContent: '', // content as last loaded/saved, for real change detection
    dirty: false,
    viewMode: 'cards', // 'cards' | 'trash'
    paneMode: 'editor', // 'view' | 'editor' | 'source' — set for real in initPaneModeSwitch()
    metaEditing: false, // whether the meta panel (frontmatter-bar) is in edit mode for the open file
    trashItems: [],
  };

  const ROOT_ORDER = ['projects', 'areas', 'resources', 'archive'];
  let searchDebounce = null;

  const els = {
    search: document.getElementById('search'),
    filters: document.getElementById('filters'),
    cardList: document.getElementById('card-list'),
    mainHeader: document.getElementById('main-header'),
    frontmatterBar: document.getElementById('frontmatter-bar'),
    fileTree: document.getElementById("file-tree"),
    newFileBtn: document.getElementById('new-file-btn'),
    newFolderBtn: document.getElementById('new-folder-btn'),
    editorToolbar: document.getElementById('editor-toolbar'),
    rawPane: document.getElementById('raw-pane'),
    previewPane: document.getElementById('preview-pane'),
    contentPanes: document.getElementById('content-panes'),
    paneModeSwitch: document.getElementById('pane-mode-switch'),
    saveBtn: document.getElementById('save-btn'),
    reindexBtn: document.getElementById('reindex-btn'),
    deleteBtn: document.getElementById('delete-btn'),
    saveStatus: document.getElementById('save-status'),
    themeToggle: document.getElementById('theme-toggle'),
    trashToggle: document.getElementById('trash-toggle'),
  };

  const ROOT_LABELS = { projects: 'Проекты', areas: 'Области', resources: 'Ресурсы', archive: 'Архив' };
  const ROOT_ICONS = { projects: 'layers', areas: 'folder', resources: 'book-open', archive: 'archive' };

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
    if (state.viewMode === 'trash') {
      renderTrashList();
      return;
    }
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
      section.innerHTML = `${window.icon(ROOT_ICONS[root] || 'folder', 13)}<span>${ROOT_LABELS[root] || root} · ${cards.length}</span>`;
      els.cardList.appendChild(section);
      cards.forEach((card) => {
        const item = document.createElement('div');
        item.className = 'card-item' + (state.selected && state.selected.path === card.path ? ' selected' : '');
        const snippetsHtml = renderSnippetsFor(card);
        const staleBadge = card.stale
          ? `<span class="stale-badge" title="Содержимое менялось после последнего updated — возможно, забыли обновить дату">${window.icon('triangle-alert', 12)}</span>`
          : '';
        item.innerHTML = `
          <div class="row1">
            <div class="card-title"><span class="status-dot status-${card.status}"></span>${escapeHtml(card.title)}${staleBadge}</div>
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

  async function loadTrash() {
    const res = await fetch('/api/trash');
    const data = await res.json();
    state.trashItems = data.items || [];
  }

  function renderTrashList() {
    els.cardList.innerHTML = '';
    if (!state.trashItems.length) {
      const empty = document.createElement('div');
      empty.className = 'trash-empty';
      empty.textContent = 'Корзина пуста';
      els.cardList.appendChild(empty);
      return;
    }
    const section = document.createElement('div');
    section.className = 'section-header';
    section.innerHTML = `${window.icon('trash-2', 13)}<span>Корзина · ${state.trashItems.length} · хранится 30 дней</span>`;
    els.cardList.appendChild(section);
    state.trashItems.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'trash-item';
      row.innerHTML = `
        <div class="row1">
          <div class="card-title">${escapeHtml(item.title)}</div>
          <div class="trash-item-actions">
            <button class="restore-btn" title="Восстановить">${window.icon('rotate-ccw', 13)}</button>
            <button class="purge-btn danger" title="Удалить навсегда">${window.icon('x', 13)}</button>
          </div>
        </div>
        <div class="card-summary">${escapeHtml(item.summary || '')}</div>
        <div class="trash-item-path">${escapeHtml(item.originalPath)}</div>
        <div class="trash-item-meta">удалено ${new Date(item.deletedAt).toLocaleDateString('ru-RU')} · осталось ${item.daysLeft} ${pluralDays(item.daysLeft)}</div>
      `;
      row.querySelector('.restore-btn').addEventListener('click', () => restoreTrashItem(item.trashId));
      row.querySelector('.purge-btn').addEventListener('click', () => purgeTrashItem(item.trashId, item.title));
      els.cardList.appendChild(row);
    });
  }

  function pluralDays(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'день';
    if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'дня';
    return 'дней';
  }

  async function restoreTrashItem(trashId) {
    try {
      const res = await fetch(`/api/trash/${encodeURIComponent(trashId)}/restore`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ошибка восстановления');
      await loadTrash();
      await loadCards();
      renderList();
    } catch (err) {
      alert('Не удалось восстановить: ' + (err.message || err));
    }
  }

  async function purgeTrashItem(trashId, title) {
    if (!confirm(`Удалить «${title}» навсегда? Это нельзя отменить.`)) return;
    try {
      const res = await fetch(`/api/trash/${encodeURIComponent(trashId)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ошибка удаления');
      await loadTrash();
      renderList();
    } catch (err) {
      alert('Не удалось удалить: ' + (err.message || err));
    }
  }

  async function toggleTrashView() {
    state.viewMode = state.viewMode === 'trash' ? 'cards' : 'trash';
    els.trashToggle.classList.toggle('active', state.viewMode === 'trash');
    els.filters.style.display = state.viewMode === 'trash' ? 'none' : 'flex';
    els.search.parentElement.style.display = state.viewMode === 'trash' ? 'none' : 'block';
    if (state.viewMode === 'trash') {
      // Deselect the open file — its card may be about to be deleted, and
      // showing a stale editor next to the trash list would be confusing.
      state.selected = null;
      state.activeFile = null;
      renderHeader();
      renderFileTree();
      els.editorToolbar.style.display = 'none';
      els.rawPane.innerHTML = '<div id="empty-state">Выбери карточку слева</div>';
      els.previewPane.innerHTML = '';
      history.replaceState(null, '', location.pathname + location.search);
      await loadTrash();
    }
    renderList();
  }

  async function selectCard(card, preferredFile) {
    if (state.dirty && !confirm('Есть несохранённые изменения. Продолжить без сохранения?')) return;
    state.selected = card;
    state.activeFile = preferredFile || card.mainFile || 'README.md';
    state.dirty = false;
    renderList();
    renderHeader();
    renderFileTree();
    await loadFile(state.activeFile);
  }

  // Reflects whichever file is actually open, not just the card — switching
  // files inside the tree (without switching cards) must update this too,
  // which is why loadFile() calls it on every load, not just selectCard().
  function renderHeader() {
    const c = state.selected;
    if (!c) {
      els.mainHeader.innerHTML = '<div id="empty-header"></div>';
      els.frontmatterBar.innerHTML = '';
      return;
    }
    const isMain = !state.activeFile || state.activeFile === c.mainFile;
    const fileSuffix = isMain ? '' : ` <span class="header-file">— ${escapeHtml(state.activeFile)}</span>`;
    const subPath = isMain ? c.path : `${c.path}/${state.activeFile}`;
    els.mainHeader.innerHTML = `<h2>${escapeHtml(c.title)}${fileSuffix}</h2><div class="sub">${escapeHtml(subPath)}</div>`;
    // The meta panel itself is rendered by renderMetaPanel() once the open
    // file's raw content is available (loadFile calls it) — it needs the
    // actual file, not just the card, since a sub-file has its own meta.
  }

  // --- Frontmatter read/write helpers -------------------------------
  // Deliberately NOT a general YAML parser: this repo's frontmatter is a
  // small, controlled shape (flat scalars, one array-per-line, one level
  // of nesting for `links`), so editing it via targeted line replacement
  // is much safer than a hand-rolled full reparse+reserialize, which risks
  // mangling structure it doesn't understand. Anything the form doesn't
  // touch is left byte-for-byte as it was.

  function yamlScalarLine(key, value) {
    const v = String(value ?? '').trim();
    if (v === '') return `${key}: ""`;
    const needsQuotes = /[:#\[\]{}]/.test(v) || /^\s|\s$/.test(v) || /^(true|false|null|~)$/i.test(v) || /^-?\d+(\.\d+)?$/.test(v);
    return needsQuotes ? `${key}: "${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : `${key}: ${v}`;
  }

  function yamlArrayLine(key, arr) {
    const items = (Array.isArray(arr) ? arr : String(arr || '').split(','))
      .map((s) => String(s).trim())
      .filter(Boolean);
    return `${key}: [${items.join(', ')}]`;
  }

  function unquoteYaml(v) {
    const t = v.trim();
    if (/^".*"$/.test(t)) return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    if (/^\[.*\]$/.test(t)) return t.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    return t;
  }

  function splitFrontmatterBlock(raw) {
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!m) return { hasBlock: false, lines: [], body: raw };
    return { hasBlock: true, lines: m[1].split('\n'), body: raw.slice(m[0].length) };
  }

  function joinFrontmatterBlock(lines, body) {
    if (!lines.length) return body;
    return `---\n${lines.join('\n')}\n---\n\n${body.replace(/^\n+/, '')}`;
  }

  function getTopField(lines, key) {
    const re = new RegExp(`^${key}:\\s*(.*)$`);
    for (const l of lines) {
      const m = l.match(re);
      if (m) return unquoteYaml(m[1]);
    }
    return '';
  }

  function setTopField(lines, key, valueLine) {
    const re = new RegExp(`^${key}:`);
    const idx = lines.findIndex((l) => re.test(l));
    if (idx >= 0) lines[idx] = valueLine;
    else lines.push(valueLine);
  }

  function getLinksField(lines, subKey) {
    const linksIdx = lines.findIndex((l) => /^links:/.test(l));
    if (linksIdx === -1) return '';
    let end = linksIdx + 1;
    while (end < lines.length && /^\s+\S/.test(lines[end])) end++;
    const re = new RegExp(`^\\s+${subKey}:\\s*(.*)$`);
    for (let i = linksIdx + 1; i < end; i++) {
      const m = lines[i].match(re);
      if (m) return unquoteYaml(m[1]);
    }
    return '';
  }

  function setLinksField(lines, subKey, value) {
    let linksIdx = lines.findIndex((l) => /^links:/.test(l));
    const newLine = `  ${subKey}: ${String(value ?? '').trim() === '' ? '""' : `"${String(value).trim().replace(/"/g, '\\"')}"`}`;
    if (linksIdx === -1) {
      lines.push('links:', newLine);
      return;
    }
    let end = linksIdx + 1;
    while (end < lines.length && /^\s+\S/.test(lines[end])) end++;
    const re = new RegExp(`^\\s+${subKey}:`);
    let found = false;
    for (let i = linksIdx + 1; i < end; i++) {
      if (re.test(lines[i])) {
        lines[i] = newLine;
        found = true;
        break;
      }
    }
    if (!found) lines.splice(end, 0, newLine);
  }

  const CARD_STATUS_OPTIONS = ['idea', 'active', 'paused', 'archived'];
  const SUBFILE_STATUS_OPTIONS = ['', 'draft', 'active', 'superseded', 'archived'];
  const SUBFILE_STATUS_LABELS = { '': '—', draft: 'черновик', active: 'актуально', superseded: 'заменено', archived: 'неактуально' };

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  // Renders the meta panel (#frontmatter-bar) for whatever file is
  // currently open. README/mainFile gets the full card schema (title,
  // type, status, stack, tags, owner, updated, links, summary) sourced
  // from the parsed `card` object for display and from the raw frontmatter
  // block for editing. Any other file gets a small, distinct sub-file
  // schema (status/updated/summary) parsed straight from its own raw
  // content — sub-files don't share the card's identity fields.
  function renderMetaPanel(rawContent) {
    const c = state.selected;
    if (!c) {
      els.frontmatterBar.innerHTML = '';
      return;
    }
    const isMain = state.activeFile === c.mainFile;
    const { lines, hasBlock } = splitFrontmatterBlock(rawContent || '');

    if (!state.metaEditing) {
      els.frontmatterBar.innerHTML = isMain ? renderCardMetaView(c) : renderSubfileMetaView(lines, hasBlock);
      const editBtn = els.frontmatterBar.querySelector('.meta-edit-btn');
      if (editBtn) {
        editBtn.addEventListener('click', () => {
          state.metaEditing = true;
          renderMetaPanel(document.getElementById('raw-editor')?.value ?? rawContent);
        });
      }
      return;
    }

    els.frontmatterBar.innerHTML = isMain ? renderCardMetaEdit(lines) : renderSubfileMetaEdit(lines);
    const cancelBtn = els.frontmatterBar.querySelector('.meta-cancel-btn');
    const saveBtn = els.frontmatterBar.querySelector('.meta-save-btn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        state.metaEditing = false;
        renderMetaPanel(document.getElementById('raw-editor')?.value ?? rawContent);
      });
    }
    if (saveBtn) {
      saveBtn.addEventListener('click', () => applyMetaEdit(isMain));
    }
  }

  function formatDateOnly(v) {
    const s = String(v || '');
    const m = s.match(/^\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : s;
  }

  function renderCardMetaView(c) {
    const links = Object.entries(c.links || {})
      .filter(([, v]) => v)
      .map(([k, v]) => {
        const isUrl = /^https?:\/\//i.test(v);
        const valueHtml = isUrl
          ? `<a href="${escapeHtml(v)}" target="_blank" rel="noopener">${escapeHtml(v)} ${window.icon('external-link', 11)}</a>`
          : escapeHtml(v);
        return `<b>${k}</b>: ${valueHtml}`;
      })
      .join(' &nbsp;·&nbsp; ');
    return `
      <button class="icon-btn meta-edit-btn" title="Редактировать метаданные">${window.icon('pencil', 12)}</button>
      <span><b>status</b>: ${c.status}</span>
      <span><b>stack</b>: ${(c.stack || []).join(', ') || '—'}</span>
      <span>${window.icon('tag', 11)} ${(c.tags || []).join(', ') || '—'}</span>
      <span><b>owner</b>: ${c.owner || '—'}</span>
      <span class="${c.stale ? 'stale-text' : ''}"><b>updated</b>: ${formatDateOnly(c.updated) || '—'}${c.stale ? ` ${window.icon('triangle-alert', 11)} правки новее updated` : ''}</span>
      ${links ? `<span>${links}</span>` : ''}
    `;
  }

  function renderSubfileMetaView(lines, hasBlock) {
    const status = getTopField(lines, 'status');
    const updated = getTopField(lines, 'updated');
    const summary = getTopField(lines, 'summary');
    if (!hasBlock || (!status && !updated && !summary)) {
      return `
        <button class="icon-btn meta-edit-btn" title="Добавить метаданные файла">${window.icon('pencil', 12)}</button>
        <span class="meta-empty-hint">Нет метаданных у этого файла — статус/дату/summary можно добавить отдельно от карточки</span>
      `;
    }
    return `
      <button class="icon-btn meta-edit-btn" title="Редактировать метаданные файла">${window.icon('pencil', 12)}</button>
      <span><b>статус файла</b>: ${SUBFILE_STATUS_LABELS[status] || status || '—'}</span>
      <span><b>updated</b>: ${updated || '—'}</span>
      ${summary ? `<span><b>summary</b>: ${escapeHtml(summary)}</span>` : ''}
    `;
  }

  function renderCardMetaEdit(lines) {
    const title = getTopField(lines, 'title');
    const type = getTopField(lines, 'type') || 'project';
    const status = getTopField(lines, 'status') || 'active';
    const stack = getTopField(lines, 'stack');
    const tags = getTopField(lines, 'tags');
    const owner = getTopField(lines, 'owner');
    const updated = getTopField(lines, 'updated');
    const summary = getTopField(lines, 'summary');
    const repo = getLinksField(lines, 'repo');
    const tracker = getLinksField(lines, 'tracker');
    const docs = getLinksField(lines, 'docs');
    const statusOptions = CARD_STATUS_OPTIONS.map((s) => `<option value="${s}"${s === status ? ' selected' : ''}>${s}</option>`).join('');
    return `
      <div class="meta-edit-form">
        <label>title <input data-f="title" value="${escapeHtml(title)}" /></label>
        <label>type <select data-f="type"><option value="project"${type === 'project' ? ' selected' : ''}>project</option><option value="area"${type === 'area' ? ' selected' : ''}>area</option><option value="resource"${type === 'resource' ? ' selected' : ''}>resource</option></select></label>
        <label>status <select data-f="status">${statusOptions}</select></label>
        <label>stack <input data-f="stack" value="${escapeHtml(Array.isArray(stack) ? stack.join(', ') : stack)}" placeholder="go, react, ..." /></label>
        <label>tags <input data-f="tags" value="${escapeHtml(Array.isArray(tags) ? tags.join(', ') : tags)}" placeholder="tag1, tag2, ..." /></label>
        <label>owner <input data-f="owner" value="${escapeHtml(owner)}" /></label>
        <label>updated <input data-f="updated" type="date" value="${escapeHtml(updated)}" /></label>
        <label>repo <input data-f="repo" value="${escapeHtml(repo)}" /></label>
        <label>tracker <input data-f="tracker" value="${escapeHtml(tracker)}" /></label>
        <label>docs <input data-f="docs" value="${escapeHtml(docs)}" /></label>
        <label class="meta-summary">summary <input data-f="summary" value="${escapeHtml(summary)}" /></label>
        <div class="meta-edit-actions">
          <button class="primary meta-save-btn">${window.icon('check', 12)} Сохранить</button>
          <button class="meta-cancel-btn">Отмена</button>
        </div>
      </div>
    `;
  }

  function renderSubfileMetaEdit(lines) {
    const status = getTopField(lines, 'status');
    const updated = getTopField(lines, 'updated') || todayIso();
    const summary = getTopField(lines, 'summary');
    const statusOptions = SUBFILE_STATUS_OPTIONS.map(
      (s) => `<option value="${s}"${s === status ? ' selected' : ''}>${SUBFILE_STATUS_LABELS[s]}</option>`
    ).join('');
    return `
      <div class="meta-edit-form">
        <label>статус файла <select data-f="status">${statusOptions}</select></label>
        <label>updated <input data-f="updated" type="date" value="${escapeHtml(updated)}" /></label>
        <label class="meta-summary">summary <input data-f="summary" value="${escapeHtml(summary)}" /></label>
        <div class="meta-edit-actions">
          <button class="primary meta-save-btn">${window.icon('check', 12)} Сохранить</button>
          <button class="meta-cancel-btn">Отмена</button>
        </div>
      </div>
    `;
  }

  function applyMetaEdit(isMain) {
    const ta = document.getElementById('raw-editor');
    if (!ta) return;
    const form = els.frontmatterBar.querySelector('.meta-edit-form');
    const field = (name) => form.querySelector(`[data-f="${name}"]`)?.value ?? '';
    const { lines, hasBlock, body } = splitFrontmatterBlock(ta.value);

    if (isMain) {
      setTopField(lines, 'title', yamlScalarLine('title', field('title')));
      setTopField(lines, 'type', yamlScalarLine('type', field('type')));
      setTopField(lines, 'status', yamlScalarLine('status', field('status')));
      setTopField(lines, 'stack', yamlArrayLine('stack', field('stack').split(',')));
      setTopField(lines, 'tags', yamlArrayLine('tags', field('tags').split(',')));
      setTopField(lines, 'owner', yamlScalarLine('owner', field('owner')));
      setTopField(lines, 'updated', yamlScalarLine('updated', field('updated')));
      setTopField(lines, 'summary', yamlScalarLine('summary', field('summary')));
      setLinksField(lines, 'repo', field('repo'));
      setLinksField(lines, 'tracker', field('tracker'));
      setLinksField(lines, 'docs', field('docs'));
    } else {
      const status = field('status');
      const updated = field('updated');
      const summary = field('summary');
      if (!status && !updated && !summary) {
        // nothing to keep — drop the block entirely rather than leaving an
        // empty one, since sub-file frontmatter is optional in the first place
        ta.value = body;
        ta.dispatchEvent(new Event('input'));
        state.metaEditing = false;
        saveCurrent();
        return;
      }
      if (status) setTopField(lines, 'status', yamlScalarLine('status', status));
      if (updated) setTopField(lines, 'updated', yamlScalarLine('updated', updated));
      if (summary) setTopField(lines, 'summary', yamlScalarLine('summary', summary));
    }

    ta.value = joinFrontmatterBlock(lines, body);
    ta.dispatchEvent(new Event('input'));
    state.metaEditing = false;
    saveCurrent();
  }

  // Folder paths currently collapsed, per card (cardPath -> Set<folderPath>).
  // Folders default to expanded — nothing here until the user collapses one.
  const collapsedFolders = new Map();

  function buildFileTree(files, emptyDirs) {
    const root = { type: 'dir', children: new Map() };
    const ensureDir = (parts) => {
      let node = root;
      parts.forEach((part) => {
        if (!node.children.has(part)) node.children.set(part, { type: 'dir', name: part, children: new Map() });
        node = node.children.get(part);
      });
      return node;
    };
    files.forEach((f) => {
      const parts = f.split('/');
      const dirNode = ensureDir(parts.slice(0, -1));
      const name = parts[parts.length - 1];
      dirNode.children.set(name, { type: 'file', name, path: f });
    });
    (emptyDirs || []).forEach((d) => ensureDir(d.split('/')));
    return root;
  }

  function renderFileTree() {
    els.fileTree.innerHTML = '';
    const c = state.selected;
    if (!c) {
      els.fileTree.innerHTML = '<div class="tree-empty">Выбери карточку слева</div>';
      els.newFileBtn.disabled = true;
      els.newFolderBtn.disabled = true;
      return;
    }
    els.newFileBtn.disabled = false;
    els.newFolderBtn.disabled = false;
    const files = c.files && c.files.length ? c.files : [c.mainFile || 'README.md'];
    const tree = buildFileTree(files, c.emptyDirs);
    const collapsed = collapsedFolders.get(c.path) || new Set();
    const container = document.createElement('div');
    renderTreeLevel(tree, container, 0, '', collapsed);
    els.fileTree.appendChild(container);
  }

  // Dropping on empty tree background — anywhere in #file-tree that isn't a
  // folder/file row, which stopPropagation their own drop handlers before
  // this ever sees the event — moves the file to card root. Attached once
  // to the element that survives re-renders (renderFileTree only clears
  // its children), not to the inner container div rebuilt on every render,
  // so this doesn't accumulate duplicate listeners over time.
  els.fileTree.addEventListener('dragover', (e) => e.preventDefault());
  els.fileTree.addEventListener('drop', (e) => {
    e.preventDefault();
    const src = e.dataTransfer.getData('text/plain');
    if (!src) return;
    const name = src.split('/').pop();
    if (name !== src) moveFile(src, name);
  });

  function renderTreeLevel(node, container, depth, pathPrefix, collapsed) {
    const entries = Array.from(node.children.values());
    const dirs = entries.filter((n) => n.type === 'dir').sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    const filesArr = entries.filter((n) => n.type === 'file').sort((a, b) => a.name.localeCompare(b.name, 'ru'));

    dirs.forEach((dir) => {
      const folderPath = pathPrefix ? `${pathPrefix}/${dir.name}` : dir.name;
      const isCollapsed = collapsed.has(folderPath);
      const row = document.createElement('div');
      row.className = 'tree-row tree-folder';
      row.style.paddingLeft = `${8 + depth * 14}px`;
      row.innerHTML = `${window.icon(isCollapsed ? 'chevron-right' : 'chevron-down', 12)}${window.icon('folder', 13)}<span>${escapeHtml(dir.name)}</span>`;
      row.addEventListener('click', () => {
        if (isCollapsed) collapsed.delete(folderPath);
        else collapsed.add(folderPath);
        collapsedFolders.set(state.selected.path, collapsed);
        renderFileTree();
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        row.classList.add('drag-over');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        row.classList.remove('drag-over');
        const src = e.dataTransfer.getData('text/plain');
        if (!src) return;
        const toFile = `${folderPath}/${src.split('/').pop()}`;
        if (toFile !== src) moveFile(src, toFile);
      });
      container.appendChild(row);
      if (!isCollapsed) {
        if (dir.children.size === 0) {
          const hint = document.createElement('div');
          hint.className = 'tree-row tree-folder-empty-hint';
          hint.style.paddingLeft = `${8 + (depth + 1) * 14 + 17}px`;
          hint.textContent = 'пусто';
          container.appendChild(hint);
        } else {
          renderTreeLevel(dir, container, depth + 1, folderPath, collapsed);
        }
      }
    });

    filesArr.forEach((file) => {
      const wrap = document.createElement('div');
      wrap.className = 'tree-row-wrap';
      const row = document.createElement('div');
      row.className = 'tree-row tree-file' + (state.activeFile === file.path ? ' active' : '');
      row.style.paddingLeft = `${8 + depth * 14 + 17}px`;
      row.innerHTML = `${window.icon('file-text', 12)}<span>${escapeHtml(file.name)}</span>`;
      row.addEventListener('click', async () => {
        if (state.activeFile === file.path) return;
        if (state.dirty && !confirm('Есть несохранённые изменения. Продолжить без сохранения?')) return;
        state.activeFile = file.path;
        renderFileTree();
        await loadFile(file.path);
      });
      row.draggable = true;
      row.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', file.path);
        e.dataTransfer.effectAllowed = 'move';
        wrap.classList.add('dragging');
      });
      row.addEventListener('dragend', () => wrap.classList.remove('dragging'));
      // Dropping onto a sibling file lands in that file's own folder —
      // same target as dropping directly on the folder row itself.
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (state.activeFile !== file.path) wrap.classList.add('drag-over');
      });
      row.addEventListener('dragleave', () => wrap.classList.remove('drag-over'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        wrap.classList.remove('drag-over');
        const src = e.dataTransfer.getData('text/plain');
        if (!src || src === file.path) return;
        const toFile = pathPrefix ? `${pathPrefix}/${src.split('/').pop()}` : src.split('/').pop();
        if (toFile !== src) moveFile(src, toFile);
      });
      const actions = document.createElement('div');
      actions.className = 'tree-row-actions';
      const moveBtn = document.createElement('button');
      moveBtn.title = 'Переместить/переименовать';
      moveBtn.innerHTML = window.icon('pencil', 11);
      moveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        moveFilePrompt(file.path);
      });
      actions.appendChild(moveBtn);
      wrap.appendChild(row);
      wrap.appendChild(actions);
      container.appendChild(wrap);
    });
  }

  async function moveFilePrompt(currentRelPath) {
    const next = prompt('Новый путь файла внутри карточки (можно с подпапками):', currentRelPath);
    if (next === null) return;
    const toFile = next.trim().replace(/^\/+/, '');
    if (!toFile || toFile === currentRelPath) return;
    if (!/\.md$/i.test(toFile)) {
      alert('Путь должен заканчиваться на .md');
      return;
    }
    await moveFile(currentRelPath, toFile);
  }

  // Shared by the pencil-prompt move and drag & drop — actually calls
  // /api/file/move and refreshes the tree/open file afterward.
  async function moveFile(fromFile, toFile) {
    const c = state.selected;
    if (!c || fromFile === toFile) return;
    try {
      const res = await fetch('/api/file/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseDir: c.baseDir, fromFile, toFile }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ошибка перемещения');
      const wasActive = state.activeFile === fromFile;
      await loadCards();
      const refreshed = state.cards.find((x) => x.path === c.path);
      if (refreshed) {
        state.selected = refreshed;
        if (wasActive) {
          state.activeFile = toFile;
          renderFileTree();
          await loadFile(toFile);
        } else {
          renderFileTree();
        }
      }
    } catch (err) {
      alert('Не удалось переместить: ' + (err.message || err));
    }
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
      state.originalContent = data.content;
      ta.oninput = () => {
        // Compare against the actually-loaded content, not "has the user
        // typed anything" — typing something then undoing/deleting it back
        // to the original text should not count as a pending change.
        state.dirty = ta.value !== state.originalContent;
        els.saveStatus.textContent = state.dirty ? 'не сохранено' : '';
        renderPreview(ta.value);
      };
      renderPreview(data.content);
      els.saveStatus.textContent = '';
      state.dirty = false;
      state.metaEditing = false;
      setupSyncScroll(ta, els.previewPane);
      updateUrlHash(fullPath);
      renderHeader();
      renderMetaPanel(data.content);
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
      state.originalContent = ta.value;
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
          renderFileTree();
        }
      }
      renderMetaPanel(ta.value);
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
    renderMermaidBlocks();
  }

  let mermaidSeq = 0;

  function isDarkTheme() {
    const explicit = document.documentElement.getAttribute('data-theme');
    if (explicit === 'light') return false;
    if (explicit === 'dark') return true;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  // Upgrades ```mermaid fenced code blocks (rendered by marked as
  // <pre><code class="language-mermaid">) into rendered SVG diagrams.
  async function renderMermaidBlocks() {
    if (!window.mermaid) return;
    const blocks = Array.from(els.previewPane.querySelectorAll('pre > code.language-mermaid'));
    if (!blocks.length) return;
    window.mermaid.initialize({ startOnLoad: false, theme: isDarkTheme() ? 'dark' : 'default', securityLevel: 'strict' });
    for (const codeEl of blocks) {
      const pre = codeEl.parentElement;
      const source = codeEl.textContent;
      const id = `mermaid-diagram-${++mermaidSeq}`;
      try {
        // Not passed through DOMPurify: mermaid's own securityLevel:'strict'
        // already sanitizes label content internally, and running our SVG
        // sanitizer on top strips <foreignObject> children (its hardcoded
        // anti-mXSS behavior), which is how mermaid renders node labels —
        // that would silently blank out every diagram's text.
        const { svg } = await window.mermaid.render(id, source);
        const wrapper = document.createElement('div');
        wrapper.className = 'mermaid-diagram';
        wrapper.innerHTML = svg;
        pre.replaceWith(wrapper);
      } catch (err) {
        pre.classList.add('mermaid-error');
        const note = document.createElement('div');
        note.className = 'mermaid-error-note';
        note.textContent = 'Ошибка рендера mermaid: ' + (err && err.message ? err.message : err);
        pre.after(note);
      }
    }
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

  // Keeps the currently open file in the URL hash (#/projects/guardium/README.md)
  // so a page reload — or a shared/bookmarked link — reopens the same file.
  // Uses replaceState, not pushState: this mirrors "current tab", not
  // browser back/forward history, so clicking through many files doesn't
  // flood the history stack.
  function updateUrlHash(fullPath) {
    const hash = '#/' + fullPath;
    if (location.hash !== hash) {
      history.replaceState(null, '', hash);
    }
  }

  async function openFromHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    if (!raw) return;
    let resolved;
    try {
      resolved = decodeURIComponent(raw);
    } catch (e) {
      return;
    }
    const match = findCardForPath(resolved);
    if (!match) return;
    state.selected = match.card;
    state.activeFile = match.file;
    state.dirty = false;
    renderList();
    renderHeader();
    renderFileTree();
    await loadFile(match.file);
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
      renderFileTree();
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
    renderFileTree();
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
  els.deleteBtn.addEventListener('click', deleteCurrentCard);
  els.trashToggle.addEventListener('click', toggleTrashView);
  els.newFileBtn.addEventListener('click', createFilePrompt);
  els.newFolderBtn.addEventListener('click', createFolderPrompt);

  async function createFilePrompt() {
    const c = state.selected;
    if (!c) return;
    const relFile = prompt('Путь нового файла внутри карточки (можно с подпапками, напр. module/overview.md):', '');
    if (!relFile) return;
    const clean = relFile.trim().replace(/^\/+/, '');
    if (!/\.md$/i.test(clean)) {
      alert('Путь должен заканчиваться на .md');
      return;
    }
    try {
      const res = await fetch('/api/file/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseDir: c.baseDir, relFile: clean, content: '' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ошибка создания');
      await loadCards();
      const refreshed = state.cards.find((x) => x.path === c.path);
      if (refreshed) {
        state.selected = refreshed;
        state.activeFile = clean;
        renderFileTree();
        await loadFile(clean);
      }
    } catch (err) {
      alert('Не удалось создать файл: ' + (err.message || err));
    }
  }

  async function createFolderPrompt() {
    const c = state.selected;
    if (!c) return;
    const relDir = prompt('Название новой папки (можно с подпапками, напр. module/sub):', '');
    if (!relDir) return;
    const clean = relDir.trim().replace(/^\/+|\/+$/g, '');
    if (!clean) return;
    try {
      const res = await fetch('/api/dir/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseDir: c.baseDir, relDir: clean }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ошибка создания папки');
      await loadCards();
      const refreshed = state.cards.find((x) => x.path === c.path);
      if (refreshed) {
        state.selected = refreshed;
        renderFileTree();
      }
    } catch (err) {
      alert('Не удалось создать папку: ' + (err.message || err));
    }
  }

  // "Удалить" acts on whatever is actually open: the whole card only when
  // the card's own README is showing, otherwise just the open sub-file —
  // deleting e.g. team.md inside Guardium must not take the whole project
  // down with it.
  async function deleteCurrentCard() {
    const c = state.selected;
    if (!c || !c.root) return; // no card open, or an ad-hoc file outside the tracked roots
    if (state.activeFile && state.activeFile !== c.mainFile) {
      await deleteCurrentSubfile(c);
      return;
    }
    if (!confirm(`Удалить весь проект «${c.title}»? Будет перемещено в корзину на 30 дней — восстановить можно оттуда.`)) return;
    try {
      const res = await fetch(`/api/entity?path=${encodeURIComponent(c.path)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ошибка удаления');
      state.selected = null;
      state.activeFile = null;
      state.dirty = false;
      renderHeader();
      renderFileTree();
      els.editorToolbar.style.display = 'none';
      els.rawPane.innerHTML = '<div id="empty-state">Выбери карточку слева</div>';
      els.previewPane.innerHTML = '';
      history.replaceState(null, '', location.pathname + location.search);
      await loadCards();
    } catch (err) {
      alert('Не удалось удалить: ' + (err.message || err));
    }
  }

  async function deleteCurrentSubfile(c) {
    const file = state.activeFile;
    if (!confirm(`Удалить файл «${file}» из «${c.title}»? Будет перемещён в корзину на 30 дней.`)) return;
    try {
      const res = await fetch(
        `/api/file?baseDir=${encodeURIComponent(c.baseDir)}&file=${encodeURIComponent(file)}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ошибка удаления');
      await loadCards();
      const refreshed = state.cards.find((x) => x.path === c.path);
      if (refreshed) {
        state.selected = refreshed;
        state.activeFile = refreshed.mainFile;
        renderHeader();
        renderFileTree();
        await loadFile(refreshed.mainFile);
      }
    } catch (err) {
      alert('Не удалось удалить: ' + (err.message || err));
    }
  }

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      saveCurrent();
    }
  });

  // Three-state theme: 'system' (follows prefers-color-scheme live, no
  // explicit override), 'light', 'dark'. Toggle cycles system -> light ->
  // dark -> system. Explicit choices persist in localStorage; 'system'
  // means no stored value at all, so a future OS-theme change keeps working.
  const THEME_META = {
    system: { icon: 'monitor', title: 'Тема: системная (клик — светлая)' },
    light: { icon: 'sun', title: 'Тема: светлая (клик — тёмная)' },
    dark: { icon: 'moon', title: 'Тема: тёмная (клик — системная)' },
  };

  function currentThemeMode() {
    const stored = (() => {
      try {
        return localStorage.getItem('repodocs-theme');
      } catch (e) {
        return null;
      }
    })();
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  }

  function applyThemeButton(mode) {
    const meta = THEME_META[mode];
    els.themeToggle.innerHTML = window.icon ? window.icon(meta.icon, 15) : '';
    els.themeToggle.title = meta.title;
  }

  const PANE_MODES = [
    { mode: 'view', icon: 'eye', title: 'Просмотр — только превью' },
    { mode: 'editor', icon: 'columns-2', title: 'Редактор — превью и markdown рядом' },
    { mode: 'source', icon: 'code', title: 'Source — только markdown' },
  ];

  function applyPaneMode() {
    els.contentPanes.classList.remove('mode-view', 'mode-source');
    if (state.paneMode === 'view') els.contentPanes.classList.add('mode-view');
    if (state.paneMode === 'source') els.contentPanes.classList.add('mode-source');
    els.paneModeSwitch.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === state.paneMode);
    });
  }

  function initPaneModeSwitch() {
    let stored;
    try {
      stored = localStorage.getItem('repodocs-pane-mode');
    } catch (e) {
      stored = null;
    }
    state.paneMode = PANE_MODES.some((m) => m.mode === stored) ? stored : 'editor';
    els.paneModeSwitch.innerHTML = '';
    PANE_MODES.forEach(({ mode, icon, title }) => {
      const btn = document.createElement('button');
      btn.dataset.mode = mode;
      btn.title = title;
      btn.innerHTML = window.icon(icon, 13);
      btn.addEventListener('click', () => {
        state.paneMode = mode;
        try {
          localStorage.setItem('repodocs-pane-mode', mode);
        } catch (e) {}
        applyPaneMode();
      });
      els.paneModeSwitch.appendChild(btn);
    });
    applyPaneMode();
  }

  function initTheme() {
    applyThemeButton(currentThemeMode());
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (currentThemeMode() !== 'system') return; // explicit choice overrides system changes
        const ta = document.getElementById('raw-editor');
        if (ta) renderPreview(ta.value);
      });
    }
    els.themeToggle.addEventListener('click', () => {
      const next = { system: 'light', light: 'dark', dark: 'system' }[currentThemeMode()];
      if (next === 'system') {
        document.documentElement.removeAttribute('data-theme');
        try {
          localStorage.removeItem('repodocs-theme');
        } catch (e) {}
      } else {
        document.documentElement.setAttribute('data-theme', next);
        try {
          localStorage.setItem('repodocs-theme', next);
        } catch (e) {}
      }
      applyThemeButton(next);
      const ta = document.getElementById('raw-editor');
      if (ta) renderPreview(ta.value); // re-render so any mermaid diagrams pick up the new theme
    });
  }

  function initStaticIcons() {
    document.querySelector('.search-icon').innerHTML = window.icon('search', 14);
    els.saveBtn.innerHTML = `${window.icon('save', 14)}<span>Сохранить</span>`;
    els.reindexBtn.innerHTML = `${window.icon('refresh', 14)}<span>Пересобрать INDEX.md</span>`;
    els.deleteBtn.innerHTML = `${window.icon('trash-2', 14)}<span>Удалить</span>`;
    els.trashToggle.innerHTML = window.icon('trash-2', 15);
    els.newFileBtn.innerHTML = window.icon('file-plus', 14);
    els.newFolderBtn.innerHTML = window.icon('folder-plus', 14);
  }

  initStaticIcons();
  initTheme();
  initPaneModeSwitch();
  renderFileTree(); // sets initial disabled state for the toolbar buttons
  loadCards().then(openFromHash);

  window.addEventListener('hashchange', () => {
    // Ignore hash changes we caused ourselves via updateUrlHash (replaceState
    // doesn't fire this event) — this only fires for external navigation:
    // manual URL edits, or a bookmarked/shared link opened in this tab.
    openFromHash();
  });
})();
