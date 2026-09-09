const fs = require('fs');
const path = require('path');

// Where the notes live is the only thing that differs between installs, so
// it's kept out of the code: config.json next to package.json (gitignored,
// see config.example.json), or a file named by REPODOCS_CONFIG.
//
//   root    — path to the notes repository (absolute, or relative to the
//             config file's directory). Required.
//   docsDir — folder under root holding the content (default "docs").
//   port    — HTTP port (default 4173; env PORT overrides).
const APP_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = process.env.REPODOCS_CONFIG
  ? path.resolve(process.env.REPODOCS_CONFIG)
  : path.join(APP_ROOT, 'config.json');

// allowMissingRoot lets `npm run init` create the notes folder itself.
function loadConfig({ allowMissingRoot = false } = {}) {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      `Config not found: ${CONFIG_PATH}\n` +
        'Copy config.example.json to config.json and set "root" to your notes repository.'
    );
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    throw new Error(`Invalid JSON in ${CONFIG_PATH}: ${err.message}`);
  }
  if (!raw.root || typeof raw.root !== 'string') {
    throw new Error(`"root" is required in ${CONFIG_PATH}`);
  }
  const root = path.resolve(path.dirname(CONFIG_PATH), raw.root);
  if (!allowMissingRoot && !fs.existsSync(root)) {
    throw new Error(`Notes root does not exist: ${root} (from ${CONFIG_PATH})`);
  }
  return {
    root,
    docsDir: raw.docsDir || 'docs',
    port: Number(process.env.PORT || raw.port || 4173),
    configPath: CONFIG_PATH,
  };
}

module.exports = { loadConfig };
