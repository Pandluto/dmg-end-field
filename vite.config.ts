import { createLogger, defineConfig } from 'vite'
import { createRequire } from 'node:module'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { sites } from './build/sites-vite-plugin'
import hostingConfig from './.openai/hosting.json'

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID = '00000000-0000-4000-8000-000000000000'
const require = createRequire(import.meta.url)
const { createOfficialResourceProxyHandler } = require('./electron/official-resource-proxy.cjs') as {
  createOfficialResourceProxyHandler: () => (
    request: unknown,
    response: unknown,
  ) => Promise<boolean>
}

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
    : true
  const plugins = [
    react(),
    tailwindcss(),
  ]

  if (!sitesBuild) {
    plugins.push({
      name: 'dmg-desktop-official-resource-proxy',
      configureServer(server) {
        const handleOfficialResourceRequest = createOfficialResourceProxyHandler()
        server.middlewares.use((request, response, next) => {
          void handleOfficialResourceRequest(request, response).then((handled) => {
            if (!handled) next()
          }).catch(next)
        })
      },
    })
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
        d1_databases: hostingConfig.d1
          ? [{
            binding: hostingConfig.d1,
            database_name: 'site-creator-d1',
            database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
          }]
          : [],
        r2_buckets: hostingConfig.r2
          ? [{
            binding: hostingConfig.r2,
            bucket_name: 'site-creator-r2',
          }]
          : [],
        assets: {
          binding: 'ASSETS',
          not_found_handling: 'single-page-application',
          run_worker_first: true,
        },
      },
    }))
    plugins.push(sites())
  }

  return {
    base: sitesBuild ? '/' : './',
    resolve: {
      extensions: [
        '.desktop.mjs', '.desktop.js', '.desktop.mts', '.desktop.ts',
        '.desktop.jsx', '.desktop.tsx', '.desktop.json',
        '.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json',
      ],
    },
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
