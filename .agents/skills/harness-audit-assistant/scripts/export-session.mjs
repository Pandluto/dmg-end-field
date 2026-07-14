import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';

const DEFAULT_DB = path.join(
  homedir(),
  'Library/Application Support/dmg-end-field/def-opencode/db/def-opencode.db',
);
const DEFAULT_OUTPUT_ROOT = path.resolve('data/localdata/def-session-audits');

function usage() {
  return [
    'Usage:',
    '  node .agents/skills/harness-audit-assistant/scripts/export-session.mjs <session-id-or-workbench-uuid> [--db <path>] [--output-root <path>]',
  ].join('\n');
}

function parseArgs(argv) {
  const options = { db: DEFAULT_DB, outputRoot: DEFAULT_OUTPUT_ROOT, input: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--db' || value === '--output-root') {
      const next = argv[index + 1];
      if (!next) throw new Error(`Missing value for ${value}`);
      options[value === '--db' ? 'db' : 'outputRoot'] = path.resolve(next);
      index += 1;
      continue;
    }
    if (value.startsWith('--')) throw new Error(`Unknown option: ${value}`);
    if (options.input) throw new Error(`Unexpected extra argument: ${value}`);
    options.input = value;
  }
  if (!options.input) throw new Error(usage());
  if (!/^(ses_[A-Za-z0-9_-]+|[A-Za-z0-9][A-Za-z0-9_-]{7,127})$/.test(options.input)) {
    throw new Error('Session identifier contains unsupported characters.');
  }
  return options;
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return { type: 'parse-error', label, error: String(error), raw: value };
  }
}

function isoTime(value) {
  return Number.isFinite(value) ? new Date(value).toISOString() : null;
}

function resolveSession(db, input) {
  if (input.startsWith('ses_')) {
    return db.prepare('SELECT * FROM session WHERE id = ?').get(input) ?? null;
  }

  const sessions = db
    .prepare('SELECT * FROM session ORDER BY time_updated DESC')
    .all();
  return sessions.find((session) => path.basename(path.normalize(session.directory)) === input) ?? null;
}

function normalizeToolPart(part, row) {
  const state = part.state && typeof part.state === 'object' ? part.state : {};
  return {
    id: row.id,
    type: 'tool',
    tool: part.tool ?? null,
    callId: part.callID ?? part.callId ?? null,
    status: state.status ?? null,
    input: state.input ?? null,
    output: state.output ?? null,
    error: state.error ?? null,
    title: state.title ?? null,
    metadata: state.metadata ?? null,
    time: state.time ?? null,
    createdAt: isoTime(row.time_created),
    updatedAt: isoTime(row.time_updated),
  };
}

function normalizePart(row) {
  const part = parseJson(row.data, `part:${row.id}`);
  if (part.type === 'reasoning' || part.type === 'step-start' || part.type === 'step-finish') {
    return null;
  }
  if (part.type === 'tool') return normalizeToolPart(part, row);
  if (part.type === 'text') {
    return {
      id: row.id,
      type: 'text',
      text: part.text ?? '',
      createdAt: isoTime(row.time_created),
      updatedAt: isoTime(row.time_updated),
    };
  }
  return {
    id: row.id,
    type: part.type ?? 'unknown',
    data: part,
    createdAt: isoTime(row.time_created),
    updatedAt: isoTime(row.time_updated),
  };
}

function jsonBlock(value) {
  return `\n\`\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\`\n`;
}

function renderMarkdown(trace) {
  const lines = [
    '# DEF Session Export',
    '',
    '> Read-only local export. Model reasoning/chain-of-thought is intentionally omitted.',
    '',
    `- Input identifier: \`${trace.metadata.inputIdentifier}\``,
    `- Native session: \`${trace.metadata.nativeSessionId}\``,
    `- Workbench session: \`${trace.metadata.workbenchSessionId ?? 'unknown'}\``,
    `- Title: ${trace.metadata.title}`,
    `- Directory: \`${trace.metadata.directory}\``,
    `- Created: ${trace.metadata.createdAt}`,
    `- Updated: ${trace.metadata.updatedAt}`,
    `- Messages: ${trace.summary.messageCount}`,
    `- Tool calls: ${trace.summary.toolCount}`,
    `- Tool errors: ${trace.summary.toolErrorCount}`,
    `- Tool counts: ${Object.entries(trace.summary.toolCounts).map(([name, count]) => `${name}=${count}`).join(', ') || 'none'}`,
    '',
    '## Conversation',
  ];

  for (const message of trace.messages) {
    lines.push('', `### ${message.role.toUpperCase()} · ${message.id}`, '', `- Created: ${message.createdAt}`);
    if (message.parentId) lines.push(`- Parent: \`${message.parentId}\``);
    if (message.finish) lines.push(`- Finish: \`${message.finish}\``);
    for (const part of message.parts) {
      if (part.type === 'text') {
        lines.push('', part.text || '_empty text_');
        continue;
      }
      if (part.type === 'tool') {
        lines.push(
          '',
          `#### TOOL · ${part.tool ?? 'unknown'} · ${part.callId ?? part.id}`,
          '',
          `- Status: \`${part.status ?? 'unknown'}\``,
          `- Created: ${part.createdAt}`,
          '',
          '**Input**',
          jsonBlock(part.input),
          '**Output**',
          jsonBlock(part.output),
        );
        if (part.error != null) lines.push('**Error**', jsonBlock(part.error));
        continue;
      }
      lines.push('', `#### PART · ${part.type}`, jsonBlock(part.data));
    }
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const db = new DatabaseSync(options.db, { readOnly: true });
  try {
    const session = resolveSession(db, options.input);
    if (!session) {
      throw new Error(`Session not found for identifier: ${options.input}`);
    }

    const messageRows = db
      .prepare('SELECT * FROM message WHERE session_id = ? ORDER BY time_created, id')
      .all(session.id);
    const partRows = db
      .prepare('SELECT * FROM part WHERE session_id = ? ORDER BY time_created, id')
      .all(session.id);
    const partsByMessage = new Map();
    for (const row of partRows) {
      const normalized = normalizePart(row);
      if (!normalized) continue;
      const values = partsByMessage.get(row.message_id) ?? [];
      values.push(normalized);
      partsByMessage.set(row.message_id, values);
    }

    const messages = messageRows.map((row) => {
      const data = parseJson(row.data, `message:${row.id}`);
      return {
        id: row.id,
        role: data.role ?? 'unknown',
        parentId: data.parentID ?? data.parentId ?? null,
        finish: data.finish ?? null,
        modelId: data.modelID ?? null,
        providerId: data.providerID ?? null,
        createdAt: isoTime(row.time_created),
        updatedAt: isoTime(row.time_updated),
        parts: partsByMessage.get(row.id) ?? [],
      };
    });

    const tools = messages.flatMap((message) => message.parts.filter((part) => part.type === 'tool'));
    const toolCounts = {};
    for (const tool of tools) toolCounts[tool.tool ?? 'unknown'] = (toolCounts[tool.tool ?? 'unknown'] ?? 0) + 1;
    const workbenchSessionId = path.basename(path.normalize(session.directory));
    const trace = {
      schemaVersion: 1,
      metadata: {
        inputIdentifier: options.input,
        nativeSessionId: session.id,
        workbenchSessionId,
        title: session.title,
        directory: session.directory,
        agent: session.agent,
        model: session.model ? parseJson(session.model, 'session:model') : null,
        harnessMetadata: session.metadata ? parseJson(session.metadata, 'session:metadata') : null,
        createdAt: isoTime(session.time_created),
        updatedAt: isoTime(session.time_updated),
        exportedAt: new Date().toISOString(),
        reasoningOmitted: true,
      },
      summary: {
        messageCount: messages.length,
        userMessageCount: messages.filter((message) => message.role === 'user').length,
        assistantMessageCount: messages.filter((message) => message.role === 'assistant').length,
        toolCount: tools.length,
        toolErrorCount: tools.filter((tool) => tool.status === 'error' || tool.error != null).length,
        toolCounts,
        toolSequence: tools.map((tool) => tool.tool ?? 'unknown'),
      },
      messages,
    };

    const outputDirectory = path.join(options.outputRoot, options.input);
    await mkdir(outputDirectory, { recursive: true });
    const markdownPath = path.join(outputDirectory, 'conversation.md');
    const tracePath = path.join(outputDirectory, 'trace.json');
    await Promise.all([
      writeFile(markdownPath, renderMarkdown(trace), 'utf8'),
      writeFile(tracePath, `${JSON.stringify(trace, null, 2)}\n`, 'utf8'),
    ]);

    process.stdout.write(`${JSON.stringify({
      inputIdentifier: options.input,
      nativeSessionId: session.id,
      workbenchSessionId,
      conversation: markdownPath,
      trace: tracePath,
      summary: trace.summary,
    }, null, 2)}\n`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  process.stderr.write(`EXPORT_SESSION_FAILED: ${error.message}\n`);
  process.exitCode = 1;
});
