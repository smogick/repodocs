const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DOCS_DIR = 'docs'; // all content lives under here; ui/ (app code) is the sibling
const DOCS_ROOT = path.join(REPO_ROOT, DOCS_DIR);
const ROOTS = ['projects', 'areas', 'resources', 'archive'];

function isMarkdown(name) {
  return name.toLowerCase().endsWith('.md');
}

// Entities under a root are either a subfolder containing README.md, or a
// standalone top-level .md file (used by simple resources/areas with no need
// for multiple sub-files, e.g. resources/glossary.md).
function listEntities(rootName) {
  const rootPath = path.join(DOCS_ROOT, rootName);
  if (!fs.existsSync(rootPath)) return [];
  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  const result = [];
  for (const e of entries) {
    if (e.isDirectory()) {
      result.push({ slug: e.name, kind: 'dir' });
    } else if (isMarkdown(e.name) && e.name.toLowerCase() !== 'readme.md') {
      result.push({ slug: e.name.replace(/\.md$/i, ''), kind: 'file', fileName: e.name });
    }
  }
  return result;
}

function readEntity(rootName, entity) {
  const isFile = entity.kind === 'file';
  const dir = isFile ? path.join(DOCS_ROOT, rootName) : path.join(DOCS_ROOT, rootName, entity.slug);
  const mainPath = isFile ? path.join(dir, entity.fileName) : path.join(dir, 'README.md');
  const mainRelName = isFile ? entity.fileName : 'README.md';
  let frontmatter = {};
  let body = '';
  if (fs.existsSync(mainPath)) {
    const raw = fs.readFileSync(mainPath, 'utf8');
    const parsed = matter(raw);
    frontmatter = parsed.data || {};
    body = parsed.content || '';
  }
  const files = isFile ? [mainRelName] : [];
  const emptyDirs = [];
  if (!isFile) {
    walkFiles(dir, dir, files);
    listEmptyDirs(dir, dir, emptyDirs, '');
  }
  // baseDir/displayPath are REPO_ROOT-relative (includes the docs/ prefix)
  // so every consumer (file API, trash, INDEX.md links) can join it with
  // REPO_ROOT without needing to know about the docs/ split themselves.
  const baseDir = isFile ? `${DOCS_DIR}/${rootName}` : `${DOCS_DIR}/${rootName}/${entity.slug}`;
  const displayPath = `${rootName}/${entity.slug}`; // unique id per card, kept short for UI display
  let maxMtimeMs = 0;
  for (const f of files) {
    try {
      const st = fs.statSync(path.join(dir, f));
      if (st.mtimeMs > maxMtimeMs) maxMtimeMs = st.mtimeMs;
    } catch (e) {
      // file listed but unreadable mid-scan (rare race) — ignore for mtime purposes
    }
  }
  return { rootName, slug: entity.slug, dir, frontmatter, body, files, emptyDirs, baseDir, displayPath, mainFile: mainRelName, maxMtimeMs };
}

function walkFiles(baseDir, currentDir, acc) {
  if (!fs.existsSync(currentDir)) return;
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const full = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(baseDir, full, acc);
    } else if (isMarkdown(entry.name)) {
      const rel = path.relative(baseDir, full);
      acc.push(rel.split(path.sep).join('/'));
    }
  }
}

// Directories that contain no markdown file anywhere beneath them — created
// via the UI's "новая папка" but not yet holding any content, so they'd
// otherwise be invisible in a tree built purely from the files list.
// Reports only the topmost such directory (everything under an empty
// directory is empty too, so no need to also list its children).
function listEmptyDirs(baseDir, currentDir, acc, relPrefix) {
  if (!fs.existsSync(currentDir)) return true;
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  let hasMarkdown = false;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const childRel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const childEmpty = listEmptyDirs(baseDir, path.join(currentDir, entry.name), acc, childRel);
      if (!childEmpty) hasMarkdown = true;
    } else if (isMarkdown(entry.name)) {
      hasMarkdown = true;
    }
  }
  if (!hasMarkdown && relPrefix) acc.push(relPrefix);
  return hasMarkdown;
}

// True when some file in the card was actually modified on disk after the
// calendar day recorded in its own `updated` frontmatter — i.e. someone
// edited the content and forgot to bump the field. Compared at day
// granularity (not exact timestamp) since `updated` is a date, not a
// datetime, so a same-day edit should never trip this.
function isStale(updatedValue, maxMtimeMs) {
  if (!updatedValue || !maxMtimeMs) return false;
  const updatedDate = new Date(updatedValue);
  if (isNaN(updatedDate.getTime())) return false;
  const updatedDay = Date.UTC(updatedDate.getUTCFullYear(), updatedDate.getUTCMonth(), updatedDate.getUTCDate());
  const mtime = new Date(maxMtimeMs);
  const mtimeDay = Date.UTC(mtime.getUTCFullYear(), mtime.getUTCMonth(), mtime.getUTCDate());
  return mtimeDay > updatedDay;
}

function scanAll() {
  const cards = [];
  for (const rootName of ROOTS) {
    for (const entityRef of listEntities(rootName)) {
      const entity = readEntity(rootName, entityRef);
      const fm = entity.frontmatter;
      cards.push({
        root: rootName,
        slug: entity.slug,
        title: fm.title || entity.slug,
        type: fm.type || rootName.replace(/s$/, ''),
        status: fm.status || 'unknown',
        stack: fm.stack || [],
        tags: fm.tags || [],
        owner: fm.owner || '',
        created: fm.created || '',
        updated: fm.updated || '',
        links: fm.links || {},
        summary: fm.summary || '',
        files: entity.files,
        emptyDirs: entity.emptyDirs,
        mainFile: entity.mainFile,
        path: entity.displayPath,
        baseDir: entity.baseDir,
        stale: isStale(fm.updated, entity.maxMtimeMs),
      });
    }
  }
  cards.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  return cards;
}

// Looks up a single entity by its display path ("projects/guardium"),
// returning the same shape as readEntity(), or null if not found.
function findEntityByPath(displayPath) {
  const [rootName, slug] = String(displayPath).split('/');
  if (!ROOTS.includes(rootName) || !slug) return null;
  const ref = listEntities(rootName).find((e) => e.slug === slug);
  if (!ref) return null;
  return readEntity(rootName, ref);
}

function resolveSafePath(relPath) {
  const full = path.resolve(REPO_ROOT, relPath);
  // Confine file read/write to docs/ — the UI edits content, never app code.
  if (!full.startsWith(DOCS_ROOT + path.sep)) {
    throw new Error('Path escapes the docs/ root');
  }
  if (!isMarkdown(full)) {
    throw new Error('Only .md files are allowed');
  }
  return full;
}

// Same containment check as resolveSafePath, for directory paths (mkdir,
// move destinations) rather than a single markdown file.
function resolveSafeDirPath(relPath) {
  const full = path.resolve(REPO_ROOT, relPath);
  if (!full.startsWith(DOCS_ROOT + path.sep) && full !== DOCS_ROOT) {
    throw new Error('Path escapes the docs/ root');
  }
  return full;
}

module.exports = {
  REPO_ROOT,
  DOCS_DIR,
  DOCS_ROOT,
  ROOTS,
  scanAll,
  listEntities,
  readEntity,
  findEntityByPath,
  resolveSafePath,
  resolveSafeDirPath,
};
