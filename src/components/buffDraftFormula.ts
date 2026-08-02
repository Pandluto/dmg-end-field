import type {
  BuffDraft,
  BuffSheetRow,
} from './buffDraftModel';
import { buildBuffDraftIdFromName } from './buffDraftModel';

export type BuffFormulaTextCell = {
  columnKey?: string;
};

export type BuffFormulaTextBinding = {
  key: string;
  focusId: string;
  value: string;
  placeholder: string;
  apply: (draft: BuffDraft, nextValue: string) => BuffDraft;
};

export type BuffFormulaTextBindingContext = {
  selectedWorkbookSummary: BuffSheetRow | null | undefined;
  selectedWorkbookCell: BuffFormulaTextCell | null | undefined;
  draft: BuffDraft;
};

export function createBuffFormulaTextBinding({
  selectedWorkbookSummary,
  selectedWorkbookCell,
  draft,
}: BuffFormulaTextBindingContext): BuffFormulaTextBinding | null {
  if (!selectedWorkbookSummary) {
    return null;
  }

  if (selectedWorkbookSummary.kind === 'group') {
    if (selectedWorkbookCell?.columnKey === 'idText') {
      return {
        key: 'group:id',
        focusId: 'group-id',
        value: draft.id,
        placeholder: '组 ID',
        apply: (baseDraft, nextValue) => baseDraft.id === nextValue
          ? baseDraft
          : { ...baseDraft, id: nextValue },
      };
    }
    if (selectedWorkbookCell?.columnKey === 'description') {
      return {
        key: 'group:description',
        focusId: 'group-description',
        value: draft.description,
        placeholder: '组描述',
        apply: (baseDraft, nextValue) => baseDraft.description === nextValue
          ? baseDraft
          : { ...baseDraft, description: nextValue },
      };
    }
    return {
      key: 'group:name',
      focusId: 'group-name',
      value: draft.name,
      placeholder: '组名称',
      apply: (baseDraft, nextValue) => {
        const nextId = buildBuffDraftIdFromName(nextValue) || baseDraft.id;
        if (baseDraft.name === nextValue && baseDraft.id === nextId) {
          return baseDraft;
        }
        return {
          ...baseDraft,
          name: nextValue,
          id: nextId,
        };
      },
    };
  }

  if (selectedWorkbookSummary.kind === 'item') {
    const selectedItem = draft.items[selectedWorkbookSummary.itemKey];
    if (!selectedItem) {
      return null;
    }
    if (selectedWorkbookCell?.columnKey === 'idText') {
      return {
        key: `item:${selectedItem.id}:id`,
        focusId: 'item-id',
        value: selectedItem.id,
        placeholder: '项 ID',
        apply: (baseDraft, nextValue) => {
          const item = baseDraft.items[selectedWorkbookSummary.itemKey];
          if (!item || item.id === nextValue) {
            return baseDraft;
          }
          return {
            ...baseDraft,
            items: {
              ...baseDraft.items,
              [selectedWorkbookSummary.itemKey]: { ...item, id: nextValue },
            },
          };
        },
      };
    }
    if (selectedWorkbookCell?.columnKey === 'description') {
      return {
        key: `item:${selectedItem.id}:description`,
        focusId: 'item-description',
        value: selectedItem.description,
        placeholder: '项描述',
        apply: (baseDraft, nextValue) => {
          const item = baseDraft.items[selectedWorkbookSummary.itemKey];
          if (!item || item.description === nextValue) {
            return baseDraft;
          }
          return {
            ...baseDraft,
            items: {
              ...baseDraft.items,
              [selectedWorkbookSummary.itemKey]: { ...item, description: nextValue },
            },
          };
        },
      };
    }
    return {
      key: `item:${selectedItem.id}:name`,
      focusId: 'item-name',
      value: selectedItem.name,
      placeholder: '项名称',
      apply: (baseDraft, nextValue) => {
        const item = baseDraft.items[selectedWorkbookSummary.itemKey];
        if (!item || item.name === nextValue) {
          return baseDraft;
        }
        return {
          ...baseDraft,
          items: {
            ...baseDraft.items,
            [selectedWorkbookSummary.itemKey]: { ...item, name: nextValue },
          },
        };
      },
    };
  }

  if (selectedWorkbookSummary.kind === 'effect') {
    const selectedItem = draft.items[selectedWorkbookSummary.itemKey];
    const selectedEffect = selectedItem?.effects[selectedWorkbookSummary.effectKey];
    if (!selectedEffect) {
      return null;
    }
    switch (selectedWorkbookCell?.columnKey) {
      case 'condition':
        return {
          key: `effect:${selectedEffect.id}:condition`,
          focusId: 'effect-condition',
          value: selectedEffect.condition || '',
          placeholder: '条件',
          apply: (baseDraft, nextValue) => {
            const item = baseDraft.items[selectedWorkbookSummary.itemKey];
            const effect = item?.effects[selectedWorkbookSummary.effectKey];
            if (!item || !effect || effect.condition === nextValue) {
              return baseDraft;
            }
            return {
              ...baseDraft,
              items: {
                ...baseDraft.items,
                [selectedWorkbookSummary.itemKey]: {
                  ...item,
                  effects: {
                    ...item.effects,
                    [selectedWorkbookSummary.effectKey]: { ...effect, condition: nextValue },
                  },
                },
              },
            };
          },
        };
      case 'description':
        return {
          key: `effect:${selectedEffect.id}:description`,
          focusId: 'effect-description',
          value: selectedEffect.description || '',
          placeholder: '描述',
          apply: (baseDraft, nextValue) => {
            const item = baseDraft.items[selectedWorkbookSummary.itemKey];
            const effect = item?.effects[selectedWorkbookSummary.effectKey];
            if (!item || !effect || effect.description === nextValue) {
              return baseDraft;
            }
            return {
              ...baseDraft,
              items: {
                ...baseDraft.items,
                [selectedWorkbookSummary.itemKey]: {
                  ...item,
                  effects: {
                    ...item.effects,
                    [selectedWorkbookSummary.effectKey]: { ...effect, description: nextValue },
                  },
                },
              },
            };
          },
        };
      default:
        return {
          key: `effect:${selectedEffect.id}:displayName`,
          focusId: 'effect-display-name',
          value: selectedEffect.displayName,
          placeholder: '效果名称',
          apply: (baseDraft, nextValue) => {
            const item = baseDraft.items[selectedWorkbookSummary.itemKey];
            const effect = item?.effects[selectedWorkbookSummary.effectKey];
            if (!item || !effect || effect.displayName === nextValue) {
              return baseDraft;
            }
            return {
              ...baseDraft,
              items: {
                ...baseDraft.items,
                [selectedWorkbookSummary.itemKey]: {
                  ...item,
                  effects: {
                    ...item.effects,
                    [selectedWorkbookSummary.effectKey]: { ...effect, displayName: nextValue },
                  },
                },
              },
            };
          },
        };
    }
  }

  return null;
}
