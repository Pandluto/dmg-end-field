export const STORAGE_KEYS = {
  // v3 主存储 - 角色输入配置
  CHARACTER_INPUT_MAP: 'ddd.operator-config.character-input-map.v3',
  // v3 计算缓存
  CHARACTER_COMPUTED_MAP: 'ddd.operator-runtime.character-computed-map.v3',
  // v3 UI 展示缓存（可选，建议内存态）
  CHARACTER_DISPLAY_CACHE: 'ddd.operator-ui.character-display-cache.v3',

  // 其他存储
  SKILL_BUTTON_BUFFS: 'ddd.skill-button-buffs.v1',
  SELECTED_SKILL_BUTTON: 'ddd.selected-skill-button',
  TIMELINE_DATA: 'ddd.timeline.data.v1',
  ALL_BUFF_LIST: 'ddd.all-buff-list.v1',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
