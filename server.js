const path = require('path');
const fs = require('fs');
const express = require('express');
const matter = require('gray-matter');
const { CONFIG, REPO_ROOT, DOCS_ROOT, scanAll, resolveSafePath, resolveSafeDirPath } = require('./lib/scan');
const trash = require('./lib/trash');

const app = express();
const PORT = CONFIG.port;

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// INDEX.md is generated, not hand-maintained — regenerate it whenever
// something that could change its rows happens (a README save, a card
// deleted/restored), so it never silently drifts out of date the way a
// manual "click reindex" step would let it.
function runReindex() {
  delete require.cache[require.resolve('./scripts/build-index.js')];
  require('./scripts/build-index.js');
}

app.get('/api/cards', (req, res) => {
  try {
    res.json(scanAll());
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get('/api/file', (req, res) => {
  try {
    const rel = req.query.path;
    if (!rel) return res.status(400).json({ error: 'path required' });
    const full = resolveSafePath(rel);
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'not found' });
    const raw = fs.readFileSync(full, 'utf8');
    res.json({ path: rel, content: raw });
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

app.put('/api/file', (req, res) => {
  try {
    const { path: rel, content } = req.body || {};
    if (!rel || typeof content !== 'string') {
      return res.status(400).json({ error: 'path and content required' });
    }
    const full = resolveSafePath(rel);
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'not found' });
    // Basic sanity check for README files: must remain valid frontmatter if it had one.
    if (path.basename(full) === 'README.md') {
      const parsed = matter(content);
      if (Object.keys(parsed.data || {}).length === 0) {
        return res.status(400).json({ error: 'README.md должен содержать YAML frontmatter' });
      }
    }
    fs.writeFileSync(full, content, 'utf8');
    if (path.basename(full) === 'README.md') runReindex();
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

// Creates a new markdown file within an existing card. `relFile` may
// include subfolders (e.g. "newmodule/overview.md") — intermediate
// directories are created as needed, which is also how a "new folder"
// effectively comes into being once it holds a file.
app.post('/api/file/create', (req, res) => {
  try {
    const { baseDir, relFile, content } = req.body || {};
    if (!baseDir || !relFile) return res.status(400).json({ error: 'baseDir and relFile required' });
    if (path.basename(String(relFile)) === 'README.md') {
      return res.status(400).json({ error: 'README.md создаётся вместе с самой карточкой, не как обычный файл' });
    }
    const full = resolveSafePath(`${baseDir}/${relFile}`);
    if (fs.existsSync(full)) return res.status(409).json({ error: 'файл с таким путём уже существует' });
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof content === 'string' ? content : '', 'utf8');
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

// Creates an empty directory — visible in the tree via GET /api/cards'
// emptyDirs even before it holds any file.
app.post('/api/dir/create', (req, res) => {
  try {
    const { baseDir, relDir } = req.body || {};
    if (!baseDir || !relDir) return res.status(400).json({ error: 'baseDir and relDir required' });
    const full = resolveSafeDirPath(`${baseDir}/${relDir}`);
    if (fs.existsSync(full)) return res.status(409).json({ error: 'папка с таким путём уже существует' });
    fs.mkdirSync(full, { recursive: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

// Moves/renames a single markdown file within a card, e.g. into or out of
// a subfolder. README.md is excluded — it's the card's identity file, not
// a file to relocate independently.
app.post('/api/file/move', (req, res) => {
  try {
    const { baseDir, fromFile, toFile } = req.body || {};
    if (!baseDir || !fromFile || !toFile) {
      return res.status(400).json({ error: 'baseDir, fromFile and toFile required' });
    }
    if (path.basename(String(fromFile)) === 'README.md' || path.basename(String(toFile)) === 'README.md') {
      return res.status(400).json({ error: 'README.md нельзя переместить/переименовать этим способом' });
    }
    const fromFull = resolveSafePath(`${baseDir}/${fromFile}`);
    const toFull = resolveSafePath(`${baseDir}/${toFile}`);
    if (!fs.existsSync(fromFull)) return res.status(404).json({ error: 'исходный файл не найден' });
    if (fs.existsSync(toFull)) return res.status(409).json({ error: 'файл с таким путём уже существует' });
    fs.mkdirSync(path.dirname(toFull), { recursive: true });
    fs.renameSync(fromFull, toFull);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

app.get('/api/search', (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const needle = q.toLowerCase();
    const cards = scanAll();
    const results = [];
    for (const c of cards) {
      const files = c.files && c.files.length ? c.files : [c.mainFile];
      const matchedFiles = [];
      for (const f of files) {
        const full = path.join(REPO_ROOT, c.baseDir, f);
        if (!fs.existsSync(full)) continue;
        const raw = fs.readFileSync(full, 'utf8');
        const lower = raw.toLowerCase();
        if (!lower.includes(needle)) continue;
        const snippets = [];
        let from = 0;
        while (snippets.length < 3) {
          const i = lower.indexOf(needle, from);
          if (i === -1) break;
          const start = Math.max(0, i - 50);
          const end = Math.min(raw.length, i + needle.length + 50);
          snippets.push(raw.slice(start, end).replace(/\s+/g, ' ').trim());
          from = i + needle.length;
        }
        matchedFiles.push({ file: f, snippets });
      }
      if (matchedFiles.length) {
        results.push({ path: c.path, files: matchedFiles });
      }
    }
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.delete('/api/file', (req, res) => {
  try {
    const baseDir = req.query.baseDir;
    const file = req.query.file;
    if (!baseDir || !file) return res.status(400).json({ error: 'baseDir and file required' });
    if (path.basename(String(file)) === 'README.md') {
      return res.status(400).json({ error: 'README.md — это сама карточка, удаляй через DELETE /api/entity' });
    }
    resolveSafePath(`${baseDir}/${file}`); // throws if outside docs/ or not markdown
    const meta = trash.softDeleteSubfile(String(baseDir), String(file));
    runReindex(); // file lists shown in INDEX.md links are unaffected, but harmless/cheap to keep in sync
    res.json({ ok: true, trash: meta });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: 'not found' });
    res.status(400).json({ error: String(err.message || err) });
  }
});

app.delete('/api/entity', (req, res) => {
  try {
    const p = req.query.path;
    if (!p) return res.status(400).json({ error: 'path required' });
    const meta = trash.softDelete(String(p));
    runReindex();
    res.json({ ok: true, trash: meta });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: 'not found' });
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get('/api/trash', (req, res) => {
  try {
    res.json({ retentionDays: trash.RETENTION_DAYS, items: trash.listTrash() });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post('/api/trash/:id/restore', (req, res) => {
  try {
    const meta = trash.restore(req.params.id);
    runReindex();
    res.json({ ok: true, restored: meta });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: 'not found' });
    if (err.code === 'CONFLICT') {
      return res.status(409).json({ error: 'по этому пути уже что-то есть — переименуйте или удалите текущее, затем восстановите' });
    }
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.delete('/api/trash/:id', (req, res) => {
  try {
    trash.permanentlyDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post('/api/reindex', (req, res) => {
  try {
    runReindex();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

trash.purgeExpired();

app.listen(PORT, () => {
  console.log(`repodocs UI: http://localhost:${PORT}`);
  console.log(`Notes root: ${REPO_ROOT} (docs: ${DOCS_ROOT})`);
  console.log(`Config: ${CONFIG.configPath}`);
});
