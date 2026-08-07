import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentProductSession } from '../../../agent/core/contracts/browser-protocol';
import { archivedSessionsForRecovery } from './AgentModeOverlay';

function session(
  defSessionId: string,
  status: AgentProductSession['status'],
  updatedAt: string,
): AgentProductSession {
  return {
    schemaVersion: 6,
    eventSchemaVersion: 1,
    defSessionId: defSessionId as AgentProductSession['defSessionId'],
    host: 'workbench',
    status,
    workspaceId: 'workspace' as AgentProductSession['workspaceId'],
    lastDatabaseGeneration: 'generation' as AgentProductSession['lastDatabaseGeneration'],
    timelineId: 'timeline' as AgentProductSession['timelineId'],
    axisBindingId: null,
    boundNodeId: null,
    engine: { kind: 'opencode', runtimeVersion: '1.17.11-def.1' },
    harness: { stateVersion: 1, revision: 'test' },
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt,
  };
}

test('Agent Mode exposes only archived sessions for explicit recovery', () => {
  const sessions = [
    session('def-ready', 'ready', '2026-08-08T00:00:04.000Z'),
    session('def-old-archived', 'archived', '2026-08-08T00:00:01.000Z'),
    session('def-new-archived', 'archived', '2026-08-08T00:00:03.000Z'),
  ];
  const recovered = archivedSessionsForRecovery(sessions);

  assert.deepEqual(recovered.map((candidate) => candidate.defSessionId), [
    'def-new-archived',
    'def-old-archived',
  ]);
  assert.deepEqual(sessions.map((candidate) => candidate.defSessionId), [
    'def-ready',
    'def-old-archived',
    'def-new-archived',
  ]);
});
