import * as definitions from './def.js'

export default async function DefToolsPlugin() {
  const tool = Object.fromEntries(
    Object.entries(definitions)
      .filter(([, definition]) => definition && typeof definition.execute === 'function')
      .map(([id, definition]) => [`def_${id}`, definition]),
  )
  return { tool }
}
