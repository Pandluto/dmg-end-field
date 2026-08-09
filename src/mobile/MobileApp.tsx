import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { MobileBuffEditor } from './components/MobileBuffEditor';
import { MobileOperatorConfigPage } from './pages/MobileOperatorConfigPage';
import { MobileReportPage } from './pages/MobileReportPage';
import { MobileSelectionPage } from './pages/MobileSelectionPage';
import { MobileTimelinePage } from './pages/MobileTimelinePage';
import { MOBILE_PAGE_IDS, type MobileCatalog, type MobilePageId } from './model';
import { useMobileWorkbench } from './useMobileWorkbench';
import './MobileApp.css';

export interface MobileAppProps {
  catalog: MobileCatalog;
  updateAvailable: boolean;
  onReloadLatest: () => void;
}

const PAGE_META: Record<MobilePageId, { index: string; label: string; shortLabel: string }> = {
  selection: { index: '01', label: '选择干员', shortLabel: '选人' },
  config: { index: '02', label: '干员配置', shortLabel: '配置' },
  timeline: { index: '03', label: '技能排轴', shortLabel: '排轴' },
  report: { index: '04', label: '伤害报表', shortLabel: '报表' },
};

const PAGER_INTERACTIVE_SELECTOR = [
  'button',
  'input',
  'select',
  'textarea',
  'a',
  '[role="dialog"]',
  '[data-mobile-pager-lock]',
].join(',');

function pageIndex(page: MobilePageId): number {
  return Math.max(0, MOBILE_PAGE_IDS.indexOf(page));
}

export function MobileApp({ catalog, updateAvailable, onReloadLatest }: MobileAppProps) {
  const workbench = useMobileWorkbench(catalog);
  const [buffEditorSlotId, setBuffEditorSlotId] = useState<string | null>(null);
  const pagerPointerRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    horizontal: boolean;
  } | null>(null);

  const selectedOperators = useMemo(() => {
    const characterById = new Map(catalog.characters.map((character) => [character.id, character]));
    return workbench.draft.selectedOperatorIds
      .map((operatorId) => characterById.get(operatorId))
      .filter((character): character is MobileCatalog['characters'][number] => Boolean(character));
  }, [catalog.characters, workbench.draft.selectedOperatorIds]);

  const editorSlot = buffEditorSlotId
    ? workbench.draft.slots.find((slot) => slot.id === buffEditorSlotId) ?? null
    : null;
  const editorAction = editorSlot?.action ?? null;
  const editorOperator = editorAction
    ? selectedOperators.find((operator) => operator.id === editorAction.operatorId) ?? null
    : null;

  useEffect(() => {
    if (buffEditorSlotId && !editorAction) setBuffEditorSlotId(null);
  }, [buffEditorSlotId, editorAction]);

  const changePage = (nextPage: MobilePageId) => {
    if (workbench.interactionLocked || buffEditorSlotId) return;
    workbench.setActivePage(nextPage);
  };

  const handlePagerPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (workbench.interactionLocked || buffEditorSlotId) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(PAGER_INTERACTIVE_SELECTOR)) return;
    pagerPointerRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      horizontal: false,
    };
  };

  const handlePagerPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = pagerPointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - pointer.startX;
    const deltaY = event.clientY - pointer.startY;
    if (
      !pointer.horizontal
      && Math.abs(deltaX) > 12
      && Math.abs(deltaX) > Math.abs(deltaY) * 1.2
    ) {
      pointer.horizontal = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    if (pointer.horizontal) event.preventDefault();
  };

  const finishPagerGesture = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const pointer = pagerPointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    pagerPointerRef.current = null;
    if (cancelled || !pointer.horizontal) return;
    const deltaX = event.clientX - pointer.startX;
    const deltaY = event.clientY - pointer.startY;
    if (Math.abs(deltaX) < 52 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    const currentIndex = pageIndex(workbench.draft.activePage);
    const nextIndex = deltaX < 0
      ? Math.min(MOBILE_PAGE_IDS.length - 1, currentIndex + 1)
      : Math.max(0, currentIndex - 1);
    workbench.setActivePage(MOBILE_PAGE_IDS[nextIndex]);
  };

  const activeIndex = pageIndex(workbench.draft.activePage);

  return (
    <div className="mobile-app-shell">
      <div className="mobile-app-notices" aria-live="polite">
        {updateAvailable ? (
          <div className="mobile-app-update-notice">
            <span><i aria-hidden="true" />线上资料已有新版本</span>
            <button type="button" onClick={onReloadLatest}>保留草稿并更新</button>
          </div>
        ) : null}
        {workbench.runtimeError ? (
          <div className="mobile-app-runtime-error" role="alert">
            当前配置暂时无法计算：{workbench.runtimeError}
          </div>
        ) : null}
      </div>

      <div
        className="mobile-app-pager"
        onPointerDown={handlePagerPointerDown}
        onPointerMove={handlePagerPointerMove}
        onPointerUp={(event) => finishPagerGesture(event)}
        onPointerCancel={(event) => finishPagerGesture(event, true)}
      >
        <div
          className="mobile-app-page-track"
          style={{ transform: `translate3d(-${activeIndex * 25}%, 0, 0)` }}
        >
          <section className="mobile-app-page" aria-hidden={workbench.draft.activePage !== 'selection'}>
            <MobileSelectionPage
              characters={catalog.characters}
              selectedOperatorIds={workbench.draft.selectedOperatorIds}
              dataVersion={catalog.dataVersion}
              imageVersion={catalog.imageVersion}
              onSelectionChange={workbench.setSelection}
              onContinue={() => changePage('config')}
            />
          </section>

          <section className="mobile-app-page" aria-hidden={workbench.draft.activePage !== 'config'}>
            <MobileOperatorConfigPage
              characters={catalog.characters}
              selectedOperatorIds={workbench.draft.selectedOperatorIds}
              activeOperatorId={workbench.draft.activeOperatorId}
              configs={workbench.draft.operatorConfigs}
              weapons={catalog.weapons}
              equipment={catalog.equipment}
              configSnapshot={workbench.runtime.operatorSnapshots[workbench.draft.activeOperatorId] ?? null}
              onActiveOperatorChange={workbench.setActiveOperatorId}
              onConfigChange={workbench.updateOperatorConfig}
            />
          </section>

          <section className="mobile-app-page" aria-hidden={workbench.draft.activePage !== 'timeline'}>
            <MobileTimelinePage
              slots={workbench.draft.slots}
              operators={selectedOperators}
              slotCalculations={workbench.runtime.slotCalculations}
              onAddSlot={workbench.addSlot}
              onSetSlotAction={workbench.setSlotAction}
              onDeleteSlotAction={workbench.deleteSlotAction}
              onMoveSlotAction={workbench.moveSlotAction}
              onOpenBuffEditor={setBuffEditorSlotId}
              onInteractionLockChange={workbench.setInteractionLocked}
            />
          </section>

          <section className="mobile-app-page" aria-hidden={workbench.draft.activePage !== 'report'}>
            <MobileReportPage report={workbench.runtime.report} />
          </section>
        </div>
      </div>

      <nav className="mobile-app-bottom-nav" aria-label="手机版工作台分页">
        {MOBILE_PAGE_IDS.map((pageId) => {
          const active = workbench.draft.activePage === pageId;
          const meta = PAGE_META[pageId];
          return (
            <button
              key={pageId}
              type="button"
              className={active ? 'is-active' : ''}
              onClick={() => changePage(pageId)}
              aria-current={active ? 'page' : undefined}
              aria-label={meta.label}
            >
              <span>{meta.index}</span>
              <strong>{meta.shortLabel}</strong>
            </button>
          );
        })}
      </nav>

      {editorAction && editorSlot ? (
        <MobileBuffEditor
          action={editorAction}
          calculation={workbench.runtime.slotCalculations[editorSlot.id] ?? null}
          catalogBuffs={workbench.runtime.availableBuffs}
          characterName={editorOperator?.name}
          operators={selectedOperators}
          operatorSnapshots={workbench.runtime.operatorSnapshots}
          onActionChange={(nextAction) => workbench.updateSlotAction(editorSlot.id, nextAction)}
          onClose={() => setBuffEditorSlotId(null)}
          onInteractionLockChange={workbench.setInteractionLocked}
        />
      ) : null}

      <div className="mobile-app-orientation-blocker" role="status">
        <span aria-hidden="true">↻</span>
        <strong>请旋转回竖屏</strong>
        <p>手机版工作台只提供竖屏布局。</p>
      </div>
    </div>
  );
}

export default MobileApp;
