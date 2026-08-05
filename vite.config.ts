import { createLogger, defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { sites } from './build/sites-vite-plugin'

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
  loggerInfo(message, options)
}

export default defineConfig(async () => {
  const sitesBuild = process.env.SITES_BUILD === '1'
  const plugins = [
    react(),
    tailwindcss(),
  ]

  if (sitesBuild) {
    process.env.WRANGLER_WRITE_LOGS ??= 'false'
    process.env.WRANGLER_LOG_PATH ??= '.wrangler/wrangler.log'
    process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry'
    const { cloudflare } = await import('@cloudflare/vite-plugin')
    plugins.push(cloudflare({
      viteEnvironment: { name: 'server' },
      config: {
        name: 'dmg-end-field',
        main: './worker/index.ts',
        compatibility_date: '2026-07-29',
        compatibility_flags: ['nodejs_compat'],
        assets: {
          binding: 'ASSETS',
          not_found_handling: 'single-page-application',
          run_worker_first: [
            '/',
            '/index.html',
            '/sw.js',
            '/version.json',
            '/manifest.webmanifest',
            '/packages/*',
          ],
        },
      },
    }))
    plugins.push(sites())
  }

  return {
    base: sitesBuild ? '/' : './',
    customLogger: logger,
    plugins,
    optimizeDeps: {
      entries: ['index.html'],
      exclude: ['@sqlite.org/sqlite-wasm'],
    },
    build: {
      rollupOptions: {
        output: {
          onlyExplicitManualChunks: true,
          manualChunks(id) {
            const normalizedId = id.replaceAll('\\', '/')
            if (
              normalizedId.includes('/node_modules/@ybouane/liquidglass/')
              || normalizedId.includes('/src/platform/theme/LiquidTideEffects')
              || normalizedId.includes('/src/platform/theme/useLiquidTide')
              || normalizedId.includes('/src/platform/theme/liquidGlass')
            ) {
              return 'theme-liquid-runtime'
            }
            return undefined
          },
        },
      },
    },
    server: {
      port: 3030,
      watch: {
        ignored: ['**/data/localdata/**', '**/.dbg/**'],
      },
    },
  }
})
