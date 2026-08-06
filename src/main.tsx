import React from 'react'
import ReactDOM from 'react-dom/client'
import { WebBootstrap } from './components/WebApp/WebBootstrap'
import { installDesktopResourceWorkerRuntime } from './platform/desktop/desktopResourceWorker'

declare global {
  interface Window {
    __DMG_DESKTOP_WEB_HOST__?: boolean
    __DMG_MARK_MODULE_READY__?: () => void
    __DMG_RECOVER_STARTUP__?: () => Promise<void>
    __DMG_ENSURE_SERVICE_WORKER__?: () => Promise<boolean>
  }
}

// Refreshing the browser must not be blocked by a stale workbench unload guard.
// Keep the original handler here for a deliberate future re-enable.
// window.onbeforeunload = (event: BeforeUnloadEvent) => {
//   event.preventDefault()
//   event.returnValue = '确定要离开当前页面吗？'
//   return event.returnValue
// }

installDesktopResourceWorkerRuntime()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WebBootstrap />
  </React.StrictMode>,
)

// The bundled application shell is usable without an optional theme package.
// The selected theme is loaded by WebBootstrap only after the image service is
// ready, so theme image requests cannot race the controlling service worker.
window.__DMG_MARK_MODULE_READY__?.()
