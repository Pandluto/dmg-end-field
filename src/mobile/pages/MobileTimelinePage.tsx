import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Character, SkillType } from '../../types';
import { MobilePortal } from '../components/MobilePortal';
import { createMobileId } from '../mobileDraft';
import type { MobileSlotCalculation, MobileTimelineAction, MobileTimelineSlot } from '../model';
import './MobileTimelinePage.css';

export interface MobileTimelineSkillOption {
  id: string;
  runtimeSkillId: string;
  skillType: SkillType;
  skillName: string;
  skillIconUrl?: string;
}

export interface MobileTimelinePageProps {
  slots: MobileTimelineSlot[];
  /** The currently selected, online-backed operators. */
  operators?: Character[];
  /** Alias kept available for hosts that call the collection selectedOperators. */
  selectedOperators?: Character[];
  slotCalculations?: Record<string, MobileSlotCalculation>;
  onAddSlot: () => void;
  onSetSlotAction: (slotId: string, action: MobileTimelineAction) => void;
  onDeleteSlotAction: (slotId: string) => void;
  /** The parent owns insert-and-shift semantics for filled targets. */
  onMoveSlotAction: (sourceSlotId: string, targetSlotId: string) => void;
  onOpenBuffEditor?: (slotId: string) => void;
  /** Locks the outer four-page pager while a long-press drag is active. */
  onInteractionLockChange?: (locked: boolean) => void;
}

type EmptySlotChooser = {
  slotId: string;
  operatorId?: string;
  step: 'operator' | 'skill';
};

const LEGACY_SKILLS: Array<{ skillType: SkillType; key: 'normalAttack' | 'skill' | 'chainSkill' | 'ultimate' }> = [
  { skillType: 'A', key: 'normalAttack' },
  { skillType: 'B', key: 'skill' },
  { skillType: 'E', key: 'chainSkill' },
  { skillType: 'Q', key: 'ultimate' },
];

const SKILL_LABELS: Record<SkillType, string> = {
  A: '普攻',
  B: '战技',
  E: '连携技',
  Q: '终结技',
  Dot: '持续伤害',
};

function getSkillOptions(character: Character): MobileTimelineSkillOption[] {
  if (character.sandboxSkills && character.sandboxSkills.length > 0) {
    return character.sandboxSkills.map((skill) => ({
      id: `${character.id}:${skill.id}`,
      runtimeSkillId: skill.id,
      skillType: skill.buttonType,
      skillName: skill.displayName || SKILL_LABELS[skill.buttonType],
      skillIconUrl: skill.iconUrl || character.skillIconMap?.[skill.buttonType],
    }));
  }

  return LEGACY_SKILLS.map(({ skillType, key }) => ({
    id: `${character.id}:${skillType}`,
    runtimeSkillId: `${character.id}-${skillType}`,
    skillType,
    skillName: character.skills[key]?.name || SKILL_LABELS[skillType],
    skillIconUrl: character.skillIconMap?.[skillType],
  }));
}

function buildAction(character: Character, skill: MobileTimelineSkillOption): MobileTimelineAction {
  return {
    id: createMobileId('mobile-action'),
    operatorId: character.id,
    skillType: skill.skillType,
    runtimeSkillId: skill.runtimeSkillId,
    skillName: skill.skillName,
    skillIconUrl: skill.skillIconUrl,
    buffs: [],
    buffStackCounts: {},
    buffStackCountsByHitKey: {},
    globallyDisabledBuffIds: [],
    disabledBuffIdsByHitKey: {},
    disabledHitKeys: [],
    targetResistance: {},
    anomalyStatuses: [],
    anomalyDamages: [],
    anomalyStateSnapshots: [],
  };
}

function formatDamage(value: number | undefined): string {
  if (!Number.isFinite(value)) return '—';
  return Math.round(value ?? 0).toLocaleString('zh-CN');
}

function getActionOperator(operators: Character[], action: MobileTimelineAction | null): Character | null {
  if (!action) return null;
  return operators.find((operator) => operator.id === action.operatorId) ?? null;
}

function stopPointerEvent(event: ReactPointerEvent<HTMLElement>): void {
  event.preventDefault();
  event.stopPropagation();
}

export function MobileTimelinePage({
  slots,
  operators,
  selectedOperators,
  slotCalculations = {},
  onAddSlot,
  onSetSlotAction,
  onDeleteSlotAction,
  onMoveSlotAction,
  onOpenBuffEditor,
  onInteractionLockChange,
}: MobileTimelinePageProps) {
  const availableOperators = operators ?? selectedOperators ?? [];
  const [chooser, setChooser] = useState<EmptySlotChooser | null>(null);
  const [actionSheetSlotId, setActionSheetSlotId] = useState<string | null>(null);
  const [moveSourceSlotId, setMoveSourceSlotId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<{ sourceSlotId: string; targetSlotId: string | null } | null>(null);
  const pointerRef = useRef<{
    pointerId: number;
    sourceSlotId: string;
    startX: number;
    startY: number;
    longPressStarted: boolean;
  } | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);

  const operatorById = useMemo(
    () => new Map(availableOperators.map((operator) => [operator.id, operator])),
    [availableOperators],
  );
  const chooserOperator = chooser?.operatorId ? operatorById.get(chooser.operatorId) ?? null : null;
  const chooserSkills = chooserOperator ? getSkillOptions(chooserOperator) : [];
  const actionSheetAction = actionSheetSlotId
    ? slots.find((slot) => slot.id === actionSheetSlotId)?.action ?? null
    : null;
  const actionSheetOperator = getActionOperator(availableOperators, actionSheetAction);
  const dragSourceAction = dragState
    ? slots.find((slot) => slot.id === dragState.sourceSlotId)?.action ?? null
    : null;

  useEffect(() => () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
    }
    onInteractionLockChange?.(false);
  }, [onInteractionLockChange]);

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const finishDrag = (targetSlotId: string | null) => {
    const currentDrag = dragState;
    if (!currentDrag) return;
    if (targetSlotId && targetSlotId !== currentDrag.sourceSlotId) {
      onMoveSlotAction(currentDrag.sourceSlotId, targetSlotId);
    }
    suppressClickRef.current = true;
    setDragState(null);
    pointerRef.current = null;
    onInteractionLockChange?.(false);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>, slotId: string) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const sourceSlot = slots.find((slot) => slot.id === slotId);
    if (!sourceSlot?.action) return;
    clearLongPressTimer();
    pointerRef.current = {
      pointerId: event.pointerId,
      sourceSlotId: slotId,
      startX: event.clientX,
      startY: event.clientY,
      longPressStarted: false,
    };
    const button = event.currentTarget;
    longPressTimerRef.current = window.setTimeout(() => {
      const pointer = pointerRef.current;
      if (!pointer || pointer.pointerId !== event.pointerId) return;
      pointer.longPressStarted = true;
      button.setPointerCapture?.(event.pointerId);
      setDragState({ sourceSlotId: slotId, targetSlotId: slotId });
      onInteractionLockChange?.(true);
    }, 420);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    if (!pointer.longPressStarted) {
      const movedX = Math.abs(event.clientX - pointer.startX);
      const movedY = Math.abs(event.clientY - pointer.startY);
      if (movedX > 10 || movedY > 10) clearLongPressTimer();
      return;
    }

    stopPointerEvent(event);
    const hitElement = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const targetElement = hitElement?.closest<HTMLElement>('[data-mobile-timeline-slot-id]');
    const targetSlotId = targetElement?.dataset.mobileTimelineSlotId ?? null;
    setDragState((current) => current ? { ...current, targetSlotId } : current);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    clearLongPressTimer();
    if (pointer.longPressStarted) {
      stopPointerEvent(event);
      finishDrag(dragState?.targetSlotId ?? null);
      return;
    }
    pointerRef.current = null;
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    clearLongPressTimer();
    if (pointer.longPressStarted) stopPointerEvent(event);
    pointerRef.current = null;
    setDragState(null);
    onInteractionLockChange?.(false);
  };

  const openSlot = (slot: MobileTimelineSlot) => {
    if (slot.action) {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      setActionSheetSlotId(slot.id);
      return;
    }
    setChooser({ slotId: slot.id, step: 'operator' });
  };

  const chooseOperator = (operatorId: string) => {
    setChooser((current) => current ? { ...current, operatorId, step: 'skill' } : current);
  };

  const chooseSkill = (skill: MobileTimelineSkillOption) => {
    if (!chooser?.operatorId || !chooserOperator) return;
    onSetSlotAction(chooser.slotId, buildAction(chooserOperator, skill));
    setChooser(null);
  };

  const closeOverlays = () => {
    setChooser(null);
    setActionSheetSlotId(null);
    setMoveSourceSlotId(null);
  };

  const moveTargets = moveSourceSlotId ? slots.filter((slot) => slot.id !== moveSourceSlotId) : [];

  return (
    <main
      className={`mobile-timeline-page${dragState ? ' is-dragging' : ''}`}
      data-mobile-dragging={dragState ? 'true' : undefined}
      aria-label="竖向排轴"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <header className="mobile-timeline-header">
        <div>
          <p className="mobile-timeline-kicker">03 / 排轴</p>
          <h1>技能队列</h1>
        </div>
        <span className="mobile-timeline-count">{slots.filter((slot) => slot.action).length} 个动作</span>
      </header>

      {availableOperators.length === 0 ? (
        <section className="mobile-timeline-empty-state" role="status">
          <strong>先选择干员</strong>
          <p>排轴槽位会在选好干员后提供对应技能。</p>
        </section>
      ) : null}

      <ol className="mobile-timeline-slots" aria-label="技能排轴槽位">
        {slots.map((slot, index) => {
          const action = slot.action;
          const operator = getActionOperator(availableOperators, action);
          const calculation = slotCalculations[slot.id];
          const isDragSource = dragState?.sourceSlotId === slot.id;
          const isDragTarget = dragState?.targetSlotId === slot.id && !isDragSource;
          const isMoveTarget = moveSourceSlotId !== null && moveSourceSlotId !== slot.id;
          return (
            <li
              key={slot.id}
              className={`mobile-timeline-slot${action ? ' is-filled' : ' is-empty'}${isDragSource ? ' is-drag-source' : ''}${isDragTarget ? ' is-drag-target' : ''}${isMoveTarget ? ' is-move-target' : ''}`}
              data-mobile-timeline-slot-id={slot.id}
            >
              <span className="mobile-timeline-slot-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              {action && operator ? (
                <button
                  type="button"
                  className="mobile-timeline-action-card"
                  onClick={() => openSlot(slot)}
                  onPointerDown={(event) => handlePointerDown(event, slot.id)}
                  onContextMenu={(event) => event.preventDefault()}
                  aria-label={`${action.skillName}，${operator.name}，点击查看操作，长按拖动`}
                >
                  <span className="mobile-timeline-action-skill-icon">
                    {action.skillIconUrl ? <img src={action.skillIconUrl} alt="" /> : SKILL_LABELS[action.skillType]}
                  </span>
                  <span className="mobile-timeline-action-copy">
                    <strong>{action.skillName}</strong>
                    <span>{SKILL_LABELS[action.skillType]} · {operator.name}</span>
                  </span>
                  <span className="mobile-timeline-action-operator-avatar">
                    {operator.avatarUrl ? <img src={operator.avatarUrl} alt="" /> : operator.name.slice(0, 1)}
                  </span>
                  <span className="mobile-timeline-action-damage">
                    <small>期望伤害</small>
                    <strong>{formatDamage(calculation?.result.summary.totalExpected)}</strong>
                  </span>
                  {isDragTarget ? <span className="mobile-timeline-drop-label">放到这里</span> : null}
                </button>
              ) : (
                <button
                  type="button"
                  className="mobile-timeline-empty-slot"
                  onClick={() => openSlot(slot)}
                  disabled={availableOperators.length === 0}
                  aria-label={`第 ${index + 1} 个空槽，点击添加技能`}
                >
                  <span className="mobile-timeline-plus" aria-hidden="true">＋</span>
                  <span>
                    <strong>{isDragTarget ? '放到这里' : '空槽位'}</strong>
                    <small>{isDragTarget ? '松开以插入技能' : '点击选择干员和技能'}</small>
                  </span>
                </button>
              )}
              {isMoveTarget && !isDragTarget ? (
                <button
                  type="button"
                  className="mobile-timeline-move-target"
                  onClick={() => {
                    if (moveSourceSlotId) onMoveSlotAction(moveSourceSlotId, slot.id);
                    setMoveSourceSlotId(null);
                  }}
                >
                  移动到这里{slot.action ? '（插入并后移）' : ''}
                </button>
              ) : null}
            </li>
          );
        })}
      </ol>

      <button type="button" className="mobile-timeline-add-slot" onClick={onAddSlot}>
        <span aria-hidden="true">＋</span>
        <span>新增槽位</span>
      </button>

      {dragSourceAction && dragState ? (
        <MobilePortal>
          <div className="mobile-timeline-drag-hint" role="status" aria-live="polite">
            正在移动：{dragSourceAction.skillName} · 松开即可插入
          </div>
        </MobilePortal>
      ) : null}

      {chooser ? (
        <MobilePortal>
          <div className="mobile-timeline-modal-backdrop" role="presentation" onClick={closeOverlays}>
            <section
              className="mobile-timeline-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="mobile-timeline-chooser-title"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="mobile-timeline-modal-header">
                <div>
                  <p className="mobile-timeline-kicker">添加到槽位</p>
                  <h2 id="mobile-timeline-chooser-title">{chooser.step === 'operator' ? '选择干员' : '选择技能'}</h2>
                </div>
                <button type="button" className="mobile-timeline-close-button" onClick={() => setChooser(null)} aria-label="关闭">×</button>
              </header>
              {chooser.step === 'operator' ? (
                <div className="mobile-timeline-choice-grid">
                  {availableOperators.map((operator) => (
                    <button key={operator.id} type="button" className="mobile-timeline-operator-choice" onClick={() => chooseOperator(operator.id)}>
                      <span className="mobile-timeline-operator-avatar">
                        {operator.avatarUrl ? <img src={operator.avatarUrl} alt="" /> : operator.name.slice(0, 1)}
                      </span>
                      <span>{operator.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  <button type="button" className="mobile-timeline-back-choice" onClick={() => setChooser((current) => current ? { ...current, step: 'operator' } : current)}>‹ 重新选择干员</button>
                  <div className="mobile-timeline-skill-choice-list">
                    {chooserSkills.map((skill) => (
                      <button key={skill.id} type="button" className="mobile-timeline-skill-choice" onClick={() => chooseSkill(skill)}>
                        {skill.skillIconUrl ? <img src={skill.skillIconUrl} alt="" /> : <span className="mobile-timeline-skill-placeholder">{skill.skillType}</span>}
                        <span><strong>{skill.skillName}</strong><small>{SKILL_LABELS[skill.skillType]}</small></span>
                        <span aria-hidden="true">›</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </section>
          </div>
        </MobilePortal>
      ) : null}

      {actionSheetSlotId && actionSheetAction ? (
        <MobilePortal>
          <div className="mobile-timeline-modal-backdrop" role="presentation" onClick={() => setActionSheetSlotId(null)}>
            <section className="mobile-timeline-action-sheet" role="dialog" aria-modal="true" aria-label="技能槽位操作" onClick={(event) => event.stopPropagation()}>
              <div className="mobile-timeline-sheet-handle" aria-hidden="true" />
              <p>{actionSheetOperator?.name ?? '未知干员'} · {actionSheetAction.skillName}</p>
              <button type="button" onClick={() => {
                onDeleteSlotAction(actionSheetSlotId);
                setActionSheetSlotId(null);
              }}>删除</button>
              <button type="button" onClick={() => {
                setMoveSourceSlotId(actionSheetSlotId);
                setActionSheetSlotId(null);
              }}>移动</button>
              <button type="button" onClick={() => {
                onOpenBuffEditor?.(actionSheetSlotId);
                setActionSheetSlotId(null);
              }}>编辑 Buff</button>
              <button type="button" className="is-muted" onClick={() => setActionSheetSlotId(null)}>取消</button>
            </section>
          </div>
        </MobilePortal>
      ) : null}

      {moveSourceSlotId ? (
        <MobilePortal>
          <div className="mobile-timeline-modal-backdrop" role="presentation" onClick={() => setMoveSourceSlotId(null)}>
            <section className="mobile-timeline-modal" role="dialog" aria-modal="true" aria-labelledby="mobile-timeline-move-title" onClick={(event) => event.stopPropagation()}>
              <header className="mobile-timeline-modal-header">
                <div>
                  <p className="mobile-timeline-kicker">重新排列</p>
                  <h2 id="mobile-timeline-move-title">选择目标槽位</h2>
                </div>
                <button type="button" className="mobile-timeline-close-button" onClick={() => setMoveSourceSlotId(null)} aria-label="关闭">×</button>
              </header>
              <div className="mobile-timeline-move-list">
                {moveTargets.map((slot) => (
                  <button key={slot.id} type="button" onClick={() => {
                    onMoveSlotAction(moveSourceSlotId, slot.id);
                    setMoveSourceSlotId(null);
                  }}>
                    <span>第 {slots.findIndex((item) => item.id === slot.id) + 1} 槽</span>
                    <small>{slot.action ? `插入到 ${getActionOperator(availableOperators, slot.action)?.name ?? '未知干员'} 前` : '空槽位，直接移动'}</small>
                    <strong>›</strong>
                  </button>
                ))}
              </div>
            </section>
          </div>
        </MobilePortal>
      ) : null}
    </main>
  );
}

export default MobileTimelinePage;
