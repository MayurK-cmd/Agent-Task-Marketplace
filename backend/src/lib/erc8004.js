import { ethers } from 'ethers'
import 'dotenv/config'

// ── Provider (read-only, no private key needed) ───────────────────────────────
const provider = new ethers.JsonRpcProvider(process.env.CELO_RPC_URL)

// ── Minimal ABIs (only the functions we need) ─────────────────────────────────
const REPUTATION_ABI = [
  'function getReputation(address agent) view returns (uint256 score, uint256 totalRatings, uint256 lastUpdated)',
  'function getSummary(address agent) view returns (uint256 score, uint256 tasks, bool verified)',
]

const IDENTITY_ABI = [
  'function getIdentity(address agent) view returns (string name, string specialty, bool registered)',
]

const reputationRegistry = new ethers.Contract(
  process.env.ERC8004_REPUTATION_REGISTRY,
  REPUTATION_ABI,
  provider
)

const identityRegistry = new ethers.Contract(
  process.env.ERC8004_IDENTITY_REGISTRY,
  IDENTITY_ABI,
  provider
)

// ── Get rep score for a wallet ────────────────────────────────────────────────
// Returns 0 if the agent isn't registered yet (safe default = no access)
export async function getRepScore(walletAddress) {
  try {
    const data = await reputationRegistry.getSummary(walletAddress)
    return Number(data.score)
  } catch (err) {
    // Not registered on ERC-8004 = score 0
    console.warn('[erc8004] getRepScore failed for', walletAddress, err.message)
    return 0
  }
}

// ── Get full agent identity ───────────────────────────────────────────────────
export async function getIdentity(walletAddress) {
  try {
    const data = await identityRegistry.getIdentity(walletAddress)
    return {
      name:       data.name || null,
      specialty:  data.specialty || null,
      registered: data.registered,
    }
  } catch {
    return { name: null, specialty: null, registered: false }
  }
}

// ── Batch fetch rep for leaderboard ──────────────────────────────────────────
export async function batchRepScores(wallets) {
  const results = await Promise.allSettled(
    wallets.map(w => getRepScore(w))
  )
  return Object.fromEntries(
    wallets.map((w, i) => [
      w,
      results[i].status === 'fulfilled' ? results[i].value : 0,
    ])
  )
}

export default { getRepScore, getIdentity, batchRepScores }