const fs = require('fs');
const path = require('path');
const root = process.cwd();
const vstore = path.join(root, 'node_modules', '.pnpm', 'node_modules');
const destRoot = path.join(root, 'node_modules');
let made = 0, skipped = 0, err = 0;
function junctionDir(src, link) {
  if (fs.existsSync(link)) { skipped++; return; }
  const real = fs.realpathSync(src);
  if (!fs.statSync(real).isDirectory()) { skipped++; return; }
  try { fs.symlinkSync(real, link, 'junction'); made++; }
  catch (e) { err++; if (err <= 5) console.log('ERR', link, e.code, e.message); }
}
for (const scope of fs.readdirSync(vstore)) {
  const srcScope = path.join(vstore, scope);
  const destScope = path.join(destRoot, scope);
  if (scope.startsWith('@')) {
    fs.mkdirSync(destScope, { recursive: true });
    for (const pkg of fs.readdirSync(srcScope)) {
      junctionDir(path.join(srcScope, pkg), path.join(destScope, pkg));
    }
  } else {
    junctionDir(srcScope, path.join(destRoot, scope));
  }
}
console.log(`DONE made=${made} skipped=${skipped} err=${err}`);
