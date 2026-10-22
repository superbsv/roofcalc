// Перевірка перекладів: node scripts/i18n-extract.js — показує нові українські рядки без перекладу RU/EN
const ts = require('typescript');
const fs = require('fs'), path = require('path');
const CYR = /[А-Яа-яЇїІіЄєҐґ]/;
const out = { exact: new Set(), tpl: new Set() };
function walk(dir) { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(tsx?|)$/.test(f) && !/test|setupTests|i18n/.test(f)) scan(p); } }
function norm(s) { return s.replace(/\s+/g, ' ').trim(); }
function scan(file) {
  const src = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = n => {
    if (ts.isImportDeclaration(n)) return;
    if (ts.isCallExpression(n) && /console\./.test(n.expression.getText(src))) return;
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && CYR.test(n.text)) n.text.split('\n').forEach(x => { const t = norm(x); if (t && CYR.test(t)) out.exact.add(t); });
    else if (ts.isJsxText(n) && CYR.test(n.text)) { const t = norm(n.text); if (t) out.exact.add(t); }
    else if (ts.isTemplateExpression(n)) {
      const parts = [n.head.text, ...n.templateSpans.map(s => s.literal.text)];
      if (parts.some(p => CYR.test(p))) {
        out.tpl.add(norm(parts.map((p, i) => (i ? `{${i - 1}}` : '') + p).join('')));
        parts.forEach(p => { const t = norm(p); if (t.length >= 3 && CYR.test(t)) out.exact.add(t); });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
}
walk(path.join(__dirname, '..', 'src'));
// PHP: рядки з кирилицею у повідомленнях API та попередженнях розрахунку
function php(dir) { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (fs.statSync(p).isDirectory()) { if (!/exports/.test(p)) php(p); } else if (f.endsWith('.php')) {
  const s = fs.readFileSync(p, 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|#)/.test(l)).join('\n');
  for (const m of s.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)) { let t = (m[1] ?? m[2] ?? '').replace(/\\'/g, "'"); if (m[2] !== undefined) t = t.replace(/\{?\$[a-zA-Z_][\w\[\]'\->]*\}?/g, '{0}'); t = norm(t); if (t.length >= 4 && CYR.test(t) && !/^(SELECT|UPDATE|INSERT|DELETE)/.test(t)) out.exact.add(t); }
} } }
php(path.join(__dirname, '..', 'backend', 'src'));
// Порівняння зі словником: виводить українські рядки, яких ще немає в src/i18n/dict.json
const dict = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n', 'dict.json'), 'utf8'));
const PRINTF = /%(?:\.\d+)?[df]/g;
const tplKeys = new Set(dict.tpl.map(x => x[0].replace(/\{\d+\}/g, '{}')));
const ignore = k => /[<>]|\\n|SETUP_SECRET|^\/|Мова \/ Language|дov/.test(k);
const missing = [...out.exact].filter(k => !ignore(k)).filter(k => !dict.exact[k] && !tplKeys.has(k.replace(PRINTF, '{}').replace(/\{\d+\}/g, '{}')))
  .concat([...out.tpl].filter(k => !ignore(k) && !tplKeys.has(k.replace(/\{\d+\}/g, '{}'))));
if (missing.length) {
  console.log('Немає перекладу (' + missing.length + '). Додайте в src/i18n/dict.json: "Український текст": ["Русский", "English"]');
  missing.forEach(m => console.log('  ' + m));
  process.exitCode = 1;
} else console.log('Усі рядки інтерфейсу перекладено ✓');
