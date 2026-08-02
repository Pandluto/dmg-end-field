import assert from 'node:assert/strict';
import type { WeaponDraft, WeaponEffectData, WeaponSkillData } from './weaponDraftModel';
import {
  canStartWeaponExplorerDrag,
  getWeaponExplorerDragNodeKey,
  getWeaponExplorerDragNodeLabel,
  isValidWeaponExplorerDropTarget,
  reorderWeaponExplorerLibrary,
  type WeaponExplorerDragNode,
  type WeaponExplorerDragPolicyState,
} from './weaponExplorerDragPolicy';

const createEffect = (name: string): WeaponEffectData => ({
  schemaVersion: 2,
  effectId: name,
  name,
  type: 'physicalDmgBonus',
  category: 'passive',
  levels: { '1': 10 },
});

const createSkill = (name: string, effects: Record<string, WeaponEffectData>): WeaponSkillData => ({
  name,
  statType: '',
  effects,
  levels: {},
});

const createDraft = (id: string, name: string): WeaponDraft => ({
  id,
  name,
  rarity: 6,
  type: 'test',
  description: '',
  imgUrl: '',
  attackGrowth: {},
  skills: {
    skill1: createSkill('技能一', {
      'skill1-effect-a': createEffect('技能一效果 A'),
      'skill1-effect-b': createEffect('技能一效果 B'),
    }),
    skill2: createSkill('技能二', {
      'skill2-effect-a': createEffect('技能二效果 A'),
      'skill2-effect-b': createEffect('技能二效果 B'),
    }),
    skill3: createSkill('技能三', {
      first: createEffect('第一个效果'),
      second: createEffect('第二个效果'),
      third: createEffect('第三个效果'),
    }),
  },
});

const draftA = createDraft('draft-a', '武器 A');
const draftB = createDraft('draft-b', '武器 B');
const library: Record<string, WeaponDraft> = { 'draft-a': draftA, 'draft-b': draftB };

const draftNode = { kind: 'draft', draftId: 'draft-a' } as const;
const otherDraftNode = { kind: 'draft', draftId: 'draft-b' } as const;
const skill1Node = { kind: 'skill', draftId: 'draft-a', skillKey: 'skill1' } as const;
const skill2Node = { kind: 'skill', draftId: 'draft-a', skillKey: 'skill2' } as const;
const skill3Node = { kind: 'skill', draftId: 'draft-a', skillKey: 'skill3' } as const;
const firstEffectNode = {
  kind: 'effect',
  draftId: 'draft-a',
  skillKey: 'skill3',
  bucket: 'effect',
  effectKey: 'first',
} as const;
const secondEffectNode = { ...firstEffectNode, effectKey: 'second' } as const;
const skill1EffectNode = {
  kind: 'effect',
  draftId: 'draft-a',
  skillKey: 'skill1',
  bucket: 'effect',
  effectKey: 'skill1-effect-a',
} as const;
const skill1OtherEffectNode = { ...skill1EffectNode, effectKey: 'skill1-effect-b' } as const;
const valueNode = {
  kind: 'effect',
  draftId: 'draft-a',
  skillKey: 'skill3',
  bucket: 'value',
  effectKey: 'value',
} as const;

const allNodes: WeaponExplorerDragNode[] = [
  draftNode,
  skill1Node,
  skill2Node,
  skill3Node,
  firstEffectNode,
  valueNode,
];

assert.deepEqual(firstEffectNode, {
  kind: 'effect',
  draftId: 'draft-a',
  skillKey: 'skill3',
  bucket: 'effect',
  effectKey: 'first',
});
assert.equal(getWeaponExplorerDragNodeKey(draftNode), 'draft:draft-a');
assert.equal(getWeaponExplorerDragNodeKey(skill3Node), 'skill:draft-a:skill3');
assert.equal(getWeaponExplorerDragNodeKey(firstEffectNode), 'effect:draft-a:skill3:effect:first');
assert.equal(getWeaponExplorerDragNodeKey(firstEffectNode), getWeaponExplorerDragNodeKey({ ...firstEffectNode }));
assert.equal(new Set(allNodes.map(getWeaponExplorerDragNodeKey)).size, allNodes.length);
assert.notEqual(getWeaponExplorerDragNodeKey(firstEffectNode), getWeaponExplorerDragNodeKey(valueNode));

assert.equal(getWeaponExplorerDragNodeLabel(library, draftNode), '武器 A');
assert.equal(getWeaponExplorerDragNodeLabel(library, skill3Node), '技能三');
assert.equal(getWeaponExplorerDragNodeLabel(library, firstEffectNode), '第一个效果');
assert.equal(getWeaponExplorerDragNodeLabel(library, valueNode), 'value');
assert.equal(getWeaponExplorerDragNodeLabel({}, firstEffectNode), 'draft-a');
assert.equal(
  getWeaponExplorerDragNodeLabel(library, { ...firstEffectNode, effectKey: 'missing-effect' }),
  'missing-effect',
);
const libraryWithMissingSkill = {
  'draft-a': { ...draftA, skills: {} },
} as unknown as Record<string, WeaponDraft>;
assert.equal(getWeaponExplorerDragNodeLabel(libraryWithMissingSkill, skill3Node), 'skill3');
assert.equal(getWeaponExplorerDragNodeLabel(libraryWithMissingSkill, valueNode), 'value');

const emptyDragState: WeaponExplorerDragPolicyState = { filterKeyword: '' };
assert.equal(canStartWeaponExplorerDrag(draftNode, emptyDragState), false);
assert.equal(canStartWeaponExplorerDrag(skill1Node, emptyDragState), false);
assert.equal(canStartWeaponExplorerDrag(skill2Node, emptyDragState), false);
assert.equal(canStartWeaponExplorerDrag(skill3Node, emptyDragState), false);
assert.equal(canStartWeaponExplorerDrag(skill1EffectNode, emptyDragState), false);
assert.equal(canStartWeaponExplorerDrag(valueNode, emptyDragState), false);
assert.equal(canStartWeaponExplorerDrag(firstEffectNode, emptyDragState), true);
for (const node of allNodes) {
  assert.equal(canStartWeaponExplorerDrag(node, { filterKeyword: '武器' }), false);
}
assert.equal(canStartWeaponExplorerDrag(firstEffectNode, { filterKeyword: '  武器  ' }), false);

assert.equal(isValidWeaponExplorerDropTarget(firstEffectNode, secondEffectNode, emptyDragState), true);
assert.equal(isValidWeaponExplorerDropTarget(firstEffectNode, null, emptyDragState), false);
assert.equal(isValidWeaponExplorerDropTarget(firstEffectNode, firstEffectNode, emptyDragState), false);
assert.equal(isValidWeaponExplorerDropTarget(firstEffectNode, draftNode, emptyDragState), false);
assert.equal(isValidWeaponExplorerDropTarget(draftNode, otherDraftNode, emptyDragState), false);
assert.equal(isValidWeaponExplorerDropTarget(firstEffectNode, skill3Node, emptyDragState), false);
assert.equal(
  isValidWeaponExplorerDropTarget(firstEffectNode, { ...secondEffectNode, draftId: 'draft-b' }, emptyDragState),
  false,
);
assert.equal(
  isValidWeaponExplorerDropTarget(firstEffectNode, { ...secondEffectNode, skillKey: 'skill2' }, emptyDragState),
  false,
);
assert.equal(isValidWeaponExplorerDropTarget(firstEffectNode, valueNode, emptyDragState), false);
assert.equal(isValidWeaponExplorerDropTarget(valueNode, firstEffectNode, emptyDragState), false);
assert.equal(isValidWeaponExplorerDropTarget(skill1EffectNode, skill1OtherEffectNode, emptyDragState), false);
assert.equal(
  isValidWeaponExplorerDropTarget(firstEffectNode, secondEffectNode, { filterKeyword: '武器' }),
  false,
);

const libraryBefore = JSON.parse(JSON.stringify(library)) as Record<string, WeaponDraft>;
const currentDraft = createDraft('draft-a', '当前编辑副本');
currentDraft.id = 'unsaved-edited-id';
currentDraft.skills.skill3.effects = {
  third: currentDraft.skills.skill3.effects.third,
  first: currentDraft.skills.skill3.effects.first,
  second: currentDraft.skills.skill3.effects.second,
};
const currentDraftBefore = JSON.parse(JSON.stringify(currentDraft)) as WeaponDraft;

const reorderedFromAfter = reorderWeaponExplorerLibrary(library, currentDraft, 'draft-a', secondEffectNode, firstEffectNode);
assert.ok(reorderedFromAfter);
assert.deepEqual(Object.keys(reorderedFromAfter.nextDraft.skills.skill3.effects), ['third', 'second', 'first']);
assert.equal(
  reorderedFromAfter.nextDraft.name,
  '当前编辑副本',
  'active draft key must select the unsaved current draft even after its id changes',
);
assert.equal(reorderedFromAfter.shouldUpdateCurrentDraft, true);
assert.strictEqual(reorderedFromAfter.nextLibrary['draft-a'], reorderedFromAfter.nextDraft);
assert.notStrictEqual(reorderedFromAfter.nextDraft, currentDraft);
assert.notStrictEqual(reorderedFromAfter.nextDraft.skills.skill3, currentDraft.skills.skill3);
assert.notStrictEqual(reorderedFromAfter.nextDraft.skills.skill3.effects, currentDraft.skills.skill3.effects);
assert.deepEqual(library, libraryBefore, 'library draft reorder must not mutate the source');
assert.deepEqual(currentDraft, currentDraftBefore, 'active current draft reorder must not mutate the source');

const reorderedFromBefore = reorderWeaponExplorerLibrary(library, currentDraft, 'draft-a', firstEffectNode, {
  ...firstEffectNode,
  effectKey: 'third',
});
assert.ok(reorderedFromBefore);
assert.deepEqual(
  Object.keys(reorderedFromBefore.nextDraft.skills.skill3.effects),
  ['first', 'third', 'second'],
  'moveRecordEntry target-index semantics are preserved',
);

const libraryWithoutDraftA: Record<string, WeaponDraft> = { 'draft-b': draftB };
const fallbackReorder = reorderWeaponExplorerLibrary(
  libraryWithoutDraftA,
  currentDraft,
  'draft-a',
  secondEffectNode,
  firstEffectNode,
);
assert.ok(fallbackReorder);
assert.equal(fallbackReorder.nextDraft.name, '当前编辑副本');
assert.equal(fallbackReorder.shouldUpdateCurrentDraft, true);
assert.deepEqual(Object.keys(fallbackReorder.nextLibrary), ['draft-b', 'draft-a']);
assert.deepEqual(Object.keys(fallbackReorder.nextDraft.skills.skill3.effects), ['third', 'second', 'first']);
assert.deepEqual(Object.keys(libraryWithoutDraftA), ['draft-b'], 'fallback reorder must not mutate library keys');
assert.deepEqual(currentDraft, currentDraftBefore, 'fallback reorder must not mutate current draft');

const notSelectedDraft = createDraft('draft-other', '另一个当前编辑副本');
const libraryPriorityWithoutCurrent = reorderWeaponExplorerLibrary(
  library,
  notSelectedDraft,
  'draft-other',
  secondEffectNode,
  firstEffectNode,
);
assert.ok(libraryPriorityWithoutCurrent);
assert.equal(libraryPriorityWithoutCurrent.shouldUpdateCurrentDraft, false);

assert.equal(reorderWeaponExplorerLibrary(library, currentDraft, 'draft-a', firstEffectNode, null), null);
assert.equal(
  reorderWeaponExplorerLibrary(library, currentDraft, 'draft-a', firstEffectNode, {
    ...secondEffectNode,
    effectKey: 'missing-effect',
  }),
  null,
);
assert.equal(
  reorderWeaponExplorerLibrary(library, currentDraft, 'draft-a', {
    ...firstEffectNode,
    effectKey: 'missing-effect',
  }, secondEffectNode),
  null,
);
assert.equal(reorderWeaponExplorerLibrary(library, currentDraft, 'draft-a', draftNode, otherDraftNode), null);
assert.equal(reorderWeaponExplorerLibrary(library, currentDraft, 'draft-a', firstEffectNode, valueNode), null);
assert.equal(
  reorderWeaponExplorerLibrary({}, null, 'draft-a', firstEffectNode, secondEffectNode),
  null,
);
assert.equal(
  reorderWeaponExplorerLibrary({}, createDraft('draft-other', '不匹配'), 'draft-other', firstEffectNode, secondEffectNode),
  null,
);

console.log('Weapon explorer drag policy contract: PASS');
