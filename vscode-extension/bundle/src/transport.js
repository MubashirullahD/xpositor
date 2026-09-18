export function errorMessage(value, fallback='The guide could not finish.') {
  let current=value;
  for(let i=0;i<5;i++) {
    if(typeof current==='string') {try {const parsed=JSON.parse(current);if(parsed&&typeof parsed==='object'){current=parsed;continue;}}catch{}break;}
    if(current&&typeof current==='object')current=current.error||current.message;else break;
  }
  const message=typeof current==='string'&&current.trim()?current:fallback;
  if(message.includes('Update Codex on the laptop, restart Patchwork'))return message;
  if(/requires a newer version|upgrade.*(?:cli|codex)|update.*(?:cli|codex)/i.test(message))return `${message} Update Codex on the laptop, restart Patchwork, or select another model in Code guide.`;
  if(/^(Load failed|Failed to fetch|NetworkError)/i.test(message))return 'Connection to the laptop was interrupted. Keep the companion running and reconnect using its current pairing link. If a tunnel is in use, check it on the laptop.';
  return message;
}
/** Read bounded NDJSON without assuming network chunks align with messages. */
export async function readReply(response, onDelta = () => {}) {
  if (!response.ok || /application\/json(?:;|$)/i.test(response.headers.get('content-type')||'')) {
    let body;try{body=await response.json();}catch{throw new Error(`The laptop returned HTTP ${response.status} without a readable response. Reconnect and check the companion.`);}
    if(!response.ok||body.error)throw new Error(errorMessage(body,`Request failed (${response.status}).`));
    if(typeof body.text==='string'){onDelta(body.text);return body;}
    throw new Error('The laptop returned an unexpected response. Update and restart Patchwork.');
  }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', size = 0, result;
  const accept = (line) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'error') throw new Error(errorMessage(event));
    if (event.type === 'delta' && typeof event.text === 'string') onDelta(event.text);
    if (event.type === 'done') result = event;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error('Guide response exceeded the limit.');
      buffer += decoder.decode(value, { stream: true });
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) { accept(buffer.slice(0, at)); buffer = buffer.slice(at + 1); if(result)return result; }
    }
    buffer += decoder.decode(); accept(buffer);
    if (!result || typeof result.text !== 'string') throw new Error('The connection ended before the guide finished. Retry your question.');
    return result;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
