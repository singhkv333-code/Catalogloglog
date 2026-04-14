const path = require('path')
const dotenv = require('dotenv')

dotenv.config({ path: path.join(__dirname, '..', '.env') })

// Load after dotenv so it sees DATABASE_URL / DATABASE_SSL
const pool = require('../db')

async function main() {
  const r = await pool.query('SELECT NOW() as now')
  console.log('db_ok', r.rows[0])
}

main()
  .catch((err) => {
    console.error('db_err', err?.message || err)
    process.exitCode = 1
  })
  .finally(() => pool.end())

