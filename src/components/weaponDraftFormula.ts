import { normalizeExtraHitConfig } from '../core/services/buffExtraHit';
import * as buffModel from './operatorDraftBuffModel';
import {
  EFFECT_CATEGORY_OPTIONS,
  SKILL1_OPTIONS,
  SKILL2_OPTIONS,
  WEAPON_BUFF_TYPE_OPTIONS,
  buildWeaponIdFromName,
  getBuffTypeDisplayLabel,
  getEffectCategory,
  parseInlineLevelAddress,
  projectWeaponEffectForLevel,
  applyWeaponDrawerEffect,
  type FormulaBinding,
  type WeaponDraft,
  type WeaponSheetRow,
  type WeaponWorkbookSelection,
} from './weaponDraftPageModel';

export function buildWeaponFormulaBinding(
  draft: WeaponDraft,
  selectedWorkbookCell: WeaponWorkbookSelection | null,
  selectedWorkbookSummary: WeaponSheetRow | null | undefined,
): FormulaBinding | null {
    if (!selectedWorkbookSummary) {
      return null;
    }

    // 对于 effectLevels 类型，必须解析 address 来确定具体的 level
    const inlineLevelKey = selectedWorkbookSummary.kind === 'effectLevels'
      ? parseInlineLevelAddress(selectedWorkbookCell?.address)
      : '';

    if (selectedWorkbookSummary.kind === 'weapon') {
      if (selectedWorkbookCell?.columnKey === 'slot') {
        return {
          key: 'weapon:imgUrl',
          focusId: 'weapon-img-url',
          inputMode: 'text',
          control: 'image-search-select',
          value: draft.imgUrl,
          placeholder: '搜索武器主图',
          apply: (baseDraft, rawInput) => ({ ...baseDraft, imgUrl: rawInput.trim() }),
        };
      }
      if (selectedWorkbookCell?.columnKey === 'idText') {
        return {
          key: 'weapon:id',
          focusId: 'weapon-id',
          inputMode: 'text',
          value: draft.id,
          placeholder: '武器 ID',
          apply: (baseDraft, rawInput) => ({ ...baseDraft, id: rawInput.trim() || baseDraft.id }),
        };
      }
      if (selectedWorkbookCell?.columnKey === 'valueText') {
        return {
          key: 'weapon:rarity',
          focusId: 'weapon-rarity',
          inputMode: 'number',
          value: String(draft.rarity),
          placeholder: '稀有度',
          apply: (baseDraft, rawInput) => {
            const parsed = Number(rawInput);
            return { ...baseDraft, rarity: Number.isFinite(parsed) ? parsed : baseDraft.rarity };
          },
        };
      }
      if (selectedWorkbookCell?.columnKey === 'description') {
        return {
          key: 'weapon:description',
          focusId: 'weapon-description',
          inputMode: 'text',
          value: draft.description,
          placeholder: '武器描述',
          apply: (baseDraft, rawInput) => ({ ...baseDraft, description: rawInput }),
        };
      }
      return {
        key: 'weapon:name',
        focusId: 'weapon-name',
        inputMode: 'text',
        value: draft.name,
        placeholder: '武器名称',
        apply: (baseDraft, rawInput) => ({
          ...baseDraft,
          name: rawInput,
          id: buildWeaponIdFromName(rawInput) || baseDraft.id,
        }),
      };
    }

    if (selectedWorkbookSummary.kind === 'growth') {
      return null;
    }

    if (selectedWorkbookSummary.kind === 'skill') {
      const targetSkill = draft.skills[selectedWorkbookSummary.skillKey];
      const skillKey = selectedWorkbookSummary.skillKey;
      const statOptions = skillKey === 'skill1'
        ? SKILL1_OPTIONS.map((value) => ({ value, label: value }))
        : skillKey === 'skill2'
          ? SKILL2_OPTIONS.map((value) => ({ value, label: value }))
          : null;
      if (selectedWorkbookCell?.columnKey === 'slot') {
        return {
          key: `${skillKey}:statType`,
          focusId: 'skill-stat-type',
          inputMode: 'text',
          control: statOptions ? 'select' : 'input',
          value: targetSkill.statType,
          placeholder: 'skill statType',
          options: statOptions ?? undefined,
          apply: (baseDraft, rawInput) => ({
            ...baseDraft,
            skills: {
              ...baseDraft.skills,
              [skillKey]: {
                ...baseDraft.skills[skillKey],
                statType: rawInput,
              },
            },
          }),
        };
      }
      return {
        key: `${skillKey}:name`,
        focusId: 'skill-name',
        inputMode: 'text',
        value: targetSkill.name,
        placeholder: 'skill 名称',
        readOnly: skillKey !== 'skill3',
        apply: (baseDraft, rawInput) => ({
          ...baseDraft,
          skills: {
            ...baseDraft.skills,
            [skillKey]: {
              ...baseDraft.skills[skillKey],
              name: rawInput,
            },
          },
        }),
      };
    }

    if (selectedWorkbookSummary.kind === 'effect') {
      const { skillKey, bucket, sourceEffectKey } = selectedWorkbookSummary;
      const fixedStatOptions = skillKey === 'skill1'
        ? SKILL1_OPTIONS.map((value) => ({ value, label: value }))
        : skillKey === 'skill2'
          ? SKILL2_OPTIONS.map((value) => ({ value, label: value }))
          : null;
      const buffTypeOptions = [
        { value: '', label: '未设置类型' },
        ...WEAPON_BUFF_TYPE_OPTIONS.map((value) => ({ value, label: getBuffTypeDisplayLabel(value) })),
      ];
      if (
        selectedWorkbookCell?.columnKey === 'name'
        || selectedWorkbookCell?.columnKey === 'idText'
        || selectedWorkbookCell?.columnKey === 'slot'
      ) {
        if (selectedWorkbookCell?.columnKey === 'name') {
          if (fixedStatOptions && bucket === 'value') {
            return {
              key: `${skillKey}:fixed-effect-name`,
              focusId: 'fixed-effect-name',
              inputMode: 'text',
              control: 'select',
              value: draft.skills[skillKey].statType,
              placeholder: '',
              options: fixedStatOptions,
              apply: (baseDraft, rawInput) => ({
                ...baseDraft,
                skills: {
                  ...baseDraft.skills,
                  [skillKey]: {
                    ...baseDraft.skills[skillKey],
                    statType: rawInput,
                  },
                },
              }),
            };
          }
          return {
            key: `${skillKey}:effect-name`,
            focusId: 'effect-name',
            inputMode: 'text',
            value: draft.skills[skillKey].effects[sourceEffectKey].name,
            placeholder: '效果名称',
            readOnly: bucket === 'value',
            apply: (baseDraft, rawInput) => {
              if (bucket === 'value') {
                return baseDraft;
              }
              const trimmed = rawInput.trim();
              if (!trimmed) {
                return baseDraft;
              }
              const nextEffects = { ...baseDraft.skills[skillKey].effects };
              if (nextEffects[sourceEffectKey]) {
                nextEffects[sourceEffectKey] = {
                  ...nextEffects[sourceEffectKey],
                  name: trimmed,
                };
              }
              return {
                ...baseDraft,
                skills: {
                  ...baseDraft.skills,
                  [skillKey]: {
                    ...baseDraft.skills[skillKey],
                    effects: nextEffects,
                  },
                },
              };
            },
          };
        }
        if (selectedWorkbookCell?.columnKey === 'slot' && skillKey === 'skill3' && bucket !== 'value') {
          return {
            key: `${skillKey}:effect:${sourceEffectKey}:effect-category`,
            focusId: 'effect-category',
            inputMode: 'text',
            control: 'select',
            value: getEffectCategory(skillKey, draft.skills[skillKey], sourceEffectKey),
            placeholder: '',
            options: EFFECT_CATEGORY_OPTIONS,
            apply: (baseDraft, rawInput) => {
              const businessType = buffModel.OPERATOR_BUFF_BUSINESS_TYPES.includes(rawInput as buffModel.OperatorBuffBusinessType)
                ? rawInput as buffModel.OperatorBuffBusinessType
                : 'condition';
              const nextEffects = { ...baseDraft.skills[skillKey].effects };
              const current = nextEffects[sourceEffectKey];
              if (!current) return baseDraft;
              const projected = projectWeaponEffectForLevel(sourceEffectKey, current, '9');
              const nextEffect = buffModel.applyBuffBusinessType(projected, businessType, sourceEffectKey);
              nextEffects[sourceEffectKey] = applyWeaponDrawerEffect(current, '9', nextEffect);
              return {
                ...baseDraft,
                skills: {
                  ...baseDraft.skills,
                  [skillKey]: {
                    ...baseDraft.skills[skillKey],
                    effects: nextEffects,
                  },
                },
              };
            },
          };
        }
        return {
          key: `${skillKey}:${bucket}:${sourceEffectKey}:${selectedWorkbookCell?.columnKey}`,
          focusId: `effect-${selectedWorkbookCell?.columnKey}`,
          inputMode: 'text',
          readOnly: true,
          value:
            selectedWorkbookCell?.columnKey === 'idText'
                ? selectedWorkbookSummary.idText
                : selectedWorkbookCell?.columnKey === 'slot'
                  ? selectedWorkbookSummary.slot
                  : '',
          placeholder: '',
          apply: (baseDraft) => baseDraft,
        };
      }

      if (selectedWorkbookCell?.columnKey === 'effectKey') {
        if (bucket === 'value') {
          return {
            key: `${skillKey}:value:key`,
            focusId: 'effect-key',
            inputMode: 'text',
            readOnly: true,
            value: 'value',
            placeholder: '',
            apply: (baseDraft) => baseDraft,
          };
        }
        if (skillKey === 'skill3') {
          const selectedEffect = draft.skills[skillKey].effects[sourceEffectKey];
          if (selectedEffect?.effectKind === 'extraHit') {
            const config = normalizeExtraHitConfig(selectedEffect.extraHitConfig, `${sourceEffectKey}-extra-hit`);
            return {
              key: `${skillKey}:effect:${sourceEffectKey}:extra-hit-types`,
              focusId: 'effect-extra-hit-types',
              inputMode: 'text',
              readOnly: true,
              value: `${config.damageType} / ${config.skillType || '空'}`,
              placeholder: '',
              apply: (baseDraft) => baseDraft,
            };
          }
          return {
            key: `${skillKey}:effect:${sourceEffectKey}:buff-type`,
            focusId: 'effect-buff-type',
            inputMode: 'text',
            control: 'search-select',
            value: draft.skills[skillKey].effects[sourceEffectKey]?.type ?? '',
            placeholder: '',
            options: buffTypeOptions,
            apply: (baseDraft, rawInput) => {
              const trimmed = rawInput.trim();
              const nextEffects = { ...baseDraft.skills[skillKey].effects };
              if (nextEffects[sourceEffectKey]) {
                nextEffects[sourceEffectKey] = {
                  ...nextEffects[sourceEffectKey],
                  type: trimmed,
                };
              }
              return {
                ...baseDraft,
                skills: {
                  ...baseDraft.skills,
                  [skillKey]: {
                    ...baseDraft.skills[skillKey],
                    effects: nextEffects,
                  },
                },
              };
            },
          };
        }
        return {
          key: `${skillKey}:${bucket}:${sourceEffectKey}:key`,
          focusId: 'effect-key',
          inputMode: 'text',
          value: sourceEffectKey,
          placeholder: '效果键',
          readOnly: true,
          apply: (baseDraft) => baseDraft,
        };
      }

      if (selectedWorkbookCell?.columnKey === 'description') {
        return {
          key: `${skillKey}:${bucket}:${sourceEffectKey}:description`,
          focusId: 'effect-description',
          inputMode: 'text',
          value: '',
          placeholder: '效果描述',
          readOnly: true,
          apply: (baseDraft) => baseDraft,
        };
      }

      return null;
    }

    if (selectedWorkbookSummary.kind === 'effectLevels') {
      if (inlineLevelKey) {
        const rawValue = selectedWorkbookSummary.bucket === 'value'
          ? draft.skills[selectedWorkbookSummary.skillKey].levels[inlineLevelKey]?.value
          : draft.skills[selectedWorkbookSummary.skillKey].effects[selectedWorkbookSummary.sourceEffectKey]?.levels[inlineLevelKey];
        return {
          key: `${selectedWorkbookSummary.skillKey}:${selectedWorkbookSummary.bucket}:${selectedWorkbookSummary.sourceEffectKey}:level:${inlineLevelKey}:${selectedWorkbookCell?.address ?? ''}`,
          focusId: 'effect-level-value',
          inputMode: 'number',
          value: rawValue == null ? '' : String(rawValue),
          placeholder: '',
          apply: (baseDraft, rawInput) => {
            const parsed = Number(rawInput);
            if (selectedWorkbookSummary.bucket === 'value') {
              const nextLevels = { ...baseDraft.skills[selectedWorkbookSummary.skillKey].levels };
              nextLevels[inlineLevelKey] = {
                ...nextLevels[inlineLevelKey],
                value: rawInput.trim() && Number.isFinite(parsed) ? parsed : undefined,
              };
              return {
                ...baseDraft,
                skills: {
                  ...baseDraft.skills,
                  [selectedWorkbookSummary.skillKey]: {
                    ...baseDraft.skills[selectedWorkbookSummary.skillKey],
                    levels: nextLevels,
                  },
                },
              };
            }
            const nextEffects = { ...baseDraft.skills[selectedWorkbookSummary.skillKey].effects };
            if (nextEffects[selectedWorkbookSummary.sourceEffectKey]) {
              const nextLevels = { ...nextEffects[selectedWorkbookSummary.sourceEffectKey].levels };
              if (rawInput.trim() && Number.isFinite(parsed)) {
                nextLevels[inlineLevelKey] = parsed;
              } else {
                delete nextLevels[inlineLevelKey];
              }
              nextEffects[selectedWorkbookSummary.sourceEffectKey] = {
                ...nextEffects[selectedWorkbookSummary.sourceEffectKey],
                levels: nextLevels,
              };
            }
            return {
              ...baseDraft,
              skills: {
                ...baseDraft.skills,
                [selectedWorkbookSummary.skillKey]: {
                  ...baseDraft.skills[selectedWorkbookSummary.skillKey],
                  effects: nextEffects,
                },
              },
            };
          },
        };
      }
      return {
        key: `${selectedWorkbookSummary.skillKey}:${selectedWorkbookSummary.bucket}:${selectedWorkbookSummary.sourceEffectKey}:levels`,
        focusId: 'effect-levels',
        inputMode: 'text',
        readOnly: true,
        value: 'Lv1~Lv9',
        placeholder: '',
        apply: (baseDraft) => baseDraft,
      };
    }

    return null;

}
