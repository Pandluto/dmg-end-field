import assert from 'node:assert/strict';
import { isWorkbenchRendererBridgeUrl } from './workbenchRendererCapability';

assert.equal(isWorkbenchRendererBridgeUrl('http://127.0.0.1:31457/api/main-workbench/snapshot'), true);
assert.equal(isWorkbenchRendererBridgeUrl('http://127.0.0.1:31457/local-data/timeline-documents'), true);
assert.equal(isWorkbenchRendererBridgeUrl('http://localhost:31457/api/main-workbench/snapshot'), false);
assert.equal(isWorkbenchRendererBridgeUrl('https://attacker.example/api/main-workbench/snapshot'), false);
assert.equal(isWorkbenchRendererBridgeUrl('not a valid absolute target'), false);

console.log('Workbench renderer capability origin contract passed');
