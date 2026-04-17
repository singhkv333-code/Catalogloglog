const { Pool } = require('pg')
const { URL } = require('url')

function getDbHost(connectionString) {
  if (!connectionString) return ''
  try {
    return new URL(connectionString).hostname || ''
  } catch {
    return ''
  }
}

function resolveSslOption() {
  const raw = (process.env.DATABASE_SSL || process.env.PGSSLMODE || '').trim().toLowerCase()
  if (['disable', 'false', '0', 'off', 'no'].includes(raw)) return false
  if (['require', 'true', '1', 'on', 'yes'].includes(raw)) return { rejectUnauthorized: false }

  const host = getDbHost(process.env.DATABASE_URL)
  const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(host)
  return isLocalHost ? false : { rejectUnauthorized: false }
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: resolveSslOption(),
  max: 3,
})

module.exports = pool
