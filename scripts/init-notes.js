#!/usr/bin/env node
// Lays out a fresh notes repository at config.root from scaffold/: agent
// instructions (CLAUDE.md), frontmatter schema, card templates, .gitignore
// and the section folders. Existing files are left alone unless --force is
// given, so it is safe to re-run on a live repository to pick up new
// scaffold files. "docs" in scaffold text is spelled {{docsDir}} and
// replaced with the configured folder name.
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../lib/config');

const force = process.argv.includes('--force');
const cfg = loadConfig({ allowMissingRoot: true });
const SCAFFOLD = path.join(__dirname, '..', 'scaffold');

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

const created = [];
const skipped = [];
for (const src of walk(SCAFFOLD)) {
  const rel = path.relative(SCAFFOLD, src).split(path.sep);
  if (rel[0] === 'docs') rel[0] = cfg.docsDir;
  const dest = path.join(cfg.root, ...rel);
  if (fs.existsSync(dest) && !force) {
    skipped.push(dest);
    continue;
  }
  // .gitkeep only matters for a folder git would otherwise not see.
  if (path.basename(src) === '.gitkeep') {
    const dir = path.dirname(dest);
    if (fs.existsSync(dir) && fs.readdirSync(dir).length) continue;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const content = fs.readFileSync(src, 'utf8').split('{{docsDir}}').join(cfg.docsDir);
  fs.writeFileSync(dest, content);
  created.push(dest);
}

console.log(`Notes root: ${cfg.root}`);
for (const f of created) console.log(`  + ${path.relative(cfg.root, f)}`);
if (skipped.length) {
  console.log(`Пропущено ${skipped.length} существующих файлов (перезаписать: --force):`);
  for (const f of skipped) console.log(`  = ${path.relative(cfg.root, f)}`);
}
if (!fs.existsSync(path.join(cfg.root, 'INDEX.md'))) {
  require('./build-index.js');
}
