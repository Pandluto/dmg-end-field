import { runAiCliCommand, createFallbackDraft } from './aiCliCommandService';

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertTrue(value: unknown, message: string): void {
  if (!value) {
    throw new Error(`${message}: expected truthy, got ${value}`);
  }
}

function assertFalse(value: unknown, message: string): void {
  if (value) {
    throw new Error(`${message}: expected falsy, got ${value}`);
  }
}

const baseDraft = createFallbackDraft();

// 1. 空命令返回 type help
{
  const result = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-empty', client: 'rest', command: '' },
    baseDraft,
    { sourceText: '' }
  );
  assertEqual(result.ok, true, 'empty command should be ok');
  assertTrue(result.lines[0]?.includes('type help'), 'empty command should prompt type help');
}

// 2. 未知命令返回 unknown-command
{
  const result = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-unknown', client: 'rest', command: 'nonexistent.command' },
    baseDraft,
    { sourceText: '' }
  );
  assertFalse(result.ok, 'unknown command should not be ok');
  assertEqual(result.error?.code, 'unknown-command', 'unknown command should have code unknown-command');
}

// 3. fill.check 无效 modifier type 返回 fill-invalid
{
  const invalidDraft = {
    id: 'test-invalid',
    name: 'Test',
    sourceName: 'test',
    source: 'ai',
    description: 'test',
    items: [
      {
        name: 'Item',
        sourceName: 'test',
        description: 'test',
        effects: [
          {
            displayName: 'Bad Effect',
            name: 'bad-effect',
            level: '',
            source: 'ai',
            sourceName: 'test',
            description: 'test',
            condition: '',
            effectKind: 'modifier',
            type: 'invalidType',
            value: 0.2,
            evidenceText: 'test',
            confidence: 0.9,
          },
        ],
      },
    ],
  };
  const result = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-fill-invalid', client: 'rest', command: `fill.check ${JSON.stringify({ protocolVersion: 1, requestId: 'test', draft: invalidDraft })}` },
    baseDraft,
    { sourceText: '' }
  );
  assertFalse(result.ok, 'invalid fill.check should not be ok');
  assertEqual(result.error?.code, 'fill-invalid', 'invalid modifier type should return fill-invalid');
}

// 4. fill.task REST 返回 data 且无 copyText
{
  const result = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-fill-task-rest', client: 'rest', command: 'fill.task' },
    baseDraft,
    { sourceText: '' }
  );
  assertEqual(result.ok, true, 'fill.task REST should be ok');
  assertTrue(typeof result.data === 'object' && result.data !== null, 'fill.task should return data');
  const data = result.data as { tool?: unknown };
  assertEqual(data.tool, 'buff.fill', 'fill.task should return data.tool');
  assertEqual(result.copyText, undefined, 'fill.task REST should not have copyText');
}

// 5. fill.task web-cli 返回 data 且有可解析 copyText
{
  const result = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-fill-task-webcli', client: 'web-cli', command: 'fill.task' },
    baseDraft,
    { sourceText: '' }
  );
  assertEqual(result.ok, true, 'fill.task web-cli should be ok');
  assertTrue(typeof result.data === 'object' && result.data !== null, 'fill.task web-cli should return data');
  const data = result.data as { tool?: unknown };
  assertEqual(data.tool, 'buff.fill', 'fill.task web-cli should return data.tool');
  assertTrue(typeof result.copyText === 'string', 'fill.task web-cli should have copyText string');
  const parsed = JSON.parse(result.copyText!);
  assertEqual(parsed.tool, 'buff.fill', 'copyText should be parseable task package');
}

console.log('[ai-cli-command-service-test] passed');
