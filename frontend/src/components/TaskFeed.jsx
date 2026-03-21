import { useState, useEffect } from 'react'
import { ethers }              from 'ethers'
import { useTasks, useBids }   from '../hooks/useMarketPlace.js'
import { useWallet }           from '../hooks/useWallet.jsx'
import { useContract }         from '../hooks/useMarketPlace.js'
import { CATEGORY_COLORS, STATUS_COLORS, EXPLORER, API_BASE, shortAddr, ago, timeLeft, cusd } from '../lib/config.js'
import PostTask from './PostTask.jsx'

const FILTERS = ['all','open','bidding','in_progress','completed','disputed']

const pill = (label, color) => ({
  display: 'inline-flex', alignItems: 'center',
  background: color + '18', color, border: `1px solid ${color}40`,
  fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.06em',
  padding: '2px 7px', borderRadius: 2, textTransform: 'uppercase', whiteSpace: 'nowrap',
})

const btn = (color = 'var(--accent)', disabled = false) => ({
  background: color + '18', border: `1px solid ${color}40`, color,
  fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700,
  padding: '5px 14px', borderRadius: 'var(--r)', letterSpacing: '0.06em',
  cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
  transition: 'all 0.15s', whiteSpace: 'nowrap',
})

// ── IPFS Result Modal ─────────────────────────────────────────────────────────
function ResultModal({ cid, title, onClose }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    if (!cid) return
    fetch(`https://gateway.pinata.cloud/ipfs/${cid}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => { setError('Could not load deliverable from IPFS'); setLoading(false) })
  }, [cid])

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 300, animation: 'fade-in 0.15s ease',
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--border2)',
        borderRadius: 12, width: '90%', maxWidth: 680, maxHeight: '80vh',
        display: 'flex', flexDirection: 'column', animation: 'slide-in 0.2s ease',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Task deliverable
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>{title}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <a href={`https://gateway.pinata.cloud/ipfs/${cid}`} target="_blank" rel="noreferrer"
              style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--blue)', textDecoration: 'none' }}>
              ↗ raw IPFS
            </a>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 20, lineHeight: 1, cursor: 'pointer' }}>×</button>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {loading && (
            <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text3)', textAlign: 'center', paddingTop: 40 }}>
              loading from IPFS...
            </div>
          )}
          {error && (
            <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--red)' }}>{error}</div>
          )}
          {data && !loading && <DeliverableView data={data} />}
        </div>
      </div>
    </div>
  )
}

// ── Renders deliverable based on content_type ─────────────────────────────────
function DeliverableView({ data }) {
  // Unwrap IPFS envelope — agent wraps payload in { taskId, agentWallet, content, ... }
  const inner   = data.content || data
  const content = inner.data ? inner : (inner.content || inner)

  // Tweet threads
  if (inner.content_type === 'generated' || inner.content_type === 'tweet_thread') {
    const items = inner.items || (Array.isArray(inner) ? inner : [])
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {items.length} items generated · {inner.generated_at ? ago(inner.generated_at) : ''}
        </div>
        {items.map((item, i) => (
          <div key={i} style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', padding: '12px 16px' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginBottom: 6 }}>#{item.index || i+1}</div>
            <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>{item.text}</div>
          </div>
        ))}
      </div>
    )
  }

  // Data collection (array of records)
  if (inner.content_type === 'json' || (inner.data && Array.isArray(inner.data))) {
    const records = inner.data || (Array.isArray(inner) ? inner : [])
    return (
      <div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {records.length} records · source: {inner.source || 'unknown'}
        </div>
        {records.map((rec, i) => (
          <div key={i} style={{
            background: 'var(--bg3)', border: '1px solid var(--border)',
            borderRadius: 'var(--r)', padding: '10px 14px', marginBottom: 6,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div>
              <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{rec.name || rec.protocol || JSON.stringify(rec).slice(0,50)}</div>
              {rec.category && <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{rec.category}</div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              {rec.tvl_usd != null && (
                <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>
                  ${Number(rec.tvl_usd).toLocaleString()}
                </div>
              )}
              {rec.url && (
                <a href={rec.url} target="_blank" rel="noreferrer"
                  style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--blue)', textDecoration: 'none' }}>↗</a>
              )}
            </div>
          </div>
        ))}
      </div>
    )
  }

  // Code review
  if (inner.issues) {
    return (
      <div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)', marginBottom: 16, lineHeight: 1.6 }}>{inner.summary}</div>
        {inner.issues.length === 0
          ? <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--accent)' }}>No issues found.</div>
          : inner.issues.map((issue, i) => (
          <div key={i} style={{ background: 'var(--bg3)', border: `1px solid ${issue.severity === 'high' ? 'var(--red)' : issue.severity === 'medium' ? 'var(--amber)' : 'var(--border)'}40`, borderRadius: 'var(--r)', padding: '10px 14px', marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
              <span style={pill(issue.severity, issue.severity === 'high' ? 'var(--red)' : issue.severity === 'medium' ? 'var(--amber)' : 'var(--text2)')}>{issue.severity}</span>
              {issue.line && <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>line {issue.line}</span>}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 4 }}>{issue.description}</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)' }}>{issue.recommendation}</div>
          </div>
        ))}
      </div>
    )
  }

  // Fallback: raw JSON
  return (
    <pre style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.6 }}>
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

// ── Bid comparison card ───────────────────────────────────────────────────────
function BidCard({ bid, rank, isWinner, canAccept, loading, onAccept }) {
  const winReason = isWinner ? [
    bid.amount_wei && '↓ lowest bid',
    bid.rep_score_snap >= 80 && '★ high reputation',
    bid.message && '✓ message provided',
  ].filter(Boolean).join(' · ') : null

  return (
    <div style={{
      background: 'var(--bg2)',
      border: `1px solid ${isWinner ? 'var(--accent)' : 'var(--border)'}`,
      borderRadius: 'var(--r2)', padding: '12px 14px',
      position: 'relative', marginBottom: 8,
    }}>
      {/* Rank badge */}
      <div style={{
        position: 'absolute', top: 10, right: 12,
        fontFamily: 'var(--mono)', fontSize: 10, color: isWinner ? 'var(--accent)' : 'var(--text3)',
        fontWeight: 700,
      }}>
        {isWinner ? 'WINNING BID' : `#${rank}`}
      </div>

      {/* Top row: name + amount */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text)', fontWeight: 700 }}>
          {bid.bidder_name || shortAddr(bid.bidder_wallet)}
        </span>
        <span style={pill(bid.status, bid.status === 'winning' ? 'var(--accent)' : bid.status === 'paid' ? 'var(--blue)' : 'var(--text3)')}>
          {bid.status}
        </span>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 20, marginBottom: bid.message ? 10 : 0 }}>
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginBottom: 2 }}>bid amount</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 16, color: 'var(--accent)', fontWeight: 700 }}>{cusd(bid.amount_wei)} CELO</div>
        </div>
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginBottom: 2 }}>rep score</div>
          <div style={{
            fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 700,
            color: bid.rep_score_snap >= 80 ? 'var(--accent)' : bid.rep_score_snap >= 60 ? 'var(--amber)' : 'var(--text2)',
          }}>{bid.rep_score_snap}</div>
        </div>
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginBottom: 2 }}>submitted</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text2)' }}>{ago(bid.created_at)}</div>
        </div>
      </div>

      {/* Pitch message */}
      {bid.message && (
        <div style={{
          background: 'var(--bg3)', border: '1px solid var(--border)',
          borderRadius: 'var(--r)', padding: '8px 12px', marginBottom: 10,
          fontStyle: 'italic', fontSize: 12, color: 'var(--text2)', lineHeight: 1.6,
        }}>
          "{bid.message}"
        </div>
      )}

      {/* Why this agent won */}
      {isWinner && winReason && (
        <div style={{
          background: 'var(--accent)10', border: '1px solid var(--accent)30',
          borderRadius: 'var(--r)', padding: '6px 10px', marginBottom: 10,
          fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--accent)',
        }}>
          Why this bid: {winReason}
        </div>
      )}

      {/* Accept button */}
      {canAccept && bid.status === 'pending' && (
        <button onClick={() => onAccept(bid.id)} disabled={loading}
          style={{ ...btn('var(--accent)', loading), width: '100%', padding: '8px', textAlign: 'center' }}>
          {loading ? 'accepting...' : `accept this bid — ${cusd(bid.amount_wei)} CELO`}
        </button>
      )}
    </div>
  )
}

// ── Task row with expanded panel ──────────────────────────────────────────────
function TaskRow({ task, index, wallet, authHeaders, contract, onRefetch }) {
  const [expanded, setExpanded] = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [msg,      setMsg]      = useState(null)
  const [showResult, setShowResult] = useState(false)
  const [ipfsCid,  setIpfsCid]  = useState('')
  const { bids } = useBids(expanded ? task.id : null)

  // Auto-fill CID from task when in_progress and agent has submitted
  useEffect(() => {
    if (task.ipfs_cid && !ipfsCid) setIpfsCid(task.ipfs_cid)
  }, [task.ipfs_cid])

  const isMyTask  = wallet && task.poster_wallet?.toLowerCase() === wallet.address?.toLowerCase()
  const canAccept = isMyTask && task.status === 'bidding'
  const canSettle = isMyTask && task.status === 'in_progress'
  const hasResult = !!task.ipfs_cid

  // Sort bids: lowest amount first (most competitive), winning bid pinned top
  const sortedBids = [...bids].sort((a, b) => {
    if (a.status === 'winning') return -1
    if (b.status === 'winning') return 1
    return Number(BigInt(a.amount_wei || 0)) - Number(BigInt(b.amount_wei || 0))
  })

  async function acceptBid(bidId) {
    if (!task.chain_task_id) return setMsg({ ok: false, text: 'No on-chain task ID — post tasks via the frontend form to enable on-chain actions.' })
    if (!contract) return setMsg({ ok: false, text: 'Contract not connected — check VITE_CONTRACT_ADDRESS in .env' })

    // Find the bid to get its on-chain bid id
    const bid = bids.find(b => b.id === bidId)
    if (!bid) return setMsg({ ok: false, text: 'Bid not found' })

    setLoading(true); setMsg(null)
    try {
      // Step 1: Find the on-chain bid id by checking contract events
      // We stored chain_bid_id when submitting — fall back to scanning bids
      // For now use bid index position as on-chain bid id (matches submitBid counter)
      setMsg({ ok: true, text: 'Confirm the transaction in MetaMask...' })

      // Get all bid ids for this task from contract to find matching bid
      const taskBids  = await contract.getTaskBids(task.chain_task_id)
      // Find the bid that matches this bidder wallet
      let chainBidId  = null
      for (const cBidId of taskBids) {
        const cBid = await contract.getBid(cBidId)
        if (cBid.bidder.toLowerCase() === bid.bidder_wallet.toLowerCase()) {
          chainBidId = cBidId
          break
        }
      }
      if (!chainBidId) throw new Error('Could not find matching on-chain bid — agent may not have bid on-chain yet')

      // Step 2: Call contract.acceptBid()
      const tx      = await contract.acceptBid(chainBidId)
      setMsg({ ok: true, text: 'Waiting for confirmation...' })
      const receipt = await tx.wait()

      // Step 3: Sync DB
      const headers = await authHeaders()
      const res  = await fetch(`${API_BASE}/bids/${bidId}/accept`, { method: 'POST', headers })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error)

      setMsg({ ok: true, text: `Bid accepted on-chain! Agent will start executing shortly. Tx: ${receipt.hash.slice(0,10)}...` })
      onRefetch()
    } catch (err) {
      if (err.code === 4001) {
        setMsg({ ok: false, text: 'Transaction rejected in MetaMask.' })
      } else {
        setMsg({ ok: false, text: err.message })
      }
    } finally { setLoading(false) }
  }

  async function settle() {
    if (!ipfsCid) return setMsg({ ok: false, text: 'No IPFS CID yet — wait for agent to submit deliverable' })
    const winningBid = bids.find(b => b.status === 'winning')
    if (!winningBid) return setMsg({ ok: false, text: 'No winning bid found' })
    if (!task.chain_task_id) return setMsg({ ok: false, text: 'No on-chain task ID — was this task posted via the frontend form?' })
    if (!contract) return setMsg({ ok: false, text: 'Contract not connected — check VITE_CONTRACT_ADDRESS in .env' })

    setLoading(true); setMsg(null)
    try {
      // Step 1: Call TaskMarket.sol::settleTask() — this does the real 80/20 split on-chain
      setMsg({ ok: true, text: 'Confirm the transaction in MetaMask...' })
      const tx      = await contract.settleTask(task.chain_task_id, ipfsCid)
      setMsg({ ok: true, text: 'Transaction submitted — waiting for confirmation...' })
      const receipt = await tx.wait()

      // Step 2: Sync DB state
      const headers = await authHeaders()
      const res  = await fetch(`${API_BASE}/tasks/${task.id}/settle`, {
        method: 'PATCH', headers,
        body: JSON.stringify({
          ipfs_cid:        ipfsCid,
          winning_bid_id:  winningBid.id,
          tx_hash:         receipt.hash,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error)

      setMsg({ ok: true, text: `Settled on-chain! ${(parseFloat(cusd(task.budget_wei)) * 0.8).toFixed(4)} CELO to agent · 20% to you. Tx: ${receipt.hash.slice(0,10)}...` })
      onRefetch()
    } catch (err) {
      if (err.code === 4001) {
        setMsg({ ok: false, text: 'Transaction rejected in MetaMask.' })
      } else {
        setMsg({ ok: false, text: err.message })
      }
    } finally { setLoading(false) }
  }

  const rowBg = index % 2 === 0 ? 'var(--bg)' : 'var(--bg2)'

  return (
    <div style={{ borderBottom: '1px solid var(--border)', background: rowBg, transition: 'background 0.1s' }}>

      {/* Main row */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ display: 'grid', gridTemplateColumns: '2fr 110px 90px 80px 70px 80px 80px', padding: '12px 16px', alignItems: 'center', gap: 4, cursor: 'pointer' }}
        onMouseEnter={e => e.currentTarget.parentElement.style.background = 'var(--bg3)'}
        onMouseLeave={e => e.currentTarget.parentElement.style.background = rowBg}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'var(--text)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</span>
            {isMyTask && <span style={pill('yours', 'var(--accent)')}>yours</span>}
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
            {shortAddr(task.poster_wallet)} · {ago(task.created_at)}
            {(canAccept || canSettle) && <span style={{ color: 'var(--amber)', marginLeft: 8 }}>· action needed ↓</span>}
          </div>
        </div>
        <div><span style={pill(task.category.replace('_',' '), CATEGORY_COLORS[task.category] || '#888')}>{task.category.replace('_',' ')}</span></div>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>{cusd(task.budget_wei)} CELO</span>
        <div><span style={pill(task.status, STATUS_COLORS[task.status] || '#888')}>{task.status.replace('_',' ')}</span></div>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: task.bid_count > 0 ? 'var(--text)' : 'var(--text3)' }}>
          {task.bid_count > 0 ? task.bid_count : '—'}
        </span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: timeLeft(task.deadline) === 'expired' ? 'var(--red)' : 'var(--text2)' }}>
          {timeLeft(task.deadline)}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          {task.tx_hash
            ? <a href={`${EXPLORER}/tx/${task.tx_hash}`} target="_blank" rel="noreferrer"
                onClick={e => e.stopPropagation()}
                style={{ color: 'var(--blue)', fontFamily: 'var(--mono)', fontSize: 10, textDecoration: 'none' }}>↗ tx</a>
            : <span style={{ color: 'var(--text3)', fontFamily: 'var(--mono)', fontSize: 10 }}>—</span>
          }
          {hasResult && (
            <button onClick={e => { e.stopPropagation(); setShowResult(true) }}
              style={{ ...btn('var(--blue)'), padding: '2px 8px', fontSize: 9 }}>
              view result
            </button>
          )}
        </div>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div style={{ padding: '16px', borderTop: '1px solid var(--border)', background: 'var(--bg3)', animation: 'slide-in 0.15s ease' }}>

          {/* Bid comparison */}
          {sortedBids.length > 0 ? (
            <div style={{ marginBottom: canSettle ? 16 : 0 }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                {sortedBids.length} bid{sortedBids.length > 1 ? 's' : ''} — sorted by competitiveness
              </div>
              {sortedBids.map((bid, i) => (
                <BidCard
                  key={bid.id}
                  bid={bid}
                  rank={i + 1}
                  isWinner={bid.status === 'winning' || bid.status === 'paid'}
                  canAccept={canAccept}
                  loading={loading}
                  onAccept={acceptBid}
                />
              ))}
            </div>
          ) : (
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', marginBottom: canSettle ? 16 : 0 }}>
              No bids yet — agent polls every 5 minutes.
            </div>
          )}

          {/* Settle panel */}
          {canSettle && (
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--amber)30', borderRadius: 'var(--r2)', padding: '14px' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                {task.ipfs_cid ? 'Deliverable ready — release payment' : 'Waiting for agent to submit deliverable...'}
              </div>

              {task.ipfs_cid ? (
                <>
                  {/* CID preview */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '6px 10px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {task.ipfs_cid}
                    </div>
                    <button onClick={() => setShowResult(true)} style={btn('var(--blue)')}>
                      preview
                    </button>
                  </div>

                  {/* Payment breakdown */}
                  <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
                    {[
                      { label: 'budget', val: `${cusd(task.budget_wei)} CELO`, color: 'var(--text)' },
                      { label: 'agent gets (80%)', val: `${(parseFloat(cusd(task.budget_wei)) * 0.8).toFixed(4)} CELO`, color: 'var(--accent)' },
                      { label: 'you get (20%)', val: `${(parseFloat(cusd(task.budget_wei)) * 0.2).toFixed(4)} CELO`, color: 'var(--amber)' },
                    ].map(s => (
                      <div key={s.label}>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginBottom: 2 }}>{s.label}</div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: s.color, fontWeight: 700 }}>{s.val}</div>
                      </div>
                    ))}
                  </div>

                  <button onClick={settle} disabled={loading}
                    style={{ ...btn('var(--amber)', loading), width: '100%', padding: '10px', textAlign: 'center', fontSize: 11 }}>
                    {loading ? 'settling...' : 'confirm & release payment →'}
                  </button>
                </>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--amber)', animation: 'pulse-dot 1.5s infinite', flexShrink: 0 }} />
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>
                    Agent is executing the task. CID will appear here automatically when done.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Completed state */}
          {task.status === 'completed' && task.ipfs_cid && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--accent)' }}>Task complete.</span>
              <button onClick={() => setShowResult(true)} style={btn('var(--blue)')}>view deliverable</button>
              <a href={`${EXPLORER}/tx/${task.tx_hash}`} target="_blank" rel="noreferrer"
                style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--blue)', textDecoration: 'none' }}>
                ↗ payment tx
              </a>
            </div>
          )}

          {/* Message */}
          {msg && (
            <div style={{
              marginTop: 12, padding: '8px 12px', borderRadius: 'var(--r)',
              background: msg.ok ? 'var(--accent)18' : 'var(--red)18',
              border: `1px solid ${msg.ok ? 'var(--accent)' : 'var(--red)'}40`,
              fontFamily: 'var(--mono)', fontSize: 11,
              color: msg.ok ? 'var(--accent)' : 'var(--red)',
            }}>
              {msg.text}
            </div>
          )}
        </div>
      )}

      {/* Result modal */}
      {showResult && task.ipfs_cid && (
        <ResultModal cid={task.ipfs_cid} title={task.title} onClose={() => setShowResult(false)} />
      )}
    </div>
  )
}

// ── Main TaskFeed ─────────────────────────────────────────────────────────────
export default function TaskFeed() {
  const [filter,   setFilter]  = useState('all')
  const [showPost, setShowPost] = useState(false)
  const { tasks, loading, refetch } = useTasks(filter)
  const { wallet, authHeaders }     = useWallet()
  const contract                    = useContract(wallet?.signer)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Filter bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg2)', alignItems: 'center' }}>
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            background: filter === f ? 'var(--bg3)' : 'transparent',
            borderRight: '1px solid var(--border)', borderTop: 'none', borderLeft: 'none',
            borderBottom: filter === f ? '2px solid var(--accent)' : '2px solid transparent',
            color: filter === f ? 'var(--accent)' : 'var(--text2)',
            fontFamily: 'var(--mono)', fontSize: 10, textTransform: 'uppercase',
            letterSpacing: '0.08em', padding: '10px 16px', transition: 'all 0.1s',
          }}>
            {f.replace('_',' ')}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px' }}>
          {loading && <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--amber)', animation: 'pulse-dot 1s infinite' }} />}
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
            {tasks.length} tasks · click row to expand
          </span>
          <button onClick={() => setShowPost(true)} style={{
            background: wallet ? 'var(--accent)' : 'var(--bg3)',
            border: wallet ? 'none' : '1px solid var(--border2)',
            color: wallet ? '#000' : 'var(--text3)',
            fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700,
            padding: '5px 14px', borderRadius: 'var(--r)', letterSpacing: '0.06em',
          }}>
            {wallet ? '+ post task' : 'connect to post'}
          </button>
        </div>
      </div>

      {/* Column headers */}
      <div style={{
        display: 'grid', gridTemplateColumns: '2fr 110px 90px 80px 70px 80px 80px',
        padding: '8px 16px', borderBottom: '1px solid var(--border)',
        fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)',
        textTransform: 'uppercase', letterSpacing: '0.08em', background: 'var(--bg)',
      }}>
        <span>Task</span><span>Category</span><span>Budget</span>
        <span>Status</span><span>Bids</span><span>Deadline</span><span>Actions</span>
      </div>

      {/* Rows */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {tasks.length === 0 && !loading && (
          <div style={{ padding: 40, textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text3)' }}>
            No tasks found. {wallet ? 'Post the first one!' : 'Connect wallet to post a task.'}
          </div>
        )}
        {tasks.map((t, i) => (
          <TaskRow key={t.id} task={t} index={i} wallet={wallet} authHeaders={authHeaders} contract={contract} onRefetch={refetch} />
        ))}
      </div>

      {showPost && <PostTask onClose={() => setShowPost(false)} onSuccess={refetch} />}
    </div>
  )
}