const fs = require('fs');
const path = require('path');
const { DOCS_DIR, DOCS_ROOT, findEntityByPath } = require('./scan');

const TRASH_DIR = path.join(DOCS_ROOT, 'trash');
const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

function ensureTrashDir() {
  if (!fs.existsSync(TRASH_DIR)) fs.mkdirSync(TRASH_DIR, { recursive: true });
}

function metaPath(trashId) {
  return path.join(TRASH_DIR, `${trashId}.meta.json`);
}

function contentPath(trashId) {
  return path.join(TRASH_DIR, trashId);
}

function sanitizeForFsName(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, '-');
}

// Moves an entity (its whole directory, or its single file for a flat
// resource) into trash/<trashId>/, alongside a trash/<trashId>.meta.json
// recording enough to restore and to render a trash listing without
// re-reading the moved content.
function softDelete(displayPath) {
  const entity = findEntityByPath(displayPath);
  if (!entity) {
    const err = new Error('not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  ensureTrashDir();
  const trashId = `${Date.now()}-${sanitizeForFsName(entity.rootName)}-${sanitizeForFsName(entity.slug)}`;
  // entity.dir is the source directory for dir-kind entities; for file-kind
  // entities (flat resource files) entity.dir === docs/<rootName> and the
  // real file lives at entity.dir/entity.mainFile.
  const isFlatFile = entity.baseDir === `${DOCS_DIR}/${entity.rootName}`;
  const dest = contentPath(trashId);
  if (isFlatFile) {
    fs.mkdirSync(dest, { recursive: true });
    fs.renameSync(path.join(entity.dir, entity.mainFile), path.join(dest, entity.mainFile));
  } else {
    fs.renameSync(entity.dir, dest);
  }
  const meta = {
    trashId,
    originalPath: displayPath,
    rootName: entity.rootName,
    slug: entity.slug,
    kind: isFlatFile ? 'file' : 'dir',
    mainFile: entity.mainFile,
    title: entity.frontmatter.title || entity.slug,
    summary: entity.frontmatter.summary || '',
    deletedAt: new Date().toISOString(),
  };
  fs.writeFileSync(metaPath(trashId), JSON.stringify(meta, null, 2));
  return meta;
}

function readMeta(trashId) {
  const p = metaPath(trashId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
}

function purgeExpired() {
  ensureTrashDir();
  const now = Date.now();
  const purged = [];
  for (const name of fs.readdirSync(TRASH_DIR)) {
    if (!name.endsWith('.meta.json')) continue;
    const trashId = name.slice(0, -'.meta.json'.length);
    const meta = readMeta(trashId);
    if (!meta) continue;
    const age = now - new Date(meta.deletedAt).getTime();
    if (age > RETENTION_MS) {
      permanentlyDelete(trashId);
      purged.push(trashId);
    }
  }
  return purged;
}

function listTrash() {
  purgeExpired();
  ensureTrashDir();
  const items = [];
  for (const name of fs.readdirSync(TRASH_DIR)) {
    if (!name.endsWith('.meta.json')) continue;
    const meta = readMeta(name.slice(0, -'.meta.json'.length));
    if (!meta) continue;
    const ageMs = Date.now() - new Date(meta.deletedAt).getTime();
    items.push({ ...meta, daysLeft: Math.max(0, Math.ceil((RETENTION_MS - ageMs) / (24 * 60 * 60 * 1000))) });
  }
  items.sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
  return items;
}

function restore(trashId) {
  const meta = readMeta(trashId);
  if (!meta) {
    const err = new Error('not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const destDir = path.join(DOCS_ROOT, meta.rootName);
  const finalDest = meta.kind === 'file' ? path.join(destDir, meta.mainFile) : path.join(destDir, meta.slug);
  if (fs.existsSync(finalDest)) {
    const err = new Error('destination already exists');
    err.code = 'CONFLICT';
    throw err;
  }
  fs.mkdirSync(destDir, { recursive: true });
  if (meta.kind === 'file') {
    fs.renameSync(path.join(contentPath(trashId), meta.mainFile), finalDest);
    fs.rmSync(contentPath(trashId), { recursive: true, force: true });
  } else {
    fs.renameSync(contentPath(trashId), finalDest);
  }
  fs.rmSync(metaPath(trashId), { force: true });
  return meta;
}

function permanentlyDelete(trashId) {
  fs.rmSync(contentPath(trashId), { recursive: true, force: true });
  fs.rmSync(metaPath(trashId), { force: true });
}

module.exports = { RETENTION_DAYS, softDelete, listTrash, restore, permanentlyDelete, purgeExpired };
