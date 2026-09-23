import Prism from './vendor/prism.js';
import { escapeHtml } from './render.js';

const languages = {
  js:'javascript', mjs:'javascript', cjs:'javascript', jsx:'jsx',
  ts:'typescript', mts:'typescript', cts:'typescript', tsx:'tsx',
  json:'json', jsonl:'json', css:'css', html:'markup', htm:'markup',
  xml:'markup', svg:'markup', vue:'markup', py:'python', sh:'bash',
  bash:'bash', zsh:'bash', yml:'yaml', yaml:'yaml', md:'markdown',
  markdown:'markdown', go:'go', rs:'rust', java:'java', c:'c', h:'c',
  cc:'cpp', cpp:'cpp', cxx:'cpp', hpp:'cpp', sql:'sql', rb:'ruby',
  swift:'swift', kt:'kotlin', kts:'kotlin', toml:'toml',
};

export function languageForPath(path) {
  const name = String(path).split('/').at(-1).toLowerCase();
  if (name === 'dockerfile' || name === 'makefile' || name === '.gitignore') return '';
  return languages[name.split('.').at(-1)] || '';
}

// Preserve one DOM row per source line, even when a token spans several lines.
export function highlightLines(source, path) {
  const text = String(source);
  const language = languageForPath(path);
  const grammar = Prism.languages[language];
  if (!grammar) return text.split(/\r?\n/).map(escapeHtml);

  const lines = [];
  const active = [];
  let html = '';
  const open = (name) => `<span class="token ${name}">`;
  const append = (value) => {
    const parts = value.split(/\r?\n/);
    for (let i = 0; i < parts.length; i++) {
      if (i) {
        html += '</span>'.repeat(active.length);
        lines.push(html);
        html = active.map(open).join('');
      }
      html += escapeHtml(parts[i]);
    }
  };
  const visit = (token) => {
    if (typeof token === 'string') return append(token);
    if (Array.isArray(token)) return token.forEach(visit);
    const alias = token.alias ? (Array.isArray(token.alias) ? token.alias : [token.alias]) : [];
    const name = [token.type, ...alias].filter((part) => /^[\w-]+$/.test(part)).join(' ');
    if (!name) return visit(token.content);
    html += open(name);
    active.push(name);
    visit(token.content);
    active.pop();
    html += '</span>';
  };
  visit(Prism.tokenize(text, grammar));
  lines.push(html);
  return lines;
}
