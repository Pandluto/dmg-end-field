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

let creatingSession = false

export async function createDefNativeSession() {
  const profile = defEmbeddedProfile()
  if (!profile || creatingSession || !defFeature("sessionCreate")) return false
  creatingSession = true
  try {
    const response = await fetch("/api/native/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ host: profile.host, skillId: profile.skillId }),
    })
    const payload = await response.json()
    if (!response.ok || !payload?.session?.uiPath) {
      throw new Error(payload?.error ?? `DEF native session create failed (${response.status})`)
    }
    const target = new URL(payload.session.uiPath, window.location.origin)
    target.searchParams.set("def_host", profile.host)
    window.location.assign(target.toString())
    return true
  } finally {
    creatingSession = false
  }
}
