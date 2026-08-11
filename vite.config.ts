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
  const mobileShareEnabled = process.env.DEF_MOBILE_SHARE_ENABLED
    ? process.env.DEF_MOBILE_SHARE_ENABLED === '1'
    : !sitesBuild
  const plugins = [
    react(),
    tailwindcss(),
  ]

  if (!sitesBuild) {
    plugins.push({
      name: 'def-mobile-share-development-api',
      async configureServer(server) {
        const mobileShareService = await import('./server/mobile-share-server.mjs') as unknown as {
          createMobileShareRequestHandler: (options: {
            dbPath: string
            trustProxy: boolean
          }) => ((request: unknown, response: unknown) => Promise<void>) & { close: () => void }
          getDefaultDevelopmentShareDatabasePath: () => string
        }
        const mobileShareHandler = mobileShareService.createMobileShareRequestHandler({
          dbPath: process.env.DEF_MOBILE_SHARE_DB || mobileShareService.getDefaultDevelopmentShareDatabasePath(),
          trustProxy: true,
        })
        server.middlewares.use((request, response, next) => {
          if (!request.url?.startsWith('/api/mobile-shares')) {
            next()
            return
          }
          void mobileShareHandler(request, response)
        })
        server.httpServer?.once('close', () => mobileShareHandler.close())
      },
    })
  }

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
            '/mobile',
            '/mobile/*',
            '/cache-recovery.html',
            '/sw.js',
            '/version.json',
            '/manifest.webmanifest',
            '/resources/stable.json',
            '/web-data-manifest.json',
            '/web-image-manifest.json',
            '/resources/releases/*',
            '/assets/images/*',
          ],
        },
      },
    }))
    plugins.push(sites())
  }

  return {
    base: sitesBuild ? '/' : './',
    define: {
      __DEF_MOBILE_SHARE_ENABLED__: JSON.stringify(mobileShareEnabled),
    },
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
