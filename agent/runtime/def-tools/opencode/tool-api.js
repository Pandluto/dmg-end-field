import { z } from 'zod'

// OpenCode's plugin helper is intentionally a thin identity wrapper. Keeping
// that runtime contract here avoids importing an ignored vendor installation.
export function tool(input) {
  return input
}

tool.schema = z
