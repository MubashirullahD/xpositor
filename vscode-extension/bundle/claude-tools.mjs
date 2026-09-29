import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';

// Claude Code reaches the captured repository through a per-run MCP endpoint.
// It listens on loopback only, requires a random bearer token, and serves the
// same immutable read/search/diff tools Codex receives as dynamic tools.
export const CLAUDE_TOOL_SERVER = 'xpositor';
export const claudeToolNames = tools => tools.definitions.map(tool => `mcp__${CLAUDE_TOOL_SERVER}__${tool.name}`);

const MAX_REQUEST = 64 * 1024;

export async function startClaudeToolServer(tools, { onActivity } = {}) {
  const token = randomBytes(32).toString('hex');
  const expected = Buffer.from(`Bearer ${token}`);
  const authorized = header => { const value = Buffer.from(String(header || '')); return value.length === expected.length && timingSafeEqual(value, expected); };
  function handle(message) {
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return { jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'Invalid request.' } };
    if (message.id === undefined) return null;
    const reply = result => ({ jsonrpc: '2.0', id: message.id, result });
    switch (message.method) {
      case 'initialize': return reply({ protocolVersion: typeof message.params?.protocolVersion === 'string' ? message.params.protocolVersion : '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: CLAUDE_TOOL_SERVER, version: '0.2.0' } });
      case 'ping': return reply({});
      case 'tools/list': return reply({ tools: tools.definitions.map(({ name, description, inputSchema }) => ({ name, description, inputSchema, annotations: { readOnlyHint: true, openWorldHint: false } })) });
      case 'tools/call': {
        const { name, arguments: args = {} } = message.params || {};
        try {
          const value = tools.call(name, args);
          onActivity?.({ tool: name, path: typeof args?.path === 'string' ? args.path : null });
          return reply({ content: [{ type: 'text', text: JSON.stringify(value) }] });
        } catch (error) {
          return reply({ content: [{ type: 'text', text: error.message }], isError: true });
        }
      }
      default: return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found.' } };
    }
  }
  const server = createServer((request, response) => {
    if (request.url !== '/mcp' || !authorized(request.headers.authorization)) { response.writeHead(401).end(); return; }
    if (request.method !== 'POST') { response.writeHead(405, { allow: 'POST' }).end(); return; }
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; if (body.length > MAX_REQUEST) request.destroy(); });
    request.on('end', () => {
      let replies;
      try {
        const parsed = JSON.parse(body);
        replies = (Array.isArray(parsed) ? parsed : [parsed]).map(handle).filter(Boolean);
        if (!Array.isArray(parsed)) replies = replies[0] || null;
        else if (!replies.length) replies = null;
      } catch { replies = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } }; }
      if (!replies) { response.writeHead(202).end(); return; }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(replies));
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  return {
    config: JSON.stringify({ mcpServers: { [CLAUDE_TOOL_SERVER]: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } } }),
    close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}
