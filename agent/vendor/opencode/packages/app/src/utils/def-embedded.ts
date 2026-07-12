export type DefEmbeddedProfile = {
  schemaVersion: number
  host: "workbench" | "ai-cli"
  agent: string
  skillId: string
  theme: string
  lockedAgent: boolean
  lockedModel: boolean
  features: Record<string, boolean>
}

export function defEmbeddedProfile() {
  return window.__DEF_EMBEDDED_PROFILE__
}

export function defFeature(name: string, fallback = false) {
  return defEmbeddedProfile()?.features?.[name] ?? fallback
}
