import { basename, dirname, extname, normalize, relative, sep } from 'node:path';

export class GuideError extends Error {
  constructor(message, status = 422, code = 'INVALID_GUIDE') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const GUIDE_LIMITS = Object.freeze({
  maxAutomaticFiles: 8,
  maxExplicitFiles: 12,
  maxContextBytes: 256 * 1024,
  maxGuideTokens: 3500,
  maxCitationSpan: 80,
});

export const GUIDE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'assumptions', 'steps'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 140 },
    summary: { type: 'string', minLength: 1, maxLength: 1600 },
    assumptions: { type: 'array', maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 500 } },
    steps: {
      type: 'array', minItems: 3, maxItems: 6,
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'explanation', 'reviewPointers', 'citations'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 180 },
          explanation: { type: 'string', minLength: 1, maxLength: 3200 },
          reviewPointers: { type: 'array', maxItems: 4, items: { type: 'object', additionalProperties: false, required: ['text', 'citation'], properties: { text: { type: 'string', minLength: 1, maxLength: 500 }, citation: { type: 'object', additionalProperties: false, required: ['fileId', 'startLine', 'endLine', 'side'], properties: { fileId: { type: 'string', minLength: 1, maxLength: 180 }, startLine: { type: 'integer', minimum: 1 }, endLine: { type: 'integer', minimum: 1 }, side: { enum: ['new', 'old'] } } } } } },
          citations: {
            type: 'array', minItems: 1, maxItems: 8,
            items: {
              type: 'object', additionalProperties: false,
              required: ['fileId', 'startLine', 'endLine', 'side'],
              properties: {
                fileId: { type: 'string', minLength: 1, maxLength: 180 },
                startLine: { type: 'integer', minimum: 1 },
                endLine: { type: 'integer', minimum: 1 },
                side: { enum: ['new', 'old'] },
              },
            },
          },
        },
      },
    },
  },
});

export function buildGuideContext(store, snapshotId, selectedId, fileIds) {
  requireStore(store);
  const snapshot = store.get(snapshotId);
  if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.files)) throw new GuideError('The snapshot store returned invalid metadata.', 500, 'SNAPSHOT_CONTRACT');
  const byId = new Map(snapshot.files.map((file) => [file.id, file]));
  if (!isNonEmptyString(selectedId) || !byId.has(selectedId)) throw new GuideError('Choose a changed file from this immutable snapshot.', 400, 'FILE_NOT_FOUND');
  const selected = byId.get(selectedId);
  const sourceRecords = fileIds === undefined ? new Map(snapshot.files.map((file) => {
    const result = store.getFile(snapshotId, { id: file.id });
    if (!result || result.file?.id !== file.id) throw new GuideError(`Snapshot source lookup failed for ${file.id}.`, 500, 'SNAPSHOT_CONTRACT');
    return [file.id, result];
  })) : undefined;
  const selectedIds = chooseContextFileIds(snapshot.files, selected, fileIds, sourceRecords);
  const records = selectedIds.map((id) => {
    const result = sourceRecords?.get(id) || store.getFile(snapshotId, { id });
    if (!result || result.file?.id !== id) throw new GuideError(`Snapshot source lookup failed for ${id}.`, 500, 'SNAPSHOT_CONTRACT');
    return contextFile(result.file, result.source);
  });
  const included = new Set(selectedIds);
  const context = {
    snapshotId: snapshot.snapshotId,
    repoId: snapshot.repoId,
    base: snapshot.base,
    head: snapshot.head,
    branch: snapshot.branch,
    generatedAt: snapshot.generatedAt,
    selectedId,
    scope: {
      includedCount: records.length,
      excludedCount: snapshot.files.length - records.length,
      totalChangedFiles: snapshot.files.length,
      includedPaths: records.map((file) => file.path),
      selectedPath: selected.path,
      excluded: `${snapshot.files.length - records.length} changed file(s) are outside this walkthrough context.`,
    },
    files: records,
  };
  const bytes = Buffer.byteLength(JSON.stringify(context));
  if (bytes > GUIDE_LIMITS.maxContextBytes) {
    throw new GuideError(`The selected walkthrough context is ${bytes} bytes, above the ${GUIDE_LIMITS.maxContextBytes}-byte limit. Choose fewer or smaller changed files; Xpositor did not trim captured source.`, 413, 'GUIDE_CONTEXT_LIMIT');
  }
  if (!included.has(selectedId)) throw new GuideError('The selected file was omitted from the walkthrough context.', 500, 'GUIDE_CONTEXT');
  return freeze(context);
}

export function validateGuide(value, context) {
  validateContext(context);
  requireObject(value, 'Guide');
  rejectUnknownKeys(value, ['title', 'summary', 'assumptions', 'steps'], 'Guide');
  const guide = {
    title: stringField(value.title, 'Guide title', 140),
    summary: stringField(value.summary, 'Guide summary', 1600),
    assumptions: stringArray(value.assumptions, 'Guide assumptions', 12, 500),
    steps: validateSteps(value.steps, context),
  };
  const tokens = estimatedTokens(JSON.stringify(guide));
  if (tokens > GUIDE_LIMITS.maxGuideTokens) throw new GuideError(`Guide exceeds the ${GUIDE_LIMITS.maxGuideTokens}-token response limit.`, 413, 'GUIDE_RESPONSE_LIMIT');
  return freeze(guide);
}

export function buildGuidePrompt(context, { depth = 'standard', timeMinutes = 15 } = {}) {
  validateContext(context);
  if (!['brief', 'standard', 'deep'].includes(depth)) throw new GuideError('Guide depth must be brief, standard, or deep.', 400, 'GUIDE_REQUEST');
  if (!Number.isSafeInteger(timeMinutes) || timeMinutes < 1 || timeMinutes > 120) throw new GuideError('timeMinutes must be an integer from 1 to 120.', 400, 'GUIDE_REQUEST');
  return [
    'Plan a read-only code-review walkthrough from the immutable snapshot context below.',
    `The requested depth is ${depth}; the reviewer has about ${timeMinutes} minute(s).`,
    'Return JSON only, matching GUIDE_SCHEMA exactly. Create 3–6 grounded steps in this order where evidence permits: intent, trace, failure or edge case, and verification.',
    'Every step must have one or more citations. A citation may name only an included fileId and a real line on its stated side. side "new" cites captured new source when available; side "old" cites removed diff lines. Do not invent files, callers, symbols, line numbers, behavior, or missing source. State uncertainty in assumptions.',
    'For each step, add 0–4 Things to double-check: a concrete risk, missing test, edge case, or uncertainty supported by captured evidence. Each pointer must cite a real captured line. Use an empty array when no specific pointer is supported; never imply that the change is verified.',
    'Only the supplied snapshot is available. Do not request tools, edits, commands, permissions, credentials, or network access. Notes and private review annotations are not part of this context.',
    `GUIDE_SCHEMA:\n${JSON.stringify(GUIDE_SCHEMA)}`,
    `SNAPSHOT_CONTEXT:\n${JSON.stringify(context)}`,
  ].join('\n\n');
}

export function buildStepPrompt(context, guide, stepIndex, question = '') {
  validateContext(context);
  const checkedGuide = validateGuide(guide, context);
  if (!Number.isSafeInteger(stepIndex) || stepIndex < 0 || stepIndex >= checkedGuide.steps.length) throw new GuideError('stepIndex is outside the validated guide.', 400, 'GUIDE_STEP');
  if (typeof question !== 'string' || question.length > 1600) throw new GuideError('A follow-up question must be text no longer than 1600 characters.', 400, 'GUIDE_QUESTION');
  const step = checkedGuide.steps[stepIndex];
  const request = question.trim();
  const lower = request.toLowerCase();
  const instructions = [];
  if (/\b(slower|simpler|slow down)\b/.test(lower)) instructions.push('Explain this step more slowly, defining unfamiliar terms before using them.');
  if (/\b(example|example of)\b/.test(lower)) instructions.push('Give a small illustrative example, clearly labelled as an example rather than a fact about the repository.');
  if (/\b(show|find|what are|which).{0,30}\bcaller(s)?\b|\bcaller(s)?\b/.test(lower)) {
    const callers = includedCallers(context, step.citations.map((citation) => citation.fileId));
    instructions.push(callers.length
      ? `Included caller evidence: ${callers.map((file) => `${file.path} (${file.id})`).join(', ')}. Discuss only these included files.`
      : 'No caller is included in this immutable context. Say that explicitly; do not infer or invent a caller.');
  }
  return [
    `Continue the validated walkthrough at step ${stepIndex + 1} of ${checkedGuide.steps.length}.`,
    `STEP:\n${JSON.stringify(step)}`,
    request ? `REVIEWER_QUESTION:\n${request}` : 'REVIEWER_QUESTION:\nExplain this step.',
    instructions.length ? `RESPONSE_GUIDANCE:\n${instructions.join(' ')}` : '',
    'Use only this supplied context and cite readable included file paths and real old/new line numbers if you cite code. Do not claim files or callers outside it. This is explanation only: do not request or imply any action, edit, command, permission, credential, or network access.',
    `SNAPSHOT_CONTEXT:\n${JSON.stringify(context)}`,
  ].filter(Boolean).join('\n\n');
}

function chooseContextFileIds(files, selected, explicitIds, sourceRecords) {
  if (explicitIds !== undefined) {
    if (!Array.isArray(explicitIds)) throw new GuideError('fileIds must be an array of changed file IDs.', 400, 'GUIDE_FILE_IDS');
    if (explicitIds.length > GUIDE_LIMITS.maxExplicitFiles) throw new GuideError(`A walkthrough can include at most ${GUIDE_LIMITS.maxExplicitFiles} explicit files. No files were trimmed.`, 413, 'GUIDE_FILE_LIMIT');
    const known = new Set(files.map((file) => file.id));
    const ids = [selected.id, ...explicitIds];
    const unique = [...new Set(ids)];
    if (unique.length > GUIDE_LIMITS.maxExplicitFiles) throw new GuideError(`The selected file plus fileIds exceeds the ${GUIDE_LIMITS.maxExplicitFiles}-file walkthrough limit.`, 413, 'GUIDE_FILE_LIMIT');
    for (const id of unique) if (!isNonEmptyString(id) || !known.has(id)) throw new GuideError('fileIds contains a file that is not part of this immutable snapshot.', 400, 'GUIDE_FILE_IDS');
    return unique;
  }
  if (!sourceRecords) throw new GuideError('Snapshot sources are required to build related-file context.', 500, 'SNAPSHOT_CONTRACT');
  const importedBy = new Map(files.map((file) => [file.id, new Set()]));
  const imports = new Map(files.map((file) => [file.id, new Set()]));
  for (const file of files) {
    const source = sourceRecords.get(file.id)?.source;
    if (typeof source !== 'string') continue;
    for (const targetPath of importedChangedPaths(file.path, source, files)) {
      const target = files.find((candidate) => candidate.path === targetPath);
      if (target) { imports.get(file.id).add(target.id); importedBy.get(target.id).add(file.id); }
    }
  }
  const selectedDirectory = dirname(selected.path);
  const ordered = [selected.id];
  const add = (id) => { if (!ordered.includes(id) && ordered.length < GUIDE_LIMITS.maxAutomaticFiles) ordered.push(id); };
  for (const id of [...imports.get(selected.id)].sort()) add(id);
  for (const id of [...importedBy.get(selected.id)].sort()) add(id);
  for (const file of files.filter((file) => isTestPath(file.path) && (imports.get(file.id).has(selected.id) || sharesStem(file.path, selected.path))).sort(byPath)) add(file.id);
  for (const file of files.filter((file) => file.id !== selected.id).sort((a, b) => commonPathDepth(b.path, selectedDirectory) - commonPathDepth(a.path, selectedDirectory) || byPath(a, b))) add(file.id);
  return ordered;
}

function contextFile(file, source) {
  if (source !== null && typeof source !== 'string') throw new GuideError(`Snapshot source for ${file.path} is invalid.`, 500, 'SNAPSHOT_CONTRACT');
  const diffLines = Array.isArray(file.lines) ? file.lines.map((line) => {
    if (!Array.isArray(line) || line.length < 3 || !['added', 'removed', 'normal'].includes(line[0]) || !Number.isSafeInteger(Number(line[1]))) throw new GuideError(`Snapshot diff for ${file.path} is invalid.`, 500, 'SNAPSHOT_CONTRACT');
    return { kind: line[0], side: line[0] === 'removed' ? 'old' : 'new', line: Number(line[1]), text: String(line[2]) };
  }) : [];
  return {
    id: file.id, path: file.path, oldPath: file.oldPath || null, version: file.version, status: file.status,
    sourceAvailable: source !== null, sourceReason: source === null ? (file.sourceReason || 'Captured source is unavailable.') : null,
    source: source === null ? null : numberedSource(source),
    sourceLineCount: source === null ? 0 : lineCount(source),
    diffLines,
  };
}

function validateSteps(value, context) {
  if (!Array.isArray(value) || value.length < 3 || value.length > 6) throw new GuideError('Guide must contain 3 to 6 steps.');
  return value.map((step, index) => {
    requireObject(step, `Step ${index + 1}`);
    rejectUnknownKeys(step, ['title', 'explanation', 'reviewPointers', 'citations'], `Step ${index + 1}`);
    if (!Array.isArray(step.citations) || !step.citations.length || step.citations.length > 8) throw new GuideError(`Step ${index + 1} needs 1 to 8 citations.`);
    return {
      title: stringField(step.title, `Step ${index + 1} title`, 180),
      explanation: stringField(step.explanation, `Step ${index + 1} explanation`, 3200),
      reviewPointers: Array.isArray(step.reviewPointers) ? validatePointers(step.reviewPointers, context, index + 1) : (()=>{throw new GuideError(`Step ${index + 1} needs reviewPointers.`);})(),
      citations: step.citations.map((citation, citationIndex) => validateCitation(citation, context, index + 1, citationIndex + 1)),
    };
  });
}

function validatePointers(value, context, stepNumber) {
  if(value.length>4)throw new GuideError(`Step ${stepNumber} has too many review pointers.`);
  return value.map((pointer,index)=>{
    requireObject(pointer,`Step ${stepNumber} pointer ${index+1}`);
    rejectUnknownKeys(pointer,['text','citation'],`Step ${stepNumber} pointer ${index+1}`);
    return {text:stringField(pointer.text,`Step ${stepNumber} pointer ${index+1}`,500),citation:validateCitation(pointer.citation,context,stepNumber,index+1)};
  });
}

function validateCitation(citation, context, stepNumber, citationNumber) {
  requireObject(citation, `Step ${stepNumber} citation ${citationNumber}`);
  rejectUnknownKeys(citation, ['fileId', 'startLine', 'endLine', 'side'], `Step ${stepNumber} citation ${citationNumber}`);
  if (!isNonEmptyString(citation.fileId)) throw new GuideError(`Step ${stepNumber} citation ${citationNumber} needs an included fileId.`);
  if (!['new', 'old'].includes(citation.side)) throw new GuideError(`Step ${stepNumber} citation ${citationNumber} has an invalid side.`);
  if (!Number.isSafeInteger(citation.startLine) || !Number.isSafeInteger(citation.endLine) || citation.startLine < 1 || citation.endLine < citation.startLine) throw new GuideError(`Step ${stepNumber} citation ${citationNumber} has an invalid line range.`);
  if (citation.endLine - citation.startLine + 1 > GUIDE_LIMITS.maxCitationSpan) throw new GuideError(`Step ${stepNumber} citation ${citationNumber} spans more than ${GUIDE_LIMITS.maxCitationSpan} lines.`);
  const file = context.files.find((item) => item.id === citation.fileId);
  if (!file) throw new GuideError(`Step ${stepNumber} citation ${citationNumber} references a file outside the walkthrough context.`);
  if (citation.side === 'new' && file.sourceAvailable && citation.endLine <= file.sourceLineCount) return { fileId: citation.fileId, startLine: citation.startLine, endLine: citation.endLine, side: citation.side };
  const available = new Set(file.diffLines.filter((line) => line.side === citation.side).map((line) => line.line));
  for (let line = citation.startLine; line <= citation.endLine; line++) if (!available.has(line)) throw new GuideError(`Step ${stepNumber} citation ${citationNumber} references unavailable ${citation.side} line ${line} in ${file.path}.`);
  return { fileId: citation.fileId, startLine: citation.startLine, endLine: citation.endLine, side: citation.side };
}

function validateContext(context) {
  if (!context || typeof context !== 'object' || !isNonEmptyString(context.snapshotId) || !Array.isArray(context.files) || !context.files.length) throw new GuideError('A complete immutable guide context is required.', 500, 'GUIDE_CONTEXT');
}
function includedCallers(context, targetIds) {
  const targetPaths = new Set(context.files.filter((file) => targetIds.includes(file.id)).map((file) => file.path));
  return context.files.filter((file) => file.sourceAvailable && importSpecifiers(unnumberedSource(file.source)).some((specifier) => targetPaths.has(resolveImport(file.path, specifier, context.files.map((item) => item.path)))));
}
function importedChangedPaths(fromPath, source, files) { return importSpecifiers(source).map((specifier) => resolveImport(fromPath, specifier, files.map((file) => file.path))).filter(Boolean); }
function importSpecifiers(source) {
  if (typeof source !== 'string') return [];
  const values = new Set();
  const pattern = /(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\()\s*['"]([^'"\\]+)['"]/g;
  for (const match of source.matchAll(pattern)) values.add(match[1]);
  return [...values];
}
function resolveImport(fromPath, specifier, knownPaths) {
  if (!specifier.startsWith('.')) return undefined;
  const raw = normalize(`${dirname(fromPath)}/${specifier}`).split(sep).join('/');
  const extension = extname(fromPath);
  const candidates = [raw, ...(extension ? [`${raw}${extension}`] : []), ...['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json'].map((suffix) => `${raw}${suffix}`), ...['index.js', 'index.mjs', 'index.ts', 'index.tsx'].map((name) => `${raw}/${name}`)];
  return candidates.find((candidate) => knownPaths.includes(candidate));
}
function numberedSource(source) { return source.split('\n').map((line, index) => `${index + 1} | ${line}`).join('\n'); }
function unnumberedSource(source) { return String(source || '').replace(/^\d+ \| /gm, ''); }
function lineCount(source) { return source === '' ? 0 : source.split('\n').length; }
function isTestPath(path) { return /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[^/]+$/i.test(path); }
function sharesStem(first, second) { return basename(first).replace(/\.(test|spec)?\.[^.]+$/i, '') === basename(second).replace(/\.[^.]+$/, ''); }
function commonPathDepth(path, folder) { const rel = relative(folder, dirname(path)); return rel === '' ? 1000 : rel.startsWith('..') ? 0 : Math.max(1, folder.split('/').length - rel.split('/').length); }
function byPath(left, right) { return left.path.localeCompare(right.path); }
function stringField(value, label, max) { if (!isNonEmptyString(value) || value.length > max) throw new GuideError(`${label} must be non-empty text no longer than ${max} characters.`); return value.trim(); }
function stringArray(value, label, maxItems, maxLength) { if (!Array.isArray(value) || value.length > maxItems) throw new GuideError(`${label} must contain at most ${maxItems} items.`); return value.map((item, index) => stringField(item, `${label} ${index + 1}`, maxLength)); }
function requireObject(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GuideError(`${label} must be an object.`); }
function rejectUnknownKeys(value, allowed, label) { for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new GuideError(`${label} contains unsupported field ${key}.`); }
function requireStore(store) { if (!store || typeof store.get !== 'function' || typeof store.getFile !== 'function') throw new GuideError('A snapshot store with get and getFile is required.', 500, 'SNAPSHOT_CONTRACT'); }
function isNonEmptyString(value) { return typeof value === 'string' && value.trim().length > 0; }
function estimatedTokens(value) { return Math.ceil(value.length / 4); }
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
