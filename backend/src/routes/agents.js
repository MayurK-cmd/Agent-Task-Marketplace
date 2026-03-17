import { Router } from 'express'
import { query, queryOne } from '../lib/db.js'
import { getRepScore, getIdentity } from '../lib/erc8004.js'
import { requireWalletAuth } from '../middleware/auth.js'

const router = Router()

// ── GET /agents ───────────────────────────────────────────────────────────────
// Public. Returns agent leaderboard sorted by rep score.
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        a.*,
        COALESCE(
          (SELECT COUNT(*) FROM tasks WHERE poster_wallet = a.wallet),
          0
        )::int AS tasks_posted
      FROM agents a
      ORDER BY a.rep_score DESC, a.tasks_done DESC
      LIMIT 100
    `)
    res.json({ agents: rows })
  } catch (err) {
    console.error('[GET /agents]', err)
    res.status(500).json({ error: 'Failed to fetch agents' })
  }
})

// ── GET /agents/:wallet ───────────────────────────────────────────────────────
// Public. Returns single agent profile with their recent bids and tasks.
router.get('/:wallet', async (req, res) => {
  try {
    const wallet = req.params.wallet.toLowerCase()

    const agent = await queryOne('SELECT * FROM agents WHERE wallet = $1', [wallet])
    if (!agent) return res.status(404).json({ error: 'Agent not found' })

    // Fetch latest rep from chain (may have changed)
    const liveRep = await getRepScore(wallet)
    if (liveRep !== agent.rep_score) {
      await query('UPDATE agents SET rep_score = $1 WHERE wallet = $2', [liveRep, wallet])
      agent.rep_score = liveRep
    }

    const { rows: recentBids } = await query(`
      SELECT b.*, t.title AS task_title
      FROM bids b JOIN tasks t ON t.id = b.task_id
      WHERE b.bidder_wallet = $1
      ORDER BY b.created_at DESC
      LIMIT 10
    `, [wallet])

    const { rows: recentTasks } = await query(`
      SELECT id, title, category, status, budget_wei, created_at
      FROM tasks WHERE poster_wallet = $1
      ORDER BY created_at DESC
      LIMIT 10
    `, [wallet])

    res.json({ agent: { ...agent, rep_score: liveRep }, recentBids, recentTasks })
  } catch (err) {
    console.error('[GET /agents/:wallet]', err)
    res.status(500).json({ error: 'Failed to fetch agent' })
  }
})

// ── PUT /agents/me ────────────────────────────────────────────────────────────
// Protected. Agent registers/updates their profile (name, specialty).
router.put('/me', requireWalletAuth, async (req, res) => {
  try {
    const { name, specialty } = req.body

    const VALID_SPECIALTIES = ['data_collection', 'code_review', 'content_gen', 'defi_ops']
    if (specialty && !VALID_SPECIALTIES.includes(specialty)) {
      return res.status(400).json({ error: `specialty must be one of: ${VALID_SPECIALTIES.join(', ')}` })
    }

    // Fetch live rep from chain
    const repScore = await getRepScore(req.wallet)

    const agent = await queryOne(`
      INSERT INTO agents (wallet, name, specialty, rep_score, last_seen, is_online)
      VALUES ($1, $2, $3, $4, NOW(), TRUE)
      ON CONFLICT (wallet) DO UPDATE
        SET name = COALESCE($2, agents.name),
            specialty = COALESCE($3, agents.specialty),
            rep_score = $4,
            last_seen = NOW(),
            is_online = TRUE
      RETURNING *
    `, [req.wallet, name ?? null, specialty ?? null, repScore])

    res.json({ agent })
  } catch (err) {
    console.error('[PUT /agents/me]', err)
    res.status(500).json({ error: 'Failed to update agent' })
  }
})

export default router