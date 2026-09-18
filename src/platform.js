// randomUUID is secure-context-only on some mobile browsers; LAN HTTP still
// has getRandomValues. These IDs identify local notes/conversations, not auth.
export function randomId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
  return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
