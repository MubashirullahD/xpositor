// Agent retrieval operates only on immutable, captured strings. There is no
// filesystem, shell, network, or mutation capability behind these tools.
const integer = { type: 'integer', minimum: 0 };
const text = { type: 'string' };
const spec = (name, description, properties, required = []) => ({ type: 'function', name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } });
export const REPOSITORY_TOOLS = [
  spec('review_inventory', 'List captured repository files, including unchanged context and explicit unavailable reasons. Paginate until nextOffset is null. Listing is not reading.', { offset: integer, changedOnly: { type: 'boolean' } }),
  spec('review_read', 'Read immutable source by exact inventory path. Offset is a character offset; follow nextOffset to continue. Returned startLine supports code citations.', { path: text, offset: integer }, ['path']),
  spec('review_search', 'Search literal text across all captured source, including unchanged callers. Case sensitive. Results are excerpts, not complete file reads. Paginate matches.', { query: text, offset: integer }, ['query']),
  spec('review_diff', 'Read captured diff rows for a changed path, with old/new line numbers. Paginate until nextOffset is null.', { path: text, offset: integer }, ['path']),
];

export function createRepositoryTools(snapshots, snapshotId) {
  const repository = snapshots.getRepository(snapshotId);
  const ranges = new Map();
  const diffsRead = new Set();
  const changed = new Map(repository.snapshot.files.map(file => [file.path, file]));
  function offsetOf(args) {
    const offset = args.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('offset must be a non-negative integer.');
    return offset;
  }
  function page(items, offset, count = 100) {
    const end = Math.min(items.length, offset + count);
    return { items: items.slice(offset, end), total: items.length, nextOffset: end < items.length ? end : null };
  }
  function record(path, start, end) {
    const sorted = [...(ranges.get(path) || []), [start, end]].sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const range of sorted) {
      const last = merged.at(-1);
      if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
      else merged.push([...range]);
    }
    ranges.set(path, merged);
  }
  function call(name, args = {}) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object.');
    const definition = REPOSITORY_TOOLS.find(tool => tool.name === name);
    if (!definition) throw new Error('Only repository inventory, read, search and diff tools are available.');
    for (const key of Object.keys(args)) if (!(key in definition.inputSchema.properties)) throw new Error(`Unknown argument: ${key}`);
    const offset = offsetOf(args);
    if (name === 'review_inventory') {
      if (args.changedOnly !== undefined && typeof args.changedOnly !== 'boolean') throw new Error('changedOnly must be boolean.');
      return page(repository.manifest.filter(file => !args.changedOnly || file.changed), offset);
    }
    if (name === 'review_read') {
      const value = repository.read(args.path);
      if (value.source === null) return { path: args.path, unavailable: value.reason };
      const end = Math.min(value.source.length, offset + 12000);
      if (offset > value.source.length) throw new Error('offset exceeds file length.');
      record(args.path, offset, end);
      return { path: args.path, version: value.version, startLine: value.source.slice(0, offset).split('\n').length, offset, text: value.source.slice(offset, end), nextOffset: end < value.source.length ? end : null };
    }
    if (name === 'review_diff') {
      const file = changed.get(args.path);
      if (!file) throw new Error('Path is not changed in this comparison.');
      diffsRead.add(args.path);
      return { path: file.path, sourceReason: file.sourceReason, ...page(file.lines, offset, 100) };
    }
    if (typeof args.query !== 'string' || !args.query || args.query.length > 500) throw new Error('query must contain 1–500 characters.');
    // Bound output without regex execution or handing search syntax to a shell.
    const matches = [];
    let total = 0;
    for (const file of repository.manifest) {
      const source = repository.read(file.path).source;
      if (source === null) continue;
      const lines = source.split('\n');
      for (let index = 0; index < lines.length; index++) {
        const at = lines[index].indexOf(args.query);
        if (at < 0) continue;
        if (total >= offset && matches.length < 40) matches.push({ path: file.path, line: index + 1, excerpt: lines[index].slice(Math.max(0, at - 100), at + 400) });
        total++;
      }
    }
    return { items: matches, total, nextOffset: offset + matches.length < total ? offset + matches.length : null };
  }
  function coverage() {
    return repository.manifest.filter(file => file.changed).map(file => {
      const spans = ranges.get(file.path) || [];
      const length = file.available ? repository.read(file.path).source.length : null;
      return { path: file.path, fileId: file.fileId, available: file.available, reason: file.reason, sourceRead: spans.length === 1 && spans[0][0] === 0 && spans[0][1] === length, sourcePartlyRead: spans.length > 0, diffExamined: diffsRead.has(file.path) };
    });
  }
  return { definitions: REPOSITORY_TOOLS, call, coverage, repository };
}
