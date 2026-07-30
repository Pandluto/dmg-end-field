import { createLogger, defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
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
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'app-icon.png',
        'web-data-manifest.json',
        'web-image-manifest.json',
      ],
      manifest: {
        name: '终末地伤害工作台',
        short_name: '伤害工作台',
        description: '离线优先的终末地配装、排轴与伤害计算工作台',
        lang: 'zh-CN',
        theme_color: '#e9ecea',
        background_color: '#e9ecea',
        display: 'standalone',
        start_url: './#/welcome',
        icons: [
          {
            src: 'app-icon.png',
            sizes: '736x736',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        importScripts: ['sw-client-migration.js'],
        globPatterns: ['**/*.{js,css,html,svg,ico,woff2,wasm}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'dmg-app-shell-v2',
              networkTimeoutSeconds: 4,
              cacheableResponse: {
                statuses: [0, 200],
              },
              precacheFallback: {
                fallbackURL: 'index.html',
              },
              expiration: {
                maxEntries: 4,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
          {
            urlPattern: ({ url, sameOrigin }) => (
              sameOrigin
              && url.pathname.includes('/data/')
              && !url.pathname.includes('/src/')
            ),
            handler: 'CacheFirst',
            options: {
              cacheName: 'dmg-resource-pack-v1',
              expiration: {
                maxEntries: 240,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
          {
            urlPattern: ({ url }) => url.pathname.includes('/assets/images/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'dmg-image-pack-v1',
              expiration: {
                maxEntries: 1200,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: !sitesBuild,
        type: 'module',
      },
    }),
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
    server: {
      port: 3030,
      watch: {
        ignored: ['**/data/localdata/**', '**/.dbg/**'],
      },
    },
  }
})
