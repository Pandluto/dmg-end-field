import type {
  BuffDraft,
  BuffEffectDraft,
  BuffItemDraft,
  BuffSheetRow,
  BuffWorkbookSelection,
} from './buffDraftPageModel';

interface BuildBuffFormulaTextBindingOptions {
  draft: BuffDraft;
  selectedEffect: BuffEffectDraft | null | undefined;
  selectedItem: BuffItemDraft | null | undefined;
  selectedWorkbookCell: BuffWorkbookSelection | null;
  selectedWorkbookSummary: BuffSheetRow | null | undefined;
  updateDraftField: (field: 'id' | 'name' | 'description', nextValue: string) => void;
  updateSelectedEffect: (updater: (effect: BuffEffectDraft) => BuffEffectDraft) => void;
  updateSelectedItem: (updater: (item: BuffItemDraft) => BuffItemDraft) => void;
}

export function buildBuffFormulaTextBinding({
  draft,
  selectedEffect,
  selectedItem,
  selectedWorkbookCell,
  selectedWorkbookSummary,
  updateDraftField,
  updateSelectedEffect,
  updateSelectedItem,
}: BuildBuffFormulaTextBindingOptions) {
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
          commit: (nextValue: string) => updateDraftField('id', nextValue),
        };
      }
      if (selectedWorkbookCell?.columnKey === 'description') {
        return {
          key: 'group:description',
          focusId: 'group-description',
          value: draft.description,
          placeholder: '组描述',
          commit: (nextValue: string) => updateDraftField('description', nextValue),
        };
      }
      return {
        key: 'group:name',
        focusId: 'group-name',
        value: draft.name,
        placeholder: '组名称',
        commit: (nextValue: string) => updateDraftField('name', nextValue),
      };
    }

    if (selectedWorkbookSummary.kind === 'item' && selectedItem) {
      if (selectedWorkbookCell?.columnKey === 'idText') {
        return {
          key: `item:${selectedItem.id}:id`,
          focusId: 'item-id',
          value: selectedItem.id,
          placeholder: '项 ID',
          commit: (nextValue: string) => updateSelectedItem((prev) => ({ ...prev, id: nextValue })),
        };
      }
      if (selectedWorkbookCell?.columnKey === 'description') {
        return {
          key: `item:${selectedItem.id}:description`,
          focusId: 'item-description',
          value: selectedItem.description,
          placeholder: '项描述',
          commit: (nextValue: string) => updateSelectedItem((prev) => ({ ...prev, description: nextValue })),
        };
      }
      return {
        key: `item:${selectedItem.id}:name`,
        focusId: 'item-name',
        value: selectedItem.name,
        placeholder: '项名称',
        commit: (nextValue: string) => updateSelectedItem((prev) => ({ ...prev, name: nextValue })),
      };
    }

    if (selectedWorkbookSummary.kind === 'effect' && selectedEffect) {
      switch (selectedWorkbookCell?.columnKey) {
        case 'condition':
          return {
            key: `effect:${selectedEffect.id}:condition`,
            focusId: 'effect-condition',
            value: selectedEffect.condition || '',
            placeholder: '条件',
            commit: (nextValue: string) => updateSelectedEffect((prev) => ({ ...prev, condition: nextValue })),
          };
        case 'description':
          return {
            key: `effect:${selectedEffect.id}:description`,
            focusId: 'effect-description',
            value: selectedEffect.description || '',
            placeholder: '描述',
            commit: (nextValue: string) => updateSelectedEffect((prev) => ({ ...prev, description: nextValue })),
          };
        default:
          return {
            key: `effect:${selectedEffect.id}:displayName`,
            focusId: 'effect-display-name',
            value: selectedEffect.displayName,
            placeholder: '效果名称',
            commit: (nextValue: string) => updateSelectedEffect((prev) => ({ ...prev, displayName: nextValue })),
          };
      }
    }

    return null;

}
