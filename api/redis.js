// api/redis.js — Upstash Redis client (REST-based, works in serverless + Node.js)
const { Redis } = require('@upstash/redis')

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL,
  token: process.env.UPSTASH_REDIS_TOKEN,
})

module.exports = redis
