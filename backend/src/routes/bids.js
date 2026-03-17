import { Router } from 'express'
import { query, queryOne } from '../lib/db.js'
import { getRepScore } from '../lib/erc8004.js'
import { requireWalletAuth } from '../middleware/auth.js'

const router = Router()

// ── GET /bids ─────────────────────────────────────────────────────────────────
// Public. Returns recent bids across all tasks.
router.get('/', async (req, res) => {
  try {
    const { limit = 50 } = req.query
    const { rows } = await query(`
      SELECT b.*, t.title AS task_title, t.category, a.name AS bidder_name
      FROM bids b
      JOIN tasks t ON t.id = b.task_id
      LEFT JOIN agents a ON a.wallet = b.bidder_wallet
      ORDER BY b.created_at DESC
      LIMIT $1
    `, [parseInt(limit)])
    res.json({ bids: rows })
  } catch (err) {
    console.error('[GET /bids]', err)
    res.status(500).json({ error: 'Failed to fetch bids' })
  }
})

// ── GET /bids/:taskId ─────────────────────────────────────────────────────────
// Public. Returns all bids for a specific task, sorted by amount ascending.
router.get('/:taskId', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT b.*, a.name AS bidder_name, a.specialty AS bidder_specialty
      FROM bids b
      LEFT JOIN agents a ON a.wallet = b.bidder_wallet
      WHERE b.task_id = $1
      ORDER BY b.amount_wei ASC
    `, [req.params.taskId])
    res.json({ bids: rows })
  } catch (err) {
    console.error('[GET /bids/:taskId]', err)
    res.status(500).json({ error: 'Failed to fetch bids' })
  }
})

// ── POST /bids ────────────────────────────────────────────────────────────────
// Protected. Any agent can bid on an open task if their rep qualifies.
router.post('/', requireWalletAuth, async (req, res) => {
  try {
    const { task_id, amount_wei, message, tx_hash } = req.body

    if (!task_id || !amount_wei) {
      return res.status(400).json({ error: 'Required: task_id, amount_wei' })
    }

    // Fetch task
    const task = await queryOne('SELECT * FROM tasks WHERE id = $1', [task_id])
    if (!task) return res.status(404).json({ error: 'Task not found' })

    if (!['open', 'bidding'].includes(task.status)) {
      return res.status(400).json({ error: `Task is not accepting bids (status: ${task.status})` })
    }
    if (new Date(task.deadline) < new Date()) {
      return res.status(400).json({ error: 'Task deadline has passed' })
    }
    if (task.poster_wallet === req.wallet) {
      return res.status(400).json({ error: 'Poster cannot bid on their own task' })
    }

    // Check ERC-8004 rep gate
    const repScore = await getRepScore(req.wallet)
    if (repScore < task.min_rep_score) {
      return res.status(403).json({
        error: `Insufficient reputation. Required: ${task.min_rep_score}, yours: ${repScore}`,
        required: task.min_rep_score,
        actual: repScore,
      })
    }

    // Check bid amount doesn't exceed budget
    if (BigInt(amount_wei) > BigInt(task.budget_wei)) {
      return res.status(400).json({ error: 'Bid amount exceeds task budget' })
    }

    // Prevent duplicate bids from same wallet
    const existing = await queryOne(
      `SELECT id FROM bids WHERE task_id = $1 AND bidder_wallet = $2 AND status != 'rejected'`,
      [task_id, req.wallet]
    )
    if (existing) {
      return res.status(409).json({ error: 'You have already bid on this task' })
    }

    // Upsert bidder into agents table
    await query(`
      INSERT INTO agents (wallet, rep_score, last_seen, is_online)
      VALUES ($1, $2, NOW(), TRUE)
      ON CONFLICT (wallet) DO UPDATE
        SET rep_score = $2, last_seen = NOW(), is_online = TRUE
    `, [req.wallet, repScore])

    // Create bid
    const bid = await queryOne(`
      INSERT INTO bids (task_id, bidder_wallet, amount_wei, rep_score_snap, message, tx_hash)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [task_id, req.wallet, amount_wei, repScore, message ?? null, tx_hash ?? null])

    // Transition task to 'bidding' if still 'open'
    if (task.status === 'open') {
      await query(`UPDATE tasks SET status = 'bidding' WHERE id = $1`, [task_id])
    }

    // Log transaction
    await query(`
      INSERT INTO transactions (type, task_id, bid_id, from_wallet, amount_wei, tx_hash)
      VALUES ('bid_submitted', $1, $2, $3, $4, $5)
    `, [task_id, bid.id, req.wallet, amount_wei, tx_hash ?? null])

    res.status(201).json({ bid })
  } catch (err) {
    console.error('[POST /bids]', err)
    res.status(500).json({ error: 'Failed to submit bid' })
  }
})

// ── POST /bids/:id/accept ─────────────────────────────────────────────────────
// Protected. Poster accepts a specific bid → task moves to in_progress.
router.post('/:id/accept', requireWalletAuth, async (req, res) => {
  try {
    const bid = await queryOne('SELECT * FROM bids WHERE id = $1', [req.params.id])
    if (!bid) return res.status(404).json({ error: 'Bid not found' })

    const task = await queryOne('SELECT * FROM tasks WHERE id = $1', [bid.task_id])
    if (!task) return res.status(404).json({ error: 'Task not found' })
    if (task.poster_wallet !== req.wallet) {
      return res.status(403).json({ error: 'Only the poster can accept a bid' })
    }
    if (task.status !== 'bidding') {
      return res.status(400).json({ error: `Cannot accept bid on task with status: ${task.status}` })
    }

    // Mark this bid as winning
    await query(`UPDATE bids SET status = 'winning' WHERE id = $1`, [bid.id])
    // Mark all others as outbid
    await query(
      `UPDATE bids SET status = 'outbid' WHERE task_id = $1 AND id != $2`,
      [bid.task_id, bid.id]
    )
    // Move task to in_progress
    const updatedTask = await queryOne(`
      UPDATE tasks
      SET status = 'in_progress', winning_bid_id = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [bid.id, bid.task_id])

    res.json({ task: updatedTask, bid })
  } catch (err) {
    console.error('[POST /bids/:id/accept]', err)
    res.status(500).json({ error: 'Failed to accept bid' })
  }
})

export default router