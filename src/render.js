export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function icon(name, size = 20) {
  const paths = {
    panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    archive: '<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v12h14V8M10 12h4"/>',
    sliders: '<path d="M4 7h5m4 0h7M4 17h9m4 0h3"/><circle cx="11" cy="7" r="2"/><circle cx="15" cy="17" r="2"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>',
    moon: '<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>',
    monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M12 17v4M8 21h8"/>',
    logo: '<path d="M4 4h5l11 16h-5L4 4Z"/><path d="M20 4l-4.54 4.54M8.54 15.46 4 20"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    branch: '<path d="M6 4v12a3 3 0 0 0 3 3h9"/><circle cx="6" cy="4" r="2.3"/><circle cx="18" cy="19" r="2.3"/><path d="M18 7V5a3 3 0 0 0-3-3H9"/><circle cx="18" cy="7" r="2.3"/>',
    spark: '<path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2Z"/><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.3 2"/>',
    breathe: '<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.5"/><path d="M12 1.5v2M12 20.5v2M1.5 12h2M20.5 12h2"/>',
    settings: '<path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/><circle cx="12" cy="12" r="3.2"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    check: '<path d="m5 12 4.2 4L19 7"/>',
    message: '<path d="M19 15a3 3 0 0 1-3 3H9l-4 3v-6a3 3 0 0 1-1-2.4V8a3 3 0 0 1 3-3h9a3 3 0 0 1 3 3v7Z"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    send: '<path d="m21 3-7.2 18-3.2-7.6L3 10.2 21 3Z"/><path d="m10.6 13.4 4.8-4.8"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    wifi: '<path d="M4 9.5a12.2 12.2 0 0 1 16 0M7.5 13a7 7 0 0 1 9 0M11 16.3a2 2 0 0 1 2 0"/><circle cx="12" cy="19" r=".8" fill="currentColor" stroke="none"/>',
    bolt: '<path d="m13 2-8 12h6l-1 8 8-12h-6l1-8Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    more: '<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/>',
    bookmark: '<path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-3.5L6 21V4.5Z"/>',
  };
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.grid}</svg>`;
}

function inlineMarkdown(text) {
  let value = escapeHtml(text);
  value = value.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  value = value.replace(/`([^`]+)`/g, '<code>$1</code>');
  value = value.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  value = value.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return value;
}

// Assistant replies are Markdown; reviewer text stays literal. Both are escaped.
export function messageBubble(role, text) {
  return role === 'assistant' ? `<div class="message-bubble markdown-message">${renderMarkdown(String(text || ''))}</div>` : `<div class="message-bubble">${escapeHtml(text)}</div>`;
}

export function renderMarkdown(source) {
  const output = [];
  const lines = source.split(/\r?\n/);
  let inCode = false;
  let listType = '';
  let table = null;
  const closeList = () => {
    if (listType) output.push(`</${listType}>`);
    listType = '';
  };
  const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
  const closeTable = () => {
    if (!table) return;
    const [head, ...body] = table.filter(row => !row.every(cell => /^:?-{2,}:?$/.test(cell)));
    output.push(`<div class="markdown-table"><table><thead><tr>${head.map(cell => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${body.map(row => `<tr>${row.map(cell => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    table = null;
  };

  for (const line of lines) {
    if (!inCode && /^\s*\|.*\|\s*$/.test(line)) {
      closeList();
      (table ||= []).push(cells(line));
      continue;
    }
    closeTable();
    if (/^\s*```/.test(line)) {
      closeList();
      if (inCode) output.push('</code></pre>');
      else output.push('<pre><code>');
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      output.push(escapeHtml(line) + '\n');
      continue;
    }
    const unordered = line.match(/^\s*[-*+]\s+(.+)/);
    const ordered = line.match(/^\s*\d+\.\s+(.+)/);
    if (unordered || ordered) {
      const nextType = unordered ? 'ul' : 'ol';
      if (listType !== nextType) {
        closeList();
        listType = nextType;
        output.push(`<${listType}>`);
      }
      output.push(`<li>${inlineMarkdown((unordered || ordered)[1])}</li>`);
      continue;
    }
    closeList();
    if (!line.trim()) continue;
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { output.push('<hr>'); continue; }
    const heading = line.match(/^\s*(#{1,6})\s+(.+)/);
    if (heading) {
      const level = heading[1].length;
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else if (/^\s*>\s?/.test(line)) {
      output.push(`<blockquote>${inlineMarkdown(line.replace(/^\s*>\s?/, ''))}</blockquote>`);
    } else {
      output.push(`<p>${inlineMarkdown(line)}</p>`);
    }
  }
  closeList();
  closeTable();
  if (inCode) output.push('</code></pre>');
  return output.join('');
}
