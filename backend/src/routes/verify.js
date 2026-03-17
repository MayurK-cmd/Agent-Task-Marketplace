import { Router } from 'express'
import { query, queryOne } from '../lib/db.js'
import { requireWalletAuth } from '../middleware/auth.js'
import { requireX402Payment } from '../middleware/x402.js'
import { uploadDeliverable, gatewayUrl } from '../lib/ipfs.js'

const router = Router()

/**
 * POST /verify
 *
 * Called by the winning bidder agent when work is complete.
 * Uploads deliverable to IPFS, records CID, notifies poster.
 *
 * The poster then calls PATCH /tasks/:id/settle (with winning bid id)
 * which triggers the on-chain TaskMarket.sol::settleTask() split.
 *
 * Protected by:
 *   - requireWalletAuth (must be the winning bidder)
 *   - requireX402Payment (x402 payment header gate)
 */
router.post('/', requireWalletAuth, requireX402Payment, async (req, res) => {
  try {
    const { task_id, content, content_type = 'text' } = req.body

    if (!task_id || !content) {
      return res.status(400).json({ error: 'Required: task_id, content' })
    }

    // Fetch task
    const task = await queryOne('SELECT * FROM tasks WHERE id = $1', [task_id])
    if (!task) return res.status(404).json({ error: 'Task not found' })
    if (task.status !== 'in_progress') {
      return res.status(400).json({
        error: `Task is not in progress (status: ${task.status})`,
      })
    }

    // Verify caller is the winning bidder
    const winningBid = await queryOne(
      `SELECT * FROM bids WHERE id = $1`, [task.winning_bid_id]
    )
    if (!winningBid || winningBid.bidder_wallet !== req.wallet) {
      return res.status(403).json({
        error: 'Only the winning bidder can submit deliverables',
      })
    }

    // Upload deliverable to IPFS
    const cid = await uploadDeliverable({
      taskId:      task_id,
      content,
      contentType: content_type,
      agentWallet: req.wallet,
    })

    // Record CID on task (poster still needs to call /settle to pay)
    await queryOne(`
      UPDATE tasks
      SET ipfs_cid = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [cid, task_id])

    // Log IPFS submission
    await query(`
      INSERT INTO transactions (type, task_id, bid_id, from_wallet, meta)
      VALUES ('ipfs_submitted', $1, $2, $3, $4)
    `, [task_id, winningBid.id, req.wallet,
        JSON.stringify({ cid, contentType: content_type })])

    res.json({
      success:     true,
      cid,
      gateway_url: gatewayUrl(cid),
      message:     'Deliverable uploaded. Poster can now call PATCH /tasks/:id/settle to release payment.',
    })
  } catch (err) {
    console.error('[POST /verify]', err)
    res.status(500).json({ error: 'Failed to submit deliverable' })
  }
})

// ── GET /verify/stats ─────────────────────────────────────────────────────────
// Public. Platform stats for the dashboard ticker.
router.get('/stats', async (req, res) => {
  try {
    const stats = await queryOne(`
      SELECT
        (SELECT COUNT(*) FROM tasks)::int                                   AS total_tasks,
        (SELECT COUNT(*) FROM tasks WHERE status = 'open')::int            AS open_tasks,
        (SELECT COUNT(*) FROM tasks WHERE status = 'completed')::int       AS completed_tasks,
        (SELECT COUNT(*) FROM agents WHERE is_online = TRUE)::int          AS online_agents,
        (SELECT COUNT(*) FROM agents)::int                                 AS total_agents,
        (SELECT COALESCE(SUM(amount_wei), 0) FROM bids WHERE status='paid') AS total_volume_wei,
        (SELECT COUNT(*) FROM bids)::int                                   AS total_bids
    `)
    res.json({ stats })
  } catch (err) {
    console.error('[GET /verify/stats]', err)
    res.status(500).json({ error: 'Failed to fetch stats' })
  }
})

export default router