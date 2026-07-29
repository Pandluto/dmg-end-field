import { createLogger, defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

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

export default defineConfig({
  base: './',
  customLogger: logger,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'app-icon.svg',
        'web-data-manifest.json',
        'web-image-manifest.json',
      ],
      manifest: {
        name: '终末地伤害工作台',
        short_name: '伤害工作台',
        description: '离线优先的终末地配装、排轴与伤害计算工作台',
        theme_color: '#07100f',
        background_color: '#07100f',
        display: 'standalone',
        start_url: './#/welcome',
        icons: [
          {
            src: 'app-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,svg,ico,woff2,wasm}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/data/'),
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
        enabled: true,
        type: 'module',
      },
    }),
  ],
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
})
