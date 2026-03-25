import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'

import tasksRouter  from './routes/tasks.js'
import bidsRouter   from './routes/bids.js'
import agentsRouter from './routes/agents.js'
import verifyRouter from './routes/verify.js'
import { pool }     from './lib/db.js'

const app  = express()
const PORT = process.env.PORT || 3001

// ── Security ──────────────────────────────────────────────────────────────────
app.use(helmet())
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',   // set to your FE domain in prod
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: [
    'Content-Type', 'Authorization',
    'x-wallet-address', 'x-wallet-message', 'x-wallet-signature',
    'payment-signature', 'x-payment',
  ],
}))

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Generous for local dev — frontend + 2 agents all hit from same IP.
// Tighten in production via NODE_ENV check.
// const limiter = rateLimit({
//   windowMs: 60 * 1000,
//   max: process.env.NODE_ENV === 'production' ? 300 : 2000,
//   standardHeaders: true,
//   legacyHeaders: false,
//   message: { error: 'Too many requests, slow down' },
// })
// app.use(limiter)

// const writeLimiter = rateLimit({
//   windowMs: 60 * 1000,
//   max: process.env.NODE_ENV === 'production' ? 60 : 500,
//   message: { error: 'Too many write requests' },
// })

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }))

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({
      status:  'ok',
      db:      'connected',
      time:    new Date().toISOString(),
      env:     process.env.NODE_ENV,
    })
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected' })
  }
})

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/tasks',   tasksRouter)
app.use('/bids',     bidsRouter)
app.use('/agents',  agentsRouter)
app.use('/verify',   verifyRouter)

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` })
})

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[unhandled error]', err)
  res.status(500).json({ error: 'Internal server error' })
})

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║   AgentMarket API                        ║
  ║   http://localhost:${PORT}                  ║
  ║   env: ${process.env.NODE_ENV?.padEnd(33)}║
  ╚══════════════════════════════════════════╝
  `)
})

export default app