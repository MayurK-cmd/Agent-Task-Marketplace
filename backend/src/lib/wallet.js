import { ethers } from 'ethers'

/**
 * Verifies an EIP-191 personal_sign signature.
 *
 * How clients sign:
 *   const message = `AgentMarket:${nonce}:${Date.now()}`
 *   const sig = await signer.signMessage(message)
 *   // send: { wallet, message, signature }
 *
 * The server checks that the recovered address matches `wallet`.
 */
export function verifyWalletSignature(wallet, message, signature) {
  try {
    const recovered = ethers.verifyMessage(message, signature)
    return recovered.toLowerCase() === wallet.toLowerCase()
  } catch {
    return false
  }
}

/**
 * Extracts timestamp from message and rejects if older than 5 minutes.
 * Message format: "AgentMarket:<nonce>:<timestamp>"
 */
export function isSignatureTimely(message, maxAgeMs = 5 * 60 * 1000) {
  const parts = message.split(':')
  if (parts.length < 3) return false
  const ts = parseInt(parts[2], 10)
  if (isNaN(ts)) return false
  return Date.now() - ts < maxAgeMs
}

export default { verifyWalletSignature, isSignatureTimely }