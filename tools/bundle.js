/**
 * Builds dist/fishin-control.html — the whole app in one file.
 *
 * Why: browsers refuse to load ES modules from a file opened by
 * double-clicking (file://), so the deployed site can't be previewed that
 * way. This stitches the modules into one classic script, each module kept
 * in its own function scope so private names can't collide.
 *
 * Usage: node tools/bundle.js
 *
 * The bundle drops the Content-Security-Policy (an inline script is the whole
 * point of a single file) and the service worker never registers from file://.
 * Images and fonts are embedded as data URIs so the preview needs nothing else.
 * It is a preview copy; deploy the real site, not this.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(root, p), 'utf8');

/** A site file as a data: URI, so the single file needs nothing beside it. */
const MIME = { webp: 'image/webp', png: 'image/png', woff2: 'font/woff2' };
const dataUri = f =>
  `data:${MIME[f.split('.').pop()]};base64,${readFileSync(join(root, f)).toString('base64')}`;
/** Every reference to a same-site image or font: 'x.webp', "x.png", url('x.woff2'). */
const ASSET_RX = /(['"(])([\w-]+\.(?:webp|png|woff2))(['")])/g;
const inline = src => src.replace(ASSET_RX, (_, a, f, b) => a + dataUri(f) + b);

const IMPORT_RX = /^import\s*\{([\s\S]*?)\}\s*from\s*'\.\/([\w-]+)\.js';?\s*$/gm;

/** Dependency order, depth-first from the entry point. */
function order(entry) {
  const seen = new Set(),
    out = [];
  (function visit(name) {
    if (seen.has(name)) return;
    seen.add(name);
    for (const m of read(name + '.js').matchAll(IMPORT_RX)) visit(m[2]);
    out.push(name);
  })(entry);
  return out;
}

/** Rewrite one module into a scoped block that registers its exports. */
function wrap(name) {
  // images referenced from code (the species pictures) travel inside the file
  let src = name === 'sw' ? read(name + '.js') : inline(read(name + '.js'));
  const exported = [];
  src = src.replace(
    IMPORT_RX,
    (_, names, from) =>
      `const { ${names
        .split(',')
        .map(n => n.trim())
        .filter(Boolean)
        .map(n => n.replace(/\s+as\s+/, ': '))
        .join(', ')} } = __mods['${from}'];`
  );
  src = src.replace(/^export\s+(async\s+function|function|const|let|class)\s+([\w$]+)/gm, (_, kind, id) => {
    exported.push(id);
    return kind + ' ' + id;
  });
  src = src.replace(/^export\s*\{([^}]*)\};?\s*$/gm, (_, names) => {
    names
      .split(',')
      .map(n => n.trim())
      .filter(Boolean)
      .forEach(n => exported.push(n));
    return '';
  });
  if (/^\s*(import|export)\s/m.test(src))
    throw new Error(name + '.js has an import/export the bundler cannot rewrite');
  return `/* ── ${name}.js ── */\n(() => {\n${src}\n__mods['${name}'] = { ${exported.join(', ')} };\n})();`;
}

const modules = order('app');
const script = `'use strict';\nconst __mods = {};\n` + modules.map(wrap).join('\n\n');

/** Replace, and fail the build if the pattern is not there (a silent miss ships a broken preview). */
let html = read('index.html');
const swap = (rx, to) => {
  if (!rx.test(html)) throw new Error('bundle: index.html has no match for ' + rx);
  rx.lastIndex = 0;
  html = html.replace(rx, to);
};
swap(/\s*<meta\s+http-equiv="Content-Security-Policy"[^>]*>/, '');
swap(/\s*<!-- (?:Only this site's own files|Every module)[^>]*-->/g, '');
swap(/\s*<link rel="(?:modulepreload|preload|manifest)"[^>]*>/g, '');
swap(
  /<link rel="stylesheet" href="styles\.css"\s*\/?>/,
  () => '<style>\n' + inline(read('styles.css')) + '\n</style>'
);
swap(/\s*<script type="module" src="app\.js"><\/script>/, '');
swap(/<\/body>/, () => '<script>\n' + script + '\n</script>\n</body>');
swap(/(src|href)="([\w-]+\.(?:webp|png))"/g, (_, attr, f) => `${attr}="${dataUri(f)}"`);

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/fishin-control.html'), html);
console.log(
  'dist/fishin-control.html — ' + modules.length + ' modules, ' + Math.round(html.length / 1024) + ' KB'
);
console.log('order: ' + modules.join(' → '));
