import { createLogger, defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const logger = createLogger()
const loggerWarn = logger.warn
const loggerInfo = logger.info

logger.warn = (message, options) => {
  if (
    message.includes('Files in the public directory are served at the root path.') ||
    message.includes('Instead of /public/images/weapon/icon/')
  ) {
    return
  }
  loggerWarn(message, options)
}

logger.info = (message, options) => {
  if (/\[vite\]\s+page reload electron\/main\.cjs/.test(message)) {
    return
  }
  loggerInfo(message, options)
}

export default defineConfig({
  base: './',
  customLogger: logger,
  plugins: [
    react(),
    tailwindcss(),
  ],
  optimizeDeps: {
    entries: ['index.html'],
  },
  server: {
    port: 3030,
    watch: {
      ignored: ['**/data/localdata/**', '**/.dbg/**', '**/agent/vendor/**'],
    },
  },
})
