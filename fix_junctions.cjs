const fs = require('fs');
const path = require('path');
const root = process.cwd();

// 1) build name -> source dir map from packages/vendor/apps (exclude node_modules)
const map = {};
function scan(dir) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const pkg = path.join(p, 'package.json');
      if (fs.existsSync(pkg)) {
        try {
          const j = JSON.parse(fs.readFileSync(pkg, 'utf8'));
          if (j.name) map[j.name] = p;
        } catch {}
      }
      scan(p);
    }
  }
}
for (const base of ['packages', 'vendor', 'apps']) {
  const abs = path.resolve(root, base);
  if (fs.existsSync(abs)) scan(abs);
}

// .pnpm virtual store as fallback
const pnpmScope = path.join(root, 'node_modules/.pnpm/node_modules/@deepseek-ai');

const scope = '@deepseek-ai';
const destScope = path.join(root, 'node_modules', scope);
fs.mkdirSync(destScope, { recursive: true });

let fixed = 0, fallback = 0, skip = 0;
const errors = [];
for (const [name, src] of Object.entries(map)) {
  if (!name.startsWith(scope + '/')) continue;
  const short = name.slice(scope.length + 1);
  const link = path.join(destScope, short);
  // prefer built source
  const builtSource =
    fs.existsSync(path.join(src, 'lib', 'index.js')) ||
    fs.existsSync(path.join(src, 'index.js')) ||
    fs.existsSync(path.join(src, 'lib', 'bin.js'));
  let target = builtSource ? src : null;
  if (!target) {
    const pb = path.join(pnpmScope, short);
    if (
      fs.existsSync(path.join(pb, 'lib', 'index.js')) ||
      fs.existsSync(path.join(pb, 'index.js'))
    ) {
      target = pb;
      fallback++;
    }
  }
  if (!target) {
    skip++;
    console.log('SKIP (no built artifact):', name, '->', src);
    continue;
  }
  try {
    // remove existing link/junction (incl. broken ones) — lstat detects the reparse point
    let exists = false;
    try { fs.lstatSync(link); exists = true; } catch {}
    if (exists) fs.rmSync(link, { force: true, recursive: false, maxRetries: 5, retryDelay: 100 });
    fs.symlinkSync(target, link, 'junction');
    fixed++;
  } catch (e) {
    errors.push(name + ': ' + e.code);
  }
}
console.log('map=' + Object.keys(map).length + ' fixed=' + fixed + ' fallback=' + fallback + ' skip=' + skip);
if (errors.length) console.log('ERRORS:', errors.join('; '));
