export const STORAGE_KEYS = {
  OPERATOR_CONFIG_PAGE_CACHE: 'def.operator-config.page-cache.v1',
  OPERATOR_CONFIG_ACTIVE_CHARACTER: 'def.operator-config.active-character.v1',
  // v3 主存储 - 角色输入配置
  CHARACTER_INPUT_MAP: 'def.operator-config.character-input-map.v3',
  // v3 计算缓存
  CHARACTER_COMPUTED_MAP: 'def.operator-runtime.character-computed-map.v3',
  // v3 UI 展示缓存（可选，建议内存态）
  CHARACTER_DISPLAY_CACHE: 'def.operator-ui.character-display-cache.v3',

  // v2 新缓存模型 - skill-button 总表（已选 Buff 引用）
  SKILL_BUTTON_TABLE: 'def.skill-button.v1',
  // v2 新缓存模型 - buff-list 总表（已选 Buff 实体，只能由 upsertBuff/removeBuffById 写入）
  ALL_BUFF_LIST: 'def.all-buff-list.v1',
  // v2 新缓存模型 - 候选 Buff 列表（DamageTab 刷新用，与已选 Buff 实体隔离）
  CANDIDATE_BUFF_LIST: 'def.candidate-buff-list.v1',
  ANOMALY_STATE_SNAPSHOT_ARCHIVE: 'def.anomaly-state-snapshot-archive.v1',

  // 其他存储
  SELECTED_CHARACTERS: 'def.selected-characters.v1',
  SELECTED_SKILL_BUTTON: 'def.selected-skill-button',
  TIMELINE_DATA: 'def.timeline.data.v1',
  TIMELINE_SNAPSHOT_ARCHIVE: 'def.timeline.snapshot-archive.v1',

  // 运行时模板表 - 官方和本地角色的统一运行时模板缓存（sessionStorage）
  RUNTIME_OPERATOR_TEMPLATE_MAP: 'def.operator-runtime.template-map.v1',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

