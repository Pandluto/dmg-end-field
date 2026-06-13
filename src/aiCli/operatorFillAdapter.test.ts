import { OPERATOR_LIBRARY_STORAGE_KEY, operatorFillAdapter } from './operatorFillAdapter';

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

function installLocalStorageMock() {
  const data = new Map<string, string>();
  (globalThis as unknown as {
    window: {
      localStorage: {
        getItem(key: string): string | null;
        setItem(key: string, value: string): void;
        removeItem(key: string): void;
        clear(): void;
      };
    };
  }).window = {
    localStorage: {
      getItem(key: string) {
        return data.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        data.set(key, value);
      },
      removeItem(key: string) {
        data.delete(key);
      },
      clear() {
        data.clear();
      },
    },
  };
  return data;
}

const keyLevels = {
  level1: 101,
  level20: 202,
  level40: 404,
  level60: 606,
  level80: 808,
  level90: 909,
};

const validDraft = {
  id: 'jieerpeita',
  name: '洁尔佩塔',
  avatarUrl: '',
  rarity: 6,
  profession: '辅助',
  weapon: '法术单元',
  element: 'nature',
  mainStat: '智识',
  subStat: '意志',
  level: 90,
  attributes: {
    strength: keyLevels,
    agility: keyLevels,
    intelligence: keyLevels,
    will: keyLevels,
    atk: keyLevels,
    hp: keyLevels,
  },
  skills: {
    'skill-1': {
      displayName: '战技',
      buttonType: 'B',
      iconUrl: '',
      hitCount: 1,
      hitMeta: {
        hit1: {
          displayName: '第1击',
          element: 'nature',
          skillType: 'B',
          levels: {
            L1: 1, L2: 2, L3: 3, L4: 4, L5: 5, L6: 6,
            L7: 7, L8: 8, L9: 9, M1: 10, M2: 11, M3: 12,
          },
        },
      },
    },
  },
  buffs: {
    talent: { effects: {} },
    potential: { effects: {} },
    skill: { effects: {} },
  },
};

{
  const result = operatorFillAdapter.validateAiDraft(JSON.stringify(validDraft));
  assertEqual(result.ok, true, 'six key-level attributes should validate');
  assertEqual(result.normalized?.attributes.intelligence.level90, 909, 'normalize should preserve level90');
  assertEqual(result.normalized?.attributes.hp.level1, 101, 'normalize should preserve level1');
}

{
  const storage = installLocalStorageMock();
  storage.set(OPERATOR_LIBRARY_STORAGE_KEY, JSON.stringify({
    [validDraft.id]: {
      ...validDraft,
      avatarUrl: '/assets/operators/jieerpeita.png',
      skills: {
        'skill-1': {
          ...validDraft.skills['skill-1'],
          iconUrl: '/assets/skills/jieerpeita-skill.png',
        },
      },
    },
  }));
  const incomingDraft = {
    ...validDraft,
    avatarUrl: '',
    skills: {
      'skill-1': {
        ...validDraft.skills['skill-1'],
        iconUrl: '',
      },
    },
  };
  const validation = operatorFillAdapter.validateAiDraft(JSON.stringify(incomingDraft));
  assertEqual(validation.ok, true, 'incoming operator draft with empty urls should validate');
  const proposal = operatorFillAdapter.createProposalPayload(validation, 'operator.fill.apply test');
  assertEqual(proposal.normalized.avatarUrl, '/assets/operators/jieerpeita.png', 'proposal should preserve existing avatarUrl');
  assertEqual(proposal.normalized.skills['skill-1'].iconUrl, '/assets/skills/jieerpeita-skill.png', 'proposal should preserve existing skill iconUrl');
}

{
  const invalidDraft = {
    ...validDraft,
    attributes: {
      ...validDraft.attributes,
      intelligence: {
        ...keyLevels,
        level2: 112,
      },
    },
  };
  const result = operatorFillAdapter.validateAiDraft(JSON.stringify(invalidDraft));
  assertEqual(result.ok, false, 'full 90-level attributes should not validate silently');
  assertTrue(
    result.errors.some((error) => error.includes('attributes.intelligence.level2')),
    'invalid attribute level should be reported',
  );
}

console.log('[operator-fill-adapter-test] passed');
