import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

type ServiceWorkerPluginOptions = {
  emitStaticAsset: boolean
}

export function serviceWorker({
  emitStaticAsset,
}: ServiceWorkerPluginOptions): Plugin {
  let sourcePath = resolve(process.cwd(), 'worker', 'service-worker.js')

  return {
    name: 'dmg-service-worker',
    configResolved(config) {
      sourcePath = resolve(config.root, 'worker', 'service-worker.js')
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url || '/', 'http://localhost').pathname
        if (pathname !== '/sw.js') {
          next()
          return
        }

        response.statusCode = 200
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
        response.setHeader('Service-Worker-Allowed', '/')
        response.end(await readFile(sourcePath, 'utf8'))
      })
    },
    async generateBundle() {
      if (!emitStaticAsset) return
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: await readFile(sourcePath, 'utf8'),
      })
    },
  }
}
