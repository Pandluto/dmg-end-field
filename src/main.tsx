import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AppProvider } from './context/AppContext'
import { bootstrapLocalDataBridge } from './utils/localDataBridge'
import { installMainWorkbenchWindowApi } from './utils/mainWorkbenchControl'
import { bootstrapUserWorkspaceBridge } from './utils/userWorkspaceBridge'
import { bootstrapLegacyFillHostGateway } from './legacyFillHost/runtime'

// Refreshing the browser must not be blocked by a stale workbench unload guard.
// Keep the original handler here for a deliberate future re-enable.
// window.onbeforeunload = (event: BeforeUnloadEvent) => {
//   event.preventDefault()
//   event.returnValue = '确定要离开当前页面吗？'
//   return event.returnValue
// }

async function bootstrap() {
  await bootstrapUserWorkspaceBridge();
  const { shouldRender } = await bootstrapLocalDataBridge();
  if (!shouldRender) {
    return;
  }
  installMainWorkbenchWindowApi();
  await bootstrapLegacyFillHostGateway();

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <AppProvider>
        <App />
      </AppProvider>
    </React.StrictMode>,
  )
}

bootstrap();
