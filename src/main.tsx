import React from 'react'
import ReactDOM from 'react-dom/client'
import { getAppHostExtension } from './platform/host/appHost'

declare global {
  interface Window {
    __DMG_MARK_MODULE_READY__?: () => void
    __DMG_RECOVER_STARTUP__?: () => Promise<void>
    __DMG_ENSURE_SERVICE_WORKER__?: () => Promise<boolean>
    __DMG_MOBILE_ENTRY__?: boolean
  }
}

// Refreshing the browser must not be blocked by a stale workbench unload guard.
// Keep the original handler here for a deliberate future re-enable.
// window.onbeforeunload = (event: BeforeUnloadEvent) => {
//   event.preventDefault()
//   event.returnValue = '确定要离开当前页面吗？'
//   return event.returnValue
// }

const root = ReactDOM.createRoot(document.getElementById('root')!)

async function mountEntry() {
  await getAppHostExtension().beforeMount?.()
  const isLocalResourcePackager = (
    ['127.0.0.1', 'localhost'].includes(window.location.hostname)
    && window.location.hash.split('?')[0] === '#/settings/resource-packager'
  )
  const Entry = isLocalResourcePackager
    ? (await import('./components/WebApp/ResourcePackagerPage')).ResourcePackagerPage
    : window.__DMG_MOBILE_ENTRY__
      ? (await import('./mobile/MobileBootstrap')).MobileBootstrap
      : (await import('./components/WebApp/WebBootstrap')).WebBootstrap

  root.render(
    <React.StrictMode>
      <Entry />
    </React.StrictMode>,
  )

  // The selected entry module is now usable. Desktop themes and image services
  // continue their own initialization after WebBootstrap mounts.
  window.__DMG_MARK_MODULE_READY__?.()
}

void mountEntry()
