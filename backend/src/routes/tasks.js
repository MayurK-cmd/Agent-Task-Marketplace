import { Router } from 'express'
import { query, queryOne } from '../lib/db.js'
import { getRepScore } from '../lib/erc8004.js'
import { requireWalletAuth } from '../middleware/auth.js'

const router = Router()

// ── GET /tasks ────────────────────────────────────────────────────────────────
// Public. Returns all tasks, newest first.
// Query params: ?status=open&category=data_collection&limit=50&offset=0
router.get('/', async (req, res) => {
  try {
    const { status, category, limit = 50, offset = 0 } = req.query

    const conditions = []
    const params = []

    if (status) {
      params.push(status)
      conditions.push(`t.status = $${params.length}`)
    }
    if (category) {
      params.push(category)
      conditions.push(`t.category = $${params.length}`)
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    params.push(parseInt(limit), parseInt(offset))

    const { rows } = await query(`
      SELECT
        t.*,
        COUNT(b.id)::int          AS bid_count,
        MIN(b.amount_wei)::bigint AS lowest_bid
      FROM tasks t
      LEFT JOIN bids b ON b.task_id = t.id AND b.status != 'rejected'
      ${where}
      GROUP BY t.id
      ORDER BY t.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params)

    res.json({ tasks: rows, count: rows.length })
  } catch (err) {
    console.error('[GET /tasks]', err)
    res.status(500).json({ error: 'Failed to fetch tasks' })
  }
})

// ── GET /tasks/:id ────────────────────────────────────────────────────────────
// Public. Returns single task with its bids.
router.get('/:id', async (req, res) => {
  try {
    const task = await queryOne(
      'SELECT * FROM tasks WHERE id = $1', [req.params.id]
    )
    if (!task) return res.status(404).json({ error: 'Task not found' })

    const { rows: bids } = await query(
      `SELECT b.*, a.name AS bidder_name
       FROM bids b
       LEFT JOIN agents a ON a.wallet = b.bidder_wallet
       WHERE b.task_id = $1
       ORDER BY b.amount_wei ASC`,
      [req.params.id]
    )

    res.json({ task, bids })
  } catch (err) {
    console.error('[GET /tasks/:id]', err)
    res.status(500).json({ error: 'Failed to fetch task' })
  }
})

// ── POST /tasks ───────────────────────────────────────────────────────────────
// Protected (wallet auth). Anyone with a valid Celo wallet can post.
router.post('/', requireWalletAuth, async (req, res) => {
  try {
    const {
      title, description, category, budget_wei,
      deadline, min_rep_score = 0,
      chain_task_id, tx_hash,
    } = req.body

    // Basic validation
    if (!title || !category || !budget_wei || !deadline) {
      return res.status(400).json({
        error: 'Required: title, category, budget_wei, deadline',
      })
    }

    const VALID_CATEGORIES = ['data_collection', 'code_review', 'content_gen', 'defi_ops']
    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` })
    }

    // Upsert poster into agents table (first time they post)
    await query(`
      INSERT INTO agents (wallet, last_seen, is_online)
      VALUES ($1, NOW(), TRUE)
      ON CONFLICT (wallet) DO UPDATE
        SET last_seen = NOW(), is_online = TRUE
    `, [req.wallet])

    // Create task
    const task = await queryOne(`
      INSERT INTO tasks
        (title, description, category, budget_wei, deadline, min_rep_score,
         poster_wallet, chain_task_id, tx_hash)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `, [title, description, category, budget_wei, deadline, min_rep_score,
        req.wallet, chain_task_id ?? null, tx_hash ?? null])

    // Log transaction event
    await query(`
      INSERT INTO transactions (type, task_id, from_wallet, tx_hash, meta)
      VALUES ('task_posted', $1, $2, $3, $4)
    `, [task.id, req.wallet, tx_hash ?? null, JSON.stringify({ title, category })])

    res.status(201).json({ task })
  } catch (err) {
    console.error('[POST /tasks]', err)
    res.status(500).json({ error: 'Failed to create task' })
  }
})

// ── PATCH /tasks/:id/settle ───────────────────────────────────────────────────
// Protected. Poster confirms completion → updates status, records IPFS CID.
// Actual payment split happens on-chain in TaskMarket.sol::settleTask().
router.patch('/:id/settle', requireWalletAuth, async (req, res) => {
  try {
    const { ipfs_cid, tx_hash, winning_bid_id } = req.body

    const task = await queryOne('SELECT * FROM tasks WHERE id = $1', [req.params.id])
    if (!task) return res.status(404).json({ error: 'Task not found' })
    if (task.poster_wallet !== req.wallet) {
      return res.status(403).json({ error: 'Only the task poster can settle' })
    }
    if (task.status !== 'in_progress') {
      return res.status(400).json({ error: `Cannot settle task with status: ${task.status}` })
    }

    // Mark task complete
    const updated = await queryOne(`
      UPDATE tasks
      SET status = 'completed', ipfs_cid = $1, winning_bid_id = $2, updated_at = NOW()
      WHERE id = $3
      RETURNING *
    `, [ipfs_cid, winning_bid_id, task.id])

    // Mark winning bid as paid
    if (winning_bid_id) {
      await query(
        `UPDATE bids SET status = 'paid', tx_hash = $1 WHERE id = $2`,
        [tx_hash ?? null, winning_bid_id]
      )
      // Mark other bids on this task as outbid
      await query(
        `UPDATE bids SET status = 'outbid' WHERE task_id = $1 AND id != $2 AND status = 'pending'`,
        [task.id, winning_bid_id]
      )
      // Update bidder agent stats
      const bid = await queryOne('SELECT * FROM bids WHERE id = $1', [winning_bid_id])
      if (bid) {
        await query(`
          UPDATE agents
          SET tasks_done = tasks_done + 1, total_earned = total_earned + $1
          WHERE wallet = $2
        `, [bid.amount_wei, bid.bidder_wallet])
      }
    }

    // Log settlement event
    await query(`
      INSERT INTO transactions (type, task_id, bid_id, tx_hash, meta)
      VALUES ('task_settled', $1, $2, $3, $4)
    `, [task.id, winning_bid_id ?? null, tx_hash ?? null,
        JSON.stringify({ ipfs_cid })])

    res.json({ task: updated })
  } catch (err) {
    console.error('[PATCH /tasks/:id/settle]', err)
    res.status(500).json({ error: 'Failed to settle task' })
  }
})

// ── PATCH /tasks/:id/dispute ──────────────────────────────────────────────────
// Protected. Poster raises a dispute (escrow stays locked in contract).
router.patch('/:id/dispute', requireWalletAuth, async (req, res) => {
  try {
    const { reason } = req.body
    const task = await queryOne('SELECT * FROM tasks WHERE id = $1', [req.params.id])
    if (!task) return res.status(404).json({ error: 'Task not found' })
    if (task.poster_wallet !== req.wallet) {
      return res.status(403).json({ error: 'Only the poster can raise a dispute' })
    }

    const updated = await queryOne(
      `UPDATE tasks SET status = 'disputed', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [task.id]
    )

    await query(
      `INSERT INTO transactions (type, task_id, from_wallet, meta) VALUES ('dispute_raised', $1, $2, $3)`,
      [task.id, req.wallet, JSON.stringify({ reason })]
    )

    res.json({ task: updated })
  } catch (err) {
    console.error('[PATCH /tasks/:id/dispute]', err)
    res.status(500).json({ error: 'Failed to dispute task' })
  }
})

export default router