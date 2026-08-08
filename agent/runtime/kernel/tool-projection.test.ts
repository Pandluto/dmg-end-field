import assert from 'node:assert/strict';
import test from 'node:test';
import type { EngineToolProjectionInput } from '../../core/contracts/engine.ts';
import type { EngineToolDescriptor } from '../../core/contracts/engine.ts';
import {
  RuntimeToolProjectionError,
  RuntimeToolProjectionState,
  toEngineToolProjection,
  toRuntimeToolProjection,
} from './tool-projection.ts';

function descriptor(name: string, risk: EngineToolDescriptor['risk'] = 'read'): EngineToolDescriptor {
  return {
    name,
    description: `${name} description`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { value: { type: 'string' } },
    },
    risk,
  };
}

function projection(revision: number, ...names: string[]): EngineToolProjectionInput {
  return { revision, tools: names.map((name) => descriptor(name)) };
}

test('Host projection maps deterministically and snapshots mutable descriptors', () => {
  const source = projection(1, 'def.harness.route', 'def.node.crud.context');
  const first = toRuntimeToolProjection(source);
  const second = toRuntimeToolProjection(source);

  assert.deepEqual(first, second);
  assert.deepEqual(toEngineToolProjection(first), source);
  assert.deepEqual(first.tools.map((tool) => tool.name), [
    'def.harness.route',
    'def.node.crud.context',
  ]);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.tools), true);
  assert.equal(Object.isFrozen(first.tools[0]!.inputSchema), true);

  (source.tools[0]!.inputSchema.properties as Record<string, unknown>).value = { type: 'boolean' };
  assert.deepEqual(first.tools[0]!.inputSchema.properties, { value: { type: 'string' } });
});

test('projection state accepts monotonic Host revisions and allocates registry revisions', () => {
  const state = new RuntimeToolProjectionState(projection(1, 'route'));
  assert.equal(state.revision, 1);

  const next = state.apply(projection(2, 'context'));
  assert.equal(next.revision, 2);
  assert.deepEqual(next.tools.map((tool) => tool.name), ['context']);

  const repeated = state.apply(projection(2, 'context'));
  assert.strictEqual(repeated, next);

  const allocated = state.apply([descriptor('context'), descriptor('data')]);
  assert.equal(allocated.revision, 3);
  assert.deepEqual(allocated.tools.map((tool) => tool.name), ['context', 'data']);
});

test('stale and same-revision conflicting projections fail closed', () => {
  const state = new RuntimeToolProjectionState(projection(2, 'route'));

  assert.throws(
    () => state.apply(projection(1, 'route')),
    (error: unknown) => error instanceof RuntimeToolProjectionError
      && error.code === 'RUNTIME_TOOL_PROJECTION_STALE',
  );
  assert.throws(
    () => state.apply(projection(2, 'different')),
    (error: unknown) => error instanceof RuntimeToolProjectionError
      && error.code === 'RUNTIME_TOOL_PROJECTION_CONFLICT',
  );
});

test('duplicate Host descriptors are rejected instead of silently remapped', () => {
  assert.throws(
    () => toRuntimeToolProjection(projection(1, 'route', 'route')),
    (error: unknown) => error instanceof RuntimeToolProjectionError
      && error.code === 'RUNTIME_TOOL_PROJECTION_INVALID',
  );
});

test('registry capabilities preserve Host order and receive a monotonic revision', () => {
  const registry = {
    listDescriptors: () => [descriptor('second', 'mutate'), descriptor('first', 'propose')],
  };
  const state = new RuntimeToolProjectionState({ revision: 4, tools: [] });
  const next = state.updateFromCapabilities(registry);

  assert.equal(next.revision, 5);
  assert.deepEqual(next.tools.map((tool) => [tool.name, tool.risk]), [
    ['second', 'mutate'],
    ['first', 'propose'],
  ]);
});
