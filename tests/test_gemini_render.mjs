// Focused renderer test: pulls the Markdown/LaTeX helpers out of app.js and
// runs them in Node with the same bundled KaTeX build the browser loads.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const katex = require(path.join(root, '..', 'vendor', 'katex', 'katex.min.js'));
const source = fs.readFileSync(path.join(root, '..', 'app.js'), 'utf8');

const start = source.indexOf('function geminiMathHtml');
const end = source.indexOf('function setAgentPromptPrefix');
assert.ok(start > 0 && end > start, 'renderer helpers not found');

const escapeStart = source.indexOf('function escapeHtml');
const escapeEnd = source.indexOf('\n}', escapeStart) + 2;
const escapeSrc = source.slice(escapeStart, escapeEnd);

const factory = new Function('katex', `
  ${escapeSrc}
  ${source.slice(start, end)}
  return { formatGeminiResponseText };
`);
const { formatGeminiResponseText: render } = factory(katex);

const bold = render('**Bold** and *italic*');
assert.match(bold, /<strong>Bold<\/strong>/);
assert.match(bold, /<em>italic<\/em>/);

const inlineMath = render('The rule is \\(x^2 + y^2 = z^2\\) here.');
assert.match(inlineMath, /class="katex"/);
assert.match(inlineMath, /gemini-math/);

const displayMath = render('\\[x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\\]');
assert.match(displayMath, /katex-display/);

const list = render('- one\n- two\n\n1. first\n2. second');
assert.match(list, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
assert.match(list, /<ol><li>first<\/li><li>second<\/li><\/ol>/);

const heading = render('## Section\nBody');
assert.match(heading, /<h2>Section<\/h2>/);
assert.match(heading, /<p>Body<\/p>/);

const table = render('| A | B |\n| --- | --- |\n| 1 | 2 |');
assert.match(table, /<table>/);
assert.match(table, /<th>A<\/th>/);
assert.match(table, /<td>2<\/td>/);

const code = render('```js\nconst a = 1 < 2;\n```');
assert.match(code, /gemini-code-block/);
assert.match(code, /const a = 1 &lt; 2;/);

const action = render('Done!\n```json\n{"actions":[{"type":"create_task"}]}\n```');
assert.equal(action.includes('create_task'), false);
assert.equal(action.includes('```'), false);

const unsafe = render('<script>alert(1)</script>');
assert.equal(unsafe.includes('<script>'), false);
assert.match(unsafe, /&lt;script&gt;/);

const brokenMath = render('Broken \\(\\frac{a}\\) formula');
assert.match(brokenMath, /gemini-math-fallback/);
assert.equal(brokenMath.includes('katex-error'), false);

console.log('GEMINI_RENDER_OK');
