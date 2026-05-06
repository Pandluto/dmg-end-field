export const STORAGE_KEYS = {
  // v3 主存储 - 角色输入配置
  CHARACTER_INPUT_MAP: 'ddd.operator-config.character-input-map.v3',
  // v3 计算缓存
  CHARACTER_COMPUTED_MAP: 'ddd.operator-runtime.character-computed-map.v3',
  // v3 UI 展示缓存（可选，建议内存态）
  CHARACTER_DISPLAY_CACHE: 'ddd.operator-ui.character-display-cache.v3',

  // v2 新缓存模型 - skill-button 总表（已选 Buff 引用）
  SKILL_BUTTON_TABLE: 'ddd.skill-button.v1',
  // v2 新缓存模型 - buff-list 总表（已选 Buff 实体，只能由 upsertBuff/removeBuffById 写入）
  ALL_BUFF_LIST: 'ddd.all-buff-list.v1',
  // v2 新缓存模型 - 候选 Buff 列表（DamageTab 刷新用，与已选 Buff 实体隔离）
  CANDIDATE_BUFF_LIST: 'ddd.candidate-buff-list.v1',

  // 废弃/迁移用（不再作为主数据源）
  /** @deprecated 仅用于迁移，新代码不要直接使用 */
  SKILL_BUTTON_BUFFS: 'ddd.skill-button-buffs.v1',

  // 其他存储
  SELECTED_CHARACTERS: 'ddd.selected-characters.v1',
  SELECTED_SKILL_BUTTON: 'ddd.selected-skill-button',
  TIMELINE_DATA: 'ddd.timeline.data.v1',
  TIMELINE_SNAPSHOT_ARCHIVE: 'ddd.timeline.snapshot-archive.v1',

  // 运行时模板表 - 官方和本地角色的统一运行时模板缓存（sessionStorage）
  RUNTIME_OPERATOR_TEMPLATE_MAP: 'ddd.operator-runtime.template-map.v1',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
