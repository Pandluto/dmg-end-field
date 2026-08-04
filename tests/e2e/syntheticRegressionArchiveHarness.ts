import { expect, type Page } from '@playwright/test';

export interface SyntheticArchiveHarnessInput {
  archive: Record<string, unknown>;
  archiveId: string;
  operatorId: string;
  packageId: string;
  workspaceLabel: string;
  expectedButtonCount: number;
}

export interface SyntheticDamageReportObservation {
  package: {
    packageId: string;
    operators: number;
    weapons: number;
    equipmentSets: number;
    equipments: number;
    buffGroups: number;
    buffItems: number;
    importedTimelineArchives: number;
  };
  sqlite: {
    label: string;
    characterCount: number;
    buttonCount: number;
    buffCount: number;
    nodeCount: number;
  };
  fixture: {
    operatorName: string;
    weaponName: string;
    equipmentNames: string[];
    threePieceBuffNames: string[];
    buffDefinitions: Array<{
      id: string;
      type: string;
      value: number | null;
      category: string;
      effectKind: string;
      valueMode: string;
      maxStacks: number | null;
      derivedSource: string;
      derivedPerPointValue: number | null;
      multiplierCoefficient: number | null;
    }>;
  };
  restored: {
    snapshotCount: number;
    snapshots: Array<{
      id: number;
      key: string;
      level: number;
      sourceSkillStrengthSnapshot: number;
      effectValue: number;
      initialCorrosion: number | null;
      tickCorrosionPerSecond: number | null;
      maxCorrosion: number | null;
      currentCorrosion: number | null;
      durationSeconds: number | null;
    }>;
    anomalyButtons: Array<{
      id: string;
      runtimeSkillId: string;
      selectedBuffIds: string[];
      buffStackCounts: Record<string, number>;
      disabledHitKeys: string[];
      statusCards: Array<{ id: string; key: string; level: number }>;
      damageCards: Array<{
        id: string;
        key: string;
        level: number;
        burnDamageMode: string;
        durationSeconds: number | null;
      }>;
      stateSnapshotIds: number[];
      targetResistance: Record<string, number>;
    }>;
  };
  report: {
    totalExpected: number;
    totalNonCrit: number;
    buttonCount: number;
    buttons: Array<{
      id: string;
      skillName: string;
      skillType: string;
      expected: number;
      nonCrit: number;
      hits: Array<{
        id: string;
        title: string;
        sourceKind: string;
        damageSourceLabel: string;
        elementLabel: string;
        skillTypeLabel: string;
        expected: number;
        nonCrit: number;
        resistanceZone: number;
        resistance: {
          baseResistance: number;
          corrosion: number;
          resistanceIgnore: number;
          effectiveResistance: number;
          resistanceZone: number;
        };
        zones: Array<{
          key: string;
          additiveTotal: number;
          multiplierProduct: number;
          finalValue: number;
        }>;
        buffs: Array<{
          id: string;
          type: string;
          zone: string;
          rawValue: number | null;
          runtimeCoefficient: number | null;
          effectiveValue: number | null;
          multiplierCoefficient: number | null;
          multiplier: boolean;
        }>;
      }>;
    }>;
  };
}

function roundNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Number(value.toFixed(9));
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? roundNumber(value)
    : null;
}

function normalizeReport(raw: Record<string, unknown>): SyntheticDamageReportObservation['report'] {
  const buttons = Array.isArray(raw.buttons) ? raw.buttons : [];
  return {
    totalExpected: roundNumber(raw.totalExpected),
    totalNonCrit: roundNumber(raw.totalNonCrit),
    buttonCount: Number(raw.buttonCount) || 0,
    buttons: buttons.map((buttonValue) => {
      const button = buttonValue as Record<string, unknown>;
      const hits = Array.isArray(button.hits) ? button.hits : [];
      return {
        id: String(button.id ?? ''),
        skillName: String(button.skillName ?? ''),
        skillType: String(button.skillType ?? ''),
        expected: roundNumber(button.expected),
        nonCrit: roundNumber(button.nonCrit),
        hits: hits.map((hitValue) => {
          const hit = hitValue as Record<string, unknown>;
          const resistance = (hit.resistance ?? {}) as Record<string, unknown>;
          const zones = Array.isArray(hit.zones) ? hit.zones : [];
          const buffs = Array.isArray(hit.buffs) ? hit.buffs : [];
          return {
            id: String(hit.id ?? ''),
            title: String(hit.title ?? ''),
            sourceKind: String(hit.sourceKind ?? ''),
            damageSourceLabel: String(hit.damageSourceLabel ?? ''),
            elementLabel: String(hit.elementLabel ?? ''),
            skillTypeLabel: String(hit.skillTypeLabel ?? ''),
            expected: roundNumber(hit.expected),
            nonCrit: roundNumber(hit.nonCrit),
            resistanceZone: roundNumber(hit.resistanceZone),
            resistance: {
              baseResistance: roundNumber(resistance.baseResistance),
              corrosion: roundNumber(resistance.corrosion),
              resistanceIgnore: roundNumber(resistance.resistanceIgnore),
              effectiveResistance: roundNumber(resistance.effectiveResistance),
              resistanceZone: roundNumber(resistance.resistanceZone),
            },
            zones: zones.map((zoneValue) => {
              const zone = zoneValue as Record<string, unknown>;
              return {
                key: String(zone.key ?? ''),
                additiveTotal: roundNumber(zone.additiveTotal),
                multiplierProduct: roundNumber(zone.multiplierProduct),
                finalValue: roundNumber(zone.finalValue),
              };
            }),
            buffs: buffs.map((buffValue) => {
              const buff = buffValue as Record<string, unknown>;
              return {
                id: String(buff.id ?? ''),
                type: String(buff.type ?? ''),
                zone: String(buff.zone ?? ''),
                rawValue: optionalNumber(buff.rawValue),
                runtimeCoefficient: optionalNumber(buff.runtimeCoefficient),
                effectiveValue: optionalNumber(buff.effectiveValue),
                multiplierCoefficient: optionalNumber(buff.multiplierCoefficient),
                multiplier: buff.multiplier === true,
              };
            }),
          };
        }),
      };
    }),
  };
}

/**
 * Installs one deterministic test-only data package, converts its timeline
 * archive through the real browser SQLite path, reloads the Workbench, then
 * reads the same structured damage report used by the presentation page.
 */
export async function observeSyntheticArchiveAfterSqliteReload(
  page: Page,
  baseUrl: string,
  input: SyntheticArchiveHarnessInput,
): Promise<SyntheticDamageReportObservation> {
  await page.goto(`${baseUrl}/#/settings`);
  await expect(page.locator('.app-route-loading')).toHaveCount(0);

  const setup = await page.evaluate(async (fixture) => {
    const sourceModuleUrl = (path: string) => new URL(path, window.location.origin).href;
    const localData = await import(/* @vite-ignore */ sourceModuleUrl('/src/platform/data/localDataPackages.ts'));
    const timeline = await import(/* @vite-ignore */ sourceModuleUrl('/src/platform/timeline/browserTimelineStore.ts'));
    const session = await import(/* @vite-ignore */ sourceModuleUrl('/src/agentKernel/timelineRepository/timelineSession.ts'));

    const saved = await localData.saveLocalDataPackage({
      scope: 'local',
      archive: fixture.archive,
      sourceName: 'synthetic-regression-fixture',
      replace: true,
    });
    const applied = await localData.applyLocalDataPackage({
      scope: 'local',
      packageId: saved.summary.packageId,
      backup: false,
    });
    const converted = await timeline.convertTimelineArchive({
      source: 'shared',
      archiveId: fixture.archiveId,
      payloadOnly: true,
      label: fixture.workspaceLabel,
      updatedAt: Date.parse('2026-01-01T00:00:00.000Z'),
    });
    session.activateTimelineSession({
      document: converted.document,
      checkoutRef: converted.checkoutRef,
      workingPayload: converted.payload,
    });
    const workspaces = await timeline.listSqliteWorkspaces();
    const workspace = workspaces.find((entry: { document: { id: string } }) => (
      entry.document.id === converted.document.id
    ));
    if (!workspace) throw new Error('Synthetic SQLite workspace was not persisted.');

    return {
      package: {
        packageId: applied.package.packageId,
        ...applied.counts,
        importedTimelineArchives: applied.importedTimelineArchives,
      },
      sqlite: {
        label: workspace.document.label,
        characterCount: workspace.summary.characterCount,
        buttonCount: workspace.summary.buttonCount,
        buffCount: workspace.summary.buffCount,
        nodeCount: workspace.nodeCount,
      },
      fixture: (() => {
        const payload = converted.payload as {
          allBuffList?: Array<Record<string, unknown>>;
          operatorConfigPageCache?: Record<string, {
            operator?: { name?: unknown };
            weapon?: { name?: unknown };
            equipment?: {
              pieces?: Array<{ name?: unknown }>;
              setBuffs?: Array<{ label?: unknown; name?: unknown }>;
            };
          }>;
        };
        const config = payload.operatorConfigPageCache?.[fixture.operatorId];
        return {
          operatorName: String(config?.operator?.name ?? ''),
          weaponName: String(config?.weapon?.name ?? ''),
          equipmentNames: (config?.equipment?.pieces ?? []).map((piece) => String(piece.name ?? '')),
          threePieceBuffNames: (config?.equipment?.setBuffs ?? []).map((buff) => String(buff.label ?? buff.name ?? '')),
          buffDefinitions: (payload.allBuffList ?? []).map((buff) => {
            const derived = buff.derivedValue as Record<string, unknown> | undefined;
            const multiplier = buff.multiplier as Record<string, unknown> | undefined;
            return {
              id: String(buff.id ?? ''),
              type: String(buff.type ?? ''),
              value: typeof buff.value === 'number' ? buff.value : null,
              category: String(buff.category ?? ''),
              effectKind: String(buff.effectKind ?? 'modifier'),
              valueMode: String(buff.valueMode ?? 'fixed'),
              maxStacks: typeof buff.maxStacks === 'number' ? buff.maxStacks : null,
              derivedSource: String(derived?.source ?? ''),
              derivedPerPointValue: typeof derived?.perPointValue === 'number' ? derived.perPointValue : null,
              multiplierCoefficient: typeof multiplier?.coefficient === 'number' ? multiplier.coefficient : null,
            };
          }),
        };
      })(),
    };
  }, input);

  expect(setup.package.packageId).toBe(input.packageId);
  expect(setup.sqlite.label).toBe(input.workspaceLabel);
  expect(setup.sqlite.buttonCount).toBe(input.expectedButtonCount);

  await page.goto(`${baseUrl}/#/timeline`);
  await expect(page.locator('.canvas-container')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-skill-button-id]')).toHaveCount(input.expectedButtonCount);

  const afterReload = await page.evaluate(async () => {
    const sourceModuleUrl = (path: string) => new URL(path, window.location.origin).href;
    const reportModule = await import(/* @vite-ignore */ sourceModuleUrl('/src/core/services/damageReportService.ts'));
    const snapshotModule = await import(/* @vite-ignore */ sourceModuleUrl('/src/utils/timelineSnapshotStorage.ts'));
    const payload = snapshotModule.getCurrentTimelineSnapshotPayload() as {
      anomalyStateSnapshots?: Array<Record<string, unknown>>;
      skillButtonTable?: Record<string, Record<string, unknown>>;
    } | null;
    const snapshots = payload?.anomalyStateSnapshots ?? [];
    const buttons = Object.values(payload?.skillButtonTable ?? {});
    return {
      report: reportModule.buildDamageReportSnapshot(),
      restored: {
        snapshotCount: snapshots.length,
        snapshots: snapshots.map((snapshot) => ({
          id: Number(snapshot.id) || 0,
          key: String(snapshot.key ?? ''),
          level: Number(snapshot.level) || 0,
          sourceSkillStrengthSnapshot: Number(snapshot.sourceSkillStrengthSnapshot) || 0,
          effectValue: Number(snapshot.effectValue) || 0,
          initialCorrosion: typeof snapshot.initialCorrosion === 'number' ? snapshot.initialCorrosion : null,
          tickCorrosionPerSecond: typeof snapshot.tickCorrosionPerSecond === 'number' ? snapshot.tickCorrosionPerSecond : null,
          maxCorrosion: typeof snapshot.maxCorrosion === 'number' ? snapshot.maxCorrosion : null,
          currentCorrosion: typeof snapshot.currentCorrosion === 'number' ? snapshot.currentCorrosion : null,
          durationSeconds: typeof snapshot.durationSeconds === 'number' ? snapshot.durationSeconds : null,
        })),
        anomalyButtons: buttons.flatMap((button) => {
          const anomalyConfig = button.anomalyConfig as Record<string, unknown> | undefined;
          if (!anomalyConfig) return [];
          const selectedStatuses = Array.isArray(anomalyConfig.selectedStatuses) ? anomalyConfig.selectedStatuses : [];
          const selectedDamages = Array.isArray(anomalyConfig.selectedDamages) ? anomalyConfig.selectedDamages : [];
          const selectedStateSnapshotIds = Array.isArray(anomalyConfig.selectedStateSnapshotIds)
            ? anomalyConfig.selectedStateSnapshotIds.map(Number)
            : [];
          if (selectedStatuses.length === 0 && selectedDamages.length === 0 && selectedStateSnapshotIds.length === 0) {
            return [];
          }
          const resistanceConfig = button.resistanceConfig as { targetResistance?: Record<string, number> } | undefined;
          const panelConfig = button.panelConfig as { manualDisabledHitKeys?: string[] } | undefined;
          return [{
            id: String(button.id ?? ''),
            runtimeSkillId: String(button.runtimeSkillId ?? ''),
            selectedBuffIds: Array.isArray(button.selectedBuff) ? button.selectedBuff.map(String) : [],
            buffStackCounts: (button.buffStackCounts ?? {}) as Record<string, number>,
            disabledHitKeys: Array.isArray(panelConfig?.manualDisabledHitKeys) ? panelConfig.manualDisabledHitKeys : [],
            statusCards: selectedStatuses.map((value) => {
              const card = value as Record<string, unknown>;
              return { id: String(card.id ?? ''), key: String(card.key ?? ''), level: Number(card.level) || 0 };
            }),
            damageCards: selectedDamages.map((value) => {
              const card = value as Record<string, unknown>;
              return {
                id: String(card.id ?? ''),
                key: String(card.key ?? ''),
                level: Number(card.level) || 0,
                burnDamageMode: String(card.burnDamageMode ?? ''),
                durationSeconds: typeof card.durationSeconds === 'number' ? card.durationSeconds : null,
              };
            }),
            stateSnapshotIds: selectedStateSnapshotIds,
            targetResistance: resistanceConfig?.targetResistance ?? {},
          }];
        }),
      },
    };
  }) as {
    report: Record<string, unknown>;
    restored: SyntheticDamageReportObservation['restored'];
  };

  return {
    package: setup.package,
    sqlite: setup.sqlite,
    fixture: setup.fixture,
    restored: afterReload.restored,
    report: normalizeReport(afterReload.report),
  };
}
