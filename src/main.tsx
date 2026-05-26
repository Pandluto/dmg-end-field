import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AppProvider } from './context/AppContext'
import { bootstrapLocalDataBridge } from './utils/localDataBridge'

async function bootstrap() {
  const { shouldRender } = await bootstrapLocalDataBridge();
  if (!shouldRender) {
    return;
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <AppProvider>
        <App />
      </AppProvider>
    </React.StrictMode>,
  )
}

bootstrap();
