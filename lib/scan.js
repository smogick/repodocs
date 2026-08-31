const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ROOTS = ['projects', 'areas', 'resources', 'archive'];

function isMarkdown(name) {
  return name.toLowerCase().endsWith('.md');
}

// Entities under a root are either a subfolder containing README.md, or a
// standalone top-level .md file (used by simple resources/areas with no need
// for multiple sub-files, e.g. resources/glossary.md).
function listEntities(rootName) {
  const rootPath = path.join(REPO_ROOT, rootName);
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
  const dir = isFile ? path.join(REPO_ROOT, rootName) : path.join(REPO_ROOT, rootName, entity.slug);
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
  if (!isFile) walkFiles(dir, dir, files);
  const baseDir = isFile ? rootName : `${rootName}/${entity.slug}`; // dir relative to REPO_ROOT, for joining with `files` entries
  const displayPath = `${rootName}/${entity.slug}`; // unique id per card, independent of file/dir layout
  return { rootName, slug: entity.slug, dir, frontmatter, body, files, baseDir, displayPath, mainFile: mainRelName };
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
        mainFile: entity.mainFile,
        path: entity.displayPath,
        baseDir: entity.baseDir,
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
  if (!full.startsWith(REPO_ROOT + path.sep)) {
    throw new Error('Path escapes repo root');
  }
  if (!isMarkdown(full)) {
    throw new Error('Only .md files are allowed');
  }
  return full;
}

module.exports = { REPO_ROOT, ROOTS, scanAll, listEntities, readEntity, findEntityByPath, resolveSafePath };
