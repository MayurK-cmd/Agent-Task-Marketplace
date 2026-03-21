/**
 * AgentMarket Bidder Agent Runner
 * Run: node agent.js
 */

import { ethers }  from 'ethers'
import 'dotenv/config'
// Keep Render happy with a health check port
import http from 'http'


const CONFIG = {
  api:           process.env.MARKETPLACE_API || 'http://localhost:3001',
  privateKey:    process.env.AGENT_PRIVATE_KEY,
  specialties:   (process.env.AGENT_SPECIALTIES || 'data_collection,content_gen').split(','),
  pollInterval:  parseInt(process.env.POLL_INTERVAL_MINUTES || '5') * 60 * 1000,
  bidDiscount:   parseFloat(process.env.BID_DISCOUNT_PERCENT || '10') / 100,
  minBudgetCusd: parseFloat(process.env.MIN_BUDGET_CUSD || '0.5'),
  maxBudgetCusd: parseFloat(process.env.MAX_BUDGET_CUSD || '10'),
  maxActiveBids: parseInt(process.env.MAX_ACTIVE_BIDS || '3'),
  retryDelaySec: 90,
  maxRetries:    2,
}

if (!CONFIG.privateKey) { console.error('AGENT_PRIVATE_KEY not set'); process.exit(1) }

const provider = new ethers.JsonRpcProvider(
  process.env.CELO_RPC_URL || 'https://forno.celo-sepolia.celo-testnet.org'
)
const wallet = new ethers.Wallet(CONFIG.privateKey, provider)

console.log(`\n╔══════════════════════════════════════════╗`)
console.log(`║   AgentMarket Bidder Agent               ║`)
console.log(`║   OpenClaw-compatible runner             ║`)
console.log(`╚══════════════════════════════════════════╝\n`)
console.log(`🤖 Agent wallet: ${wallet.address}`)
console.log(`📡 API: ${CONFIG.api}`)
console.log(`🎯 Specialties: ${CONFIG.specialties.join(', ')}`)
console.log(`🔁 Retry: ${CONFIG.maxRetries}x after ${CONFIG.retryDelaySec}s\n`)

const activeBids = new Map()
const inProgress = new Map()

async function authHeaders() {
  const message   = `AgentMarket:${crypto.randomUUID()}:${Date.now()}`
  const signature = await wallet.signMessage(message)
  return {
    'Content-Type':        'application/json',
    'x-wallet-address':    wallet.address,
    'x-wallet-message':    message,
    'x-wallet-signature':  signature,
  }
}

async function apiGet(path) {
  const res  = await fetch(`${CONFIG.api}${path}`)
  const body = await res.json()
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${JSON.stringify(body)}`)
  return body
}

async function apiPost(path, data) {
  const headers = await authHeaders()
  const res = await fetch(`${CONFIG.api}${path}`, {
    method: 'POST', headers, body: JSON.stringify(data),
  })
  const body = await res.json()
  return { status: res.status, body }
}

function getContract() {
  if (!process.env.CONTRACT_ADDRESS) return null
  return new ethers.Contract(process.env.CONTRACT_ADDRESS, [
    'function submitBid(uint256 taskId,uint256 amount,string message) returns (uint256)',
    'function getBid(uint256 bidId) view returns (tuple(uint256 id,uint256 taskId,address bidder,uint256 amount,uint8 status,string message))',
    'function getTaskBids(uint256 taskId) view returns (uint256[])',
  ], wallet)
}

// ── Gemini 2.5 Flash ──────────────────────────────────────────────────────────
async function callGemini(systemPrompt, userPrompt) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set in .env')
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents:           [{ parts: [{ text: userPrompt }] }],
      generationConfig:   { temperature: 0.7, maxOutputTokens: 2000 },
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini API error ${res.status}: ${err}`)
  }
  const data = await res.json()
  // Strip markdown fences if Gemini wraps response in ```json ... ```
  const raw = data.candidates[0].content.parts[0].text
  return raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
}

// ── Poll tasks ────────────────────────────────────────────────────────────────
async function pollTasks() {
  log('poll', 'Checking for open tasks...')
  const { tasks } = await apiGet('/tasks?status=open')
  if (!tasks.length) { log('poll', 'No open tasks'); return }

  const eligible = tasks.filter(t => {
    if (!CONFIG.specialties.includes(t.category))  return false
    if (activeBids.has(t.id))                       return false
    if (activeBids.size >= CONFIG.maxActiveBids)    return false
    if (new Date(t.deadline) < new Date())          return false
    const b = Number(BigInt(t.budget_wei)) / 1e18
    return b >= CONFIG.minBudgetCusd && b <= CONFIG.maxBudgetCusd
  })

  if (!eligible.length) { log('poll', 'No eligible tasks after filtering'); return }

  const best = eligible
    .map(t => ({ task: t, score: (Number(BigInt(t.budget_wei)) / 1e18) - (t.bid_count * 0.1) }))
    .sort((a, b) => b.score - a.score)[0].task

  log('poll', `Best task: "${best.title}" (${(Number(BigInt(best.budget_wei))/1e18).toFixed(2)} CELO)`)
  await submitBid(best)
}

// ── Submit bid ────────────────────────────────────────────────────────────────
async function submitBid(task) {
  const budgetWei    = BigInt(task.budget_wei)
  const discountBps  = BigInt(Math.floor(CONFIG.bidDiscount * 10000))
  const bidAmountWei = budgetWei - (budgetWei * discountBps / 10000n)
  const messages = {
    data_collection: `I specialise in structured data extraction on Celo. Clean JSON delivery within 30 minutes.`,
    content_gen:     `I generate high-quality Web3 content for the Celo ecosystem. Delivery within 20 minutes.`,
    code_review:     `Senior Solidity auditor. Vulnerabilities, gas issues, and logic errors. Delivery within 1 hour.`,
    defi_ops:        `Celo DeFi analyst. Verified structured report within 15 minutes.`,
  }
  const message = messages[task.category] || 'Ready to complete this task efficiently.'

  log('bid', `Bidding ${(Number(bidAmountWei)/1e18).toFixed(4)} CELO on "${task.title}"`)

  let txHash = null
  if (task.chain_task_id) {
    try {
      const contract = getContract()
      if (contract) {
        log('bid', `On-chain bid for chain task #${task.chain_task_id}...`)
        const tx      = await contract.submitBid(task.chain_task_id, bidAmountWei, message)
        const receipt = await tx.wait()
        txHash = receipt.hash
        log('bid', `On-chain tx: ${txHash}`)
      }
    } catch (err) {
      log('bid', `On-chain bid failed: ${err.message} — API-only bid`)
    }
  }

  const { status, body } = await apiPost('/bids', {
    task_id: task.id, amount_wei: bidAmountWei.toString(), message, tx_hash: txHash,
  })

  if (status === 201) {
    activeBids.set(task.id, body.bid.id)
    log('bid', `✅ Bid submitted: ${body.bid.id}`)
    pollForAcceptance(task.id, body.bid.id)
  } else if (status === 403) {
    log('bid', `⛔ Rep too low (required: ${body.required}, mine: ${body.actual})`)
  } else if (status === 409) {
    log('bid', `Already bid on this task`)
  } else {
    log('bid', `❌ Bid rejected (${status}): ${body.error}`)
  }
}

function pollForAcceptance(taskId, bidId) {
  const interval = setInterval(async () => {
    try {
      const { task } = await apiGet(`/tasks/${taskId}`)
      if (task.status === 'in_progress' && task.winning_bid_id === bidId) {
        clearInterval(interval)
        activeBids.delete(taskId)
        inProgress.set(taskId, task)
        log('accept', `🎉 Bid accepted for "${task.title}" — starting execution`)
        await executeTask(task)
      }
      if (['completed', 'expired', 'disputed'].includes(task.status)) {
        clearInterval(interval)
        activeBids.delete(taskId)
      }
    } catch (err) {
      log('accept', `Error polling task ${taskId}: ${err.message}`)
    }
  }, 2 * 60 * 1000)
}

// ── Execute task with retry ───────────────────────────────────────────────────
async function executeTask(task, attempt = 1) {
  log('execute', `Starting: "${task.title}" [${task.category}] (attempt ${attempt}/${CONFIG.maxRetries})`)
  try {
    let deliverable
    switch (task.category) {
      case 'data_collection': deliverable = await executeDataCollection(task); break
      case 'content_gen':     deliverable = await executeContentGen(task);     break
      case 'code_review':     deliverable = await executeCodeReview(task);     break
      case 'defi_ops':        deliverable = await executeDefiOps(task);        break
      default: throw new Error(`Unknown category: ${task.category}`)
    }
    log('execute', `✅ Work complete — submitting deliverable`)
    await submitWork(task, deliverable)
  } catch (err) {
    log('execute', `❌ Failed (attempt ${attempt}): ${err.message}`)
    if (attempt < CONFIG.maxRetries) {
      log('execute', `⏳ Retrying in ${CONFIG.retryDelaySec}s...`)
      setTimeout(() => executeTask(task, attempt + 1), CONFIG.retryDelaySec * 1000)
    } else {
      log('execute', `🚫 Max retries reached for task ${task.id} — giving up`)
      inProgress.delete(task.id)
    }
  }
}

// ── Data collection ───────────────────────────────────────────────────────────
async function executeDataCollection(task) {
  log('execute', 'Fetching Celo DeFi data from DeFiLlama...')
  const res       = await fetch('https://api.llama.fi/protocols')
  const protocols = await res.json()
  const data = protocols
    .filter(p => (p.chains || []).some(c => c.toLowerCase() === 'celo') && (p.chainTvls?.Celo || 0) > 1000)
    .sort((a, b) => (b.chainTvls?.Celo || 0) - (a.chainTvls?.Celo || 0))
    .slice(0, 20)
    .map(p => ({
      name:          p.name,
      symbol:        p.symbol,
      tvl_usd_celo:  p.chainTvls?.Celo || 0,
      tvl_usd_total: p.tvl,
      category:      p.category,
      url:           p.url,
    }))
  return { task_id: task.id, collected_at: new Date().toISOString(), source: 'DeFiLlama — Celo chain only', record_count: data.length, data }
}

// ── Content generation ────────────────────────────────────────────────────────
async function executeContentGen(task) {
  log('execute', 'Calling Gemini 2.5 Flash for content generation...')
  const raw = await callGemini(
    `You are a professional Web3 content writer. Always respond with valid JSON only — no markdown, no preamble.`,
    `Task: ${task.title}
Description: ${task.description || task.title}

Generate the requested content. Return this exact JSON:
{
  "content_type": "generated",
  "items": [{ "index": 1, "text": "..." }],
  "word_count": 0
}
Each item is one piece of content. Base on real Celo facts. Return ONLY valid JSON.`
  )
  const parsed = JSON.parse(raw)
  return { task_id: task.id, generated_at: new Date().toISOString(), content_type: 'generated', prompt_used: task.title, items: parsed.items || [], word_count: parsed.word_count || 0 }
}

// ── Code review ───────────────────────────────────────────────────────────────
async function executeCodeReview(task) {
  log('execute', 'Calling Gemini 2.5 Flash for code review...')
  const raw = await callGemini(
    `You are a senior Solidity security auditor. Always respond with valid JSON only — no markdown, no preamble.`,
    `Task: ${task.title}
Description: ${task.description || task.title}

Return this exact JSON:
{
  "issues": [{ "severity": "high|medium|low|info", "line": null, "description": "...", "recommendation": "..." }],
  "summary": "2-3 sentence assessment"
}
Return ONLY valid JSON.`
  )
  const parsed = JSON.parse(raw)
  return { task_id: task.id, reviewed_at: new Date().toISOString(), file_reviewed: task.description || task.title, issues: parsed.issues || [], summary: parsed.summary || 'Review complete.' }
}

// ── DeFi ops ──────────────────────────────────────────────────────────────────
async function executeDefiOps(task) {
  log('execute', 'Calling Gemini 2.5 Flash for DeFi analysis...')
  const raw = await callGemini(
    `You are a Celo DeFi analyst. Always respond with valid JSON only — no markdown, no preamble.`,
    `Task: ${task.title}
Description: ${task.description || task.title}

Return this exact JSON:
{
  "operation": "analysis",
  "result": {},
  "alert": false,
  "alert_reason": null,
  "summary": "2-3 sentence summary"
}
Return ONLY valid JSON.`
  )
  const parsed = JSON.parse(raw)
  return { task_id: task.id, checked_at: new Date().toISOString(), operation: parsed.operation || 'analysis', result: parsed.result || {}, alert: parsed.alert || false, alert_reason: parsed.alert_reason || null, summary: parsed.summary || '' }
}

// ── Submit work ───────────────────────────────────────────────────────────────
async function submitWork(task, deliverable) {
  log('submit', `Uploading deliverable for task ${task.id}...`)
  const headers        = await authHeaders()
  headers['x-payment'] = 'testnet-bypass'
  const res  = await fetch(`${CONFIG.api}/verify`, {
    method: 'POST', headers,
    body: JSON.stringify({ task_id: task.id, content: deliverable, content_type: 'json' }),
  })
  const body = await res.json()
  if (res.ok) {
    log('submit', `✅ Deliverable uploaded — CID: ${body.cid}`)
    log('submit', `🔗 ${body.gateway_url}`)
    log('submit', `💰 Awaiting poster settlement...`)
    inProgress.delete(task.id)
    pollForPayment(task.id)
  } else {
    throw new Error(`Upload failed (${res.status}): ${body.error}`)
  }
}

function pollForPayment(taskId) {
  let attempts = 0
  const interval = setInterval(async () => {
    attempts++
    try {
      const { task } = await apiGet(`/tasks/${taskId}`)
      if (task.status === 'completed') { clearInterval(interval); log('payment', `💸 Payment received for task ${taskId}!`) }
      if (attempts > 288) { clearInterval(interval); log('payment', `⚠️  Task ${taskId} not settled after 24h`) }
    } catch (err) { log('payment', `Error: ${err.message}`) }
  }, 5 * 60 * 1000)
}

function log(skill, message) {
  console.log(`[${new Date().toISOString().slice(11,19)}] [${skill.padEnd(8)}] ${message}`)
}

async function main() {
  try {
    const headers = await authHeaders()
    await fetch(`${CONFIG.api}/agents/me`, {
      method: 'PUT', headers,
      body: JSON.stringify({ name: process.env.AGENT_NAME || 'BidderAgent-1', specialty: CONFIG.specialties[0] }),
    })
    log('init', `Registered agent profile`)
  } catch (err) {
    log('init', `Could not register profile: ${err.message}`)
  }

  await pollTasks().catch(err => log('poll', `Error: ${err.message}`))
  setInterval(async () => {
    await pollTasks().catch(err => log('poll', `Error: ${err.message}`))
  }, CONFIG.pollInterval)

  log('init', `Running. Poll: ${CONFIG.pollInterval/60000}m · Retry: ${CONFIG.maxRetries}x after ${CONFIG.retryDelaySec}s`)
  log('init', `Press Ctrl+C to stop.\n`)
}

http.createServer((_, res) => res.end('ok')).listen(process.env.PORT || 3000)
main()