(function () {
  const state = {
    cards: [],
    filterRoot: null,
    filterStatus: null,
    query: '',
    selected: null, // card object
    activeFile: null, // relative file path within card dir, e.g. 'README.md'
    dirty: false,
  };

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

  function matchesQuery(card, q) {
    if (!q) return true;
    const hay = [card.title, card.summary, (card.tags || []).join(' '), (card.stack || []).join(' '), card.slug]
      .join(' ')
      .toLowerCase();
    return hay.includes(q.toLowerCase());
  }

  function renderList() {
    const filtered = state.cards.filter(
      (c) =>
        (!state.filterRoot || c.root === state.filterRoot) &&
        (!state.filterStatus || c.status === state.filterStatus) &&
        matchesQuery(c, state.query)
    );
    els.cardList.innerHTML = '';
    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.id = 'empty-state';
      empty.textContent = 'Ничего не найдено';
      els.cardList.appendChild(empty);
      return;
    }
    filtered.forEach((card) => {
      const item = document.createElement('div');
      item.className = 'card-item' + (state.selected && state.selected.path === card.path ? ' selected' : '');
      item.innerHTML = `
        <div class="row1">
          <div class="card-title"><span class="status-dot status-${card.status}"></span>${escapeHtml(card.title)}</div>
        </div>
        <div class="card-summary">${escapeHtml(card.summary || '')}</div>
        <div class="card-meta"><span class="type-badge">${card.type}</span>${(card.stack || []).join(', ')}</div>
      `;
      item.onclick = () => selectCard(card);
      els.cardList.appendChild(item);
    });
  }

  async function selectCard(card) {
    if (state.dirty && !confirm('Есть несохранённые изменения. Продолжить без сохранения?')) return;
    state.selected = card;
    state.activeFile = card.mainFile || 'README.md';
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
    } catch (err) {
      els.rawPane.innerHTML = `<div id="empty-state">Ошибка: ${escapeHtml(String(err.message || err))}</div>`;
      els.previewPane.innerHTML = '';
    }
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
      }
    } catch (err) {
      els.saveStatus.textContent = 'ошибка: ' + (err.message || err);
    }
  }

  function renderPreview(md) {
    els.previewPane.innerHTML = mdToHtml(md);
  }

  // Minimal markdown renderer — headings, bold/italic, code, links, lists, tables, blockquotes.
  function mdToHtml(src) {
    // Strip frontmatter block for preview.
    src = src.replace(/^---\n[\s\S]*?\n---\n?/, '');
    const lines = src.split('\n');
    let html = '';
    let inCode = false;
    let listType = null;
    let inTable = false;
    let tableRows = [];

    function closeList() {
      if (listType) {
        html += listType === 'ul' ? '</ul>' : '</ol>';
        listType = null;
      }
    }
    function flushTable() {
      if (!tableRows.length) return;
      const [headerRow, sepRow, ...bodyRows] = tableRows;
      html += '<table><thead><tr>' + headerRow.map((h) => `<th>${inline(h)}</th>`).join('') + '</tr></thead><tbody>';
      bodyRows.forEach((r) => {
        html += '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>';
      });
      html += '</tbody></table>';
      tableRows = [];
      inTable = false;
    }

    for (const line of lines) {
      if (line.trim().startsWith('```')) {
        if (!inCode) {
          closeList();
          html += '<pre><code>';
          inCode = true;
        } else {
          html += '</code></pre>';
          inCode = false;
        }
        continue;
      }
      if (inCode) {
        html += escapeHtml(line) + '\n';
        continue;
      }
      if (/^\s*\|(.+)\|\s*$/.test(line)) {
        inTable = true;
        const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        tableRows.push(cells);
        continue;
      } else if (inTable) {
        flushTable();
      }
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        closeList();
        const level = h[1].length;
        html += `<h${level}>${inline(h[2])}</h${level}>`;
        continue;
      }
      const bq = line.match(/^>\s?(.*)$/);
      if (bq) {
        html += `<blockquote>${inline(bq[1])}</blockquote>`;
        continue;
      }
      const ul = line.match(/^\s*[-*]\s+(.*)$/);
      const ol = line.match(/^\s*\d+\.\s+(.*)$/);
      if (ul) {
        if (listType !== 'ul') {
          closeList();
          html += '<ul>';
          listType = 'ul';
        }
        html += `<li>${inline(ul[1])}</li>`;
        continue;
      }
      if (ol) {
        if (listType !== 'ol') {
          closeList();
          html += '<ol>';
          listType = 'ol';
        }
        html += `<li>${inline(ol[1])}</li>`;
        continue;
      }
      closeList();
      if (line.trim() === '') {
        html += '';
      } else {
        html += `<p>${inline(line)}</p>`;
      }
    }
    closeList();
    flushTable();
    if (inCode) html += '</code></pre>';
    return html;
  }

  function inline(text) {
    let t = escapeHtml(text);
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return t;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  els.search.addEventListener('input', (e) => {
    state.query = e.target.value;
    renderList();
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
