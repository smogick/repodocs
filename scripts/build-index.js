#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { REPO_ROOT, scanAll } = require('../lib/scan');

const cards = scanAll();

const header = `# INDEX

Сводная таблица всех проектов/областей/ресурсов. Сгенерировано автоматически — не редактируй руками, запусти \`npm run build-index\` в repodocs-ui (или сохрани README в UI) после изменений во frontmatter.

| Тип | Название | Статус | Стек | Summary | Путь |
|---|---|---|---|---|---|
`;

const rows = cards
  .map((c) => {
    const stack = (c.stack || []).join(', ');
    const summary = (c.summary || '').replace(/\|/g, '\\|');
    return `| ${c.type} | [${c.title}](${c.baseDir}/${c.mainFile}) | ${c.status} | ${stack} | ${summary} | \`${c.path}\` |`;
  })
  .join('\n');

fs.writeFileSync(path.join(REPO_ROOT, 'INDEX.md'), header + rows + '\n');
console.log(`INDEX.md обновлён: ${cards.length} записей.`);
