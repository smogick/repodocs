#!/usr/bin/env node
// Writes a section into the user's global Claude Code instructions
// (~/.claude/CLAUDE.md) telling agents in *other* repositories when and how
// to consult this notes base: the list of active projects, the path to
// INDEX.md, the glossary and the notes' own CLAUDE.md. The section sits
// between marker comments, so re-running replaces it in place (e.g. after
// adding a project) without touching anything else in the file.
//
//   npm run claude-global                 -- update ~/.claude/CLAUDE.md
//   npm run claude-global -- --dry-run    -- print the section only
//   npm run claude-global -- --file PATH  -- another target file
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CONFIG, REPO_ROOT, DOCS_ROOT, scanAll } = require('../lib/scan');

const BEGIN = '<!-- repodocs:begin -->';
const END = '<!-- repodocs:end -->';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const fileIdx = args.indexOf('--file');
const target = fileIdx !== -1 ? path.resolve(args[fileIdx + 1]) : path.join(os.homedir(), '.claude', 'CLAUDE.md');

function buildSection() {
  const cards = scanAll().filter((c) => c.status !== 'archived');
  const projects = cards.filter((c) => c.type === 'project').map((c) => c.title);
  const areas = cards.filter((c) => c.type === 'area').map((c) => c.title);
  const glossary = path.join(DOCS_ROOT, 'resources', 'glossary.md');
  const projectsDir = path.join(DOCS_ROOT, 'projects');

  const lines = [
    BEGIN,
    `<!-- Сгенерировано \`npm run claude-global\` (repodocs). Не правь вручную — перезапусти скрипт. -->`,
    '## База знаний о проектах',
    '',
    `Если задача касается одного из проектов пользователя — ${projects.join(', ') || '(список пуст)'}` +
      (areas.length ? ` — или областей (${areas.join(', ')}),` : ' —') +
      ' или упомянуты связанные термины/люди/сервисы, которые могут быть не очевидны из текущего репозитория:',
    '',
    `1. Прочитай \`${path.join(REPO_ROOT, 'INDEX.md')}\` — сводная таблица всех проектов со статусом, стеком и кратким summary.`,
    `2. Если нашёл подходящую строку — открой \`README.md\` в соответствующей папке (например \`${path.join(projectsDir, '<slug>', 'README.md')}\`) для полного контекста, и при необходимости — дополнительные файлы там же, включая вложенные подпапки-подпроекты.`,
  ];
  if (fs.existsSync(glossary)) {
    lines.push(`3. При незнакомой аббревиатуре/имени/кодовом названии — см. \`${glossary}\`.`);
  }
  lines.push(
    '',
    'Не тяни эту базу в контекст, если задача явно не связана ни с одним из перечисленных проектов.',
    '',
    `Если собираешься не просто прочитать, а **создать или отредактировать** карточку в базе, находясь в сессии другого репозитория — сначала прочитай \`${path.join(REPO_ROOT, 'CLAUDE.md')}\` целиком: его конвенции (frontmatter-схема, чек-лист при правке, правило про секреты) не попадают в контекст автоматически.`,
    END
  );
  return lines.join('\n');
}

const section = buildSection();
if (dryRun) {
  console.log(section);
  process.exit(0);
}

let existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
const start = existing.indexOf(BEGIN);
const end = existing.indexOf(END);
let next;
let action;
if (start !== -1 && end !== -1 && end > start) {
  next = existing.slice(0, start) + section + existing.slice(end + END.length);
  action = 'обновлена';
} else {
  next = existing.replace(/\s*$/, '') + (existing.trim() ? '\n\n' : '') + section + '\n';
  action = 'добавлена';
}
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, next);
console.log(`Секция ${action}: ${target}`);
console.log(`Заметки: ${REPO_ROOT} (config: ${CONFIG.configPath})`);
