const path = require('path');
const fs = require('fs');
const express = require('express');
const matter = require('gray-matter');
const { REPO_ROOT, scanAll, resolveSafePath } = require('./lib/scan');

const app = express();
const PORT = process.env.PORT || 4173;

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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

app.post('/api/reindex', (req, res) => {
  try {
    delete require.cache[require.resolve('./scripts/build-index.js')];
    require('./scripts/build-index.js');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`repodocs UI: http://localhost:${PORT}`);
  console.log(`Repo root: ${REPO_ROOT}`);
});
