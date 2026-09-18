/** Read bounded NDJSON without assuming network chunks align with messages. */
export async function readReply(response, onDelta = () => {}) {
  if (!response.ok) { const body = await response.json(); throw new Error(body.error || `Request failed (${response.status}).`); }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', size = 0, result;
  const accept = (line) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'error') throw new Error(event.error || 'The guide could not finish.');
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
      while ((at = buffer.indexOf('\n')) >= 0) { accept(buffer.slice(0, at)); buffer = buffer.slice(at + 1); }
    }
    buffer += decoder.decode(); accept(buffer);
    if (!result || typeof result.text !== 'string') throw new Error('The connection ended before the guide finished. Retry your question.');
    return result;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
