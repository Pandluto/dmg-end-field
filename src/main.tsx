import React from 'react'
import ReactDOM from 'react-dom/client'
import { WebBootstrap } from './components/WebApp/WebBootstrap'

declare global {
  interface Window {
    __DMG_MARK_MODULE_READY__?: () => void
    __DMG_RECOVER_STARTUP__?: () => void
  }
}

// Refreshing the browser must not be blocked by a stale workbench unload guard.
// Keep the original handler here for a deliberate future re-enable.
// window.onbeforeunload = (event: BeforeUnloadEvent) => {
//   event.preventDefault()
//   event.returnValue = '确定要离开当前页面吗？'
//   return event.returnValue
// }

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WebBootstrap />
  </React.StrictMode>,
)

window.__DMG_MARK_MODULE_READY__?.()
