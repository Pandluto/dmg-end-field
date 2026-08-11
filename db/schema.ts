export const MOBILE_SHARE_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS mobile_share_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS mobile_shares (
    id TEXT PRIMARY KEY,
    payload_hash TEXT NOT NULL,
    payload_bytes INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS mobile_shares_payload_hash_unique
    ON mobile_shares (payload_hash)`,
  `CREATE TABLE IF NOT EXISTS mobile_share_creation_events (
    id TEXT PRIMARY KEY,
    ip_hash TEXT NOT NULL,
    device_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_mobile_share_events_created
    ON mobile_share_creation_events (created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_mobile_share_events_ip_created
    ON mobile_share_creation_events (ip_hash, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_mobile_share_events_device_created
    ON mobile_share_creation_events (device_hash, created_at)`,
] as const
