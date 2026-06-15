import type { SkillType } from '../types';
import { SKILL_NAMES } from '../types';

const USER_IMAGE_ORIGIN = 'http://127.0.0.1:31457';
const DESKTOP_ASSET_ORIGIN = 'http://127.0.0.1:31457';

function isExternalUrl(path: string): boolean {
  return /^(?:[a-z]+:)?\/\//i.test(path) || /^(?:data|blob|file):/i.test(path);
}

function resolveUserImagePath(path: string): string | null {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  const userImagePrefixes = ['user-images/', 'data/images/'];
  const matchedPrefix = userImagePrefixes.find((prefix) => normalized.startsWith(prefix));
  if (!matchedPrefix) {
    return null;
  }

  let relPath = normalized.slice(matchedPrefix.length);
  if (relPath.startsWith('images/')) {
    relPath = relPath.slice('images/'.length);
  }
  if (!relPath || /(^|\/)\.\.(\/|$)/.test(relPath)) {
    return null;
  }
  const encodedRel = relPath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  if (!encodedRel) {
    return null;
  }
  return `${USER_IMAGE_ORIGIN}/user-images/${encodedRel}`;
}

function isDesktopRuntimeAvailable(): boolean {
  return typeof window !== 'undefined'
    && typeof (window as unknown as { desktopRuntime?: unknown }).desktopRuntime === 'object';
}

function encodePathSegments(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return encodeURIComponent(decodeURIComponent(segment));
      } catch {
        return encodeURIComponent(segment);
      }
    })
    .join('/');
}

function resolveDesktopAssetPath(path: string): string | null {
  if (!isDesktopRuntimeAvailable()) {
    return null;
  }
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized.startsWith('assets/')) {
    return null;
  }
  if (/(^|\/)\.\.(\/|$)/.test(normalized)) {
    return null;
  }
  return `${DESKTOP_ASSET_ORIGIN}/${encodePathSegments(normalized)}`;
}

export function resolvePublicPath(path: string): string {
  if (!path) {
    return path;
  }

  if (isExternalUrl(path)) {
    return path;
  }

  const desktopAssetPath = resolveDesktopAssetPath(path);
  if (desktopAssetPath) {
    return desktopAssetPath;
  }

  const normalizedPath = path
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
  const baseUrl = import.meta.env.BASE_URL || './';
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

  return `${normalizedBaseUrl}${normalizedPath}`;
}

export function normalizeAssetUrl(path?: string | null): string {
  if (!path) return '';
  return resolveUserImagePath(path) ?? resolveDesktopAssetPath(path) ?? resolvePublicPath(path);
}

/**
 * 角色头像资源路径解析
 * 规范路径: /assets/avatars/<characterName>/<characterName>.png
 * @param characterName - 角色名称（URL 编码，兼容中文等特殊字符）
 */
export function resolveAvatarUrl(characterName: string): string {
  return resolvePublicPath(`assets/avatars/${encodeURIComponent(characterName)}/${encodeURIComponent(characterName)}.png`);
}

/**
 * 技能图标资源路径解析
 * 规范路径: /assets/avatars/<characterName>/<characterName><skillName>.png
 * 技能类型 A/B/E/Q 对应 普通攻击/战技/连携技/终结技
 * 注意：实际文件名如 "管理员战技.png"，直接拼接在角色名后，无 skills/ 子目录
 * @param characterName - 角色名称
 * @param skillType     - A | B | E | Q
 */
export function resolveSkillIconUrl(characterName: string, skillType: SkillType): string {
  const skillName = SKILL_NAMES[skillType];
  return resolvePublicPath(`assets/avatars/${encodeURIComponent(characterName)}/${encodeURIComponent(characterName)}${skillName}.png`);
}

/**
 * 基于 element 属性返回半透明背景色
 * 用于头像区域底色，适配半透明 PNG 贴图
 * 严格遵循计划定义的 6 种 element 色值，禁止自行扩展
 */
export function getElementBackgroundColor(element: string): string {
  const colorMap: Record<string, string> = {
    physical:  '#E0D6C8',               // 物理主题灰
    ice:       'rgba(200, 235, 255, 1)',   // 更浅冰蓝
    fire:      'rgba(255, 210, 195, 1)',   // 更浅暖
    electric:  'rgba(245, 245, 190, 1)',   // 更浅黄
    nature:    'rgba(175, 225, 185, 1)',   // 更浅绿
  };
  return colorMap[element] ?? 'rgba(200, 200, 200, 0.75)';
}
