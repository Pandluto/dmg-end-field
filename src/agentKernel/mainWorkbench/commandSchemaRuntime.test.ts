import assert from 'node:assert/strict';
import { normalizeMainWorkbenchCommand, validateMainWorkbenchCommand } from './commandSchemaRuntime.mjs';

const normalized = normalizeMainWorkbenchCommand({
  op: 'addSkillButton', characterName: '莱万汀', lineIndex: 1, nodeIndex: 0, skillType: 'A',
}) as Record<string, unknown>;
assert.equal(normalized.staffIndex, 1);
assert.equal('lineIndex' in normalized, false);
assert.equal((validateMainWorkbenchCommand(normalized) as { ok: boolean }).ok, true);
assert.equal((validateMainWorkbenchCommand({ op: 'addSkillButton', staffIndex: -1 }) as { ok: boolean }).ok, false);

console.log('main workbench command group normalization passed');
