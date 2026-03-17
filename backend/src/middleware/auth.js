import { verifyWalletSignature, isSignatureTimely } from '../lib/wallet.js'

/**
 * Middleware: requireWalletAuth
 *
 * Expects these headers on the request:
 *   x-wallet-address   : 0x...  (Celo address)
 *   x-wallet-message   : "AgentMarket:<nonce>:<timestamp>"
 *   x-wallet-signature : 0x...  (EIP-191 sig)
 *
 * On success: attaches req.wallet = checksummed address
 * On failure: 401
 */
export function requireWalletAuth(req, res, next) {
  const wallet    = req.headers['x-wallet-address']
  const message   = req.headers['x-wallet-message']
  const signature = req.headers['x-wallet-signature']

  if (!wallet || !message || !signature) {
    return res.status(401).json({
      error: 'Missing auth headers: x-wallet-address, x-wallet-message, x-wallet-signature',
    })
  }

  if (!isSignatureTimely(message)) {
    return res.status(401).json({ error: 'Signature expired (> 5 minutes old)' })
  }

  if (!verifyWalletSignature(wallet, message, signature)) {
    return res.status(401).json({ error: 'Invalid wallet signature' })
  }

  req.wallet = wallet.toLowerCase()
  next()
}

/**
 * Middleware: optionalWalletAuth
 * Same as above but doesn't block — just attaches req.wallet if present.
 * Used for public GET endpoints where auth enriches the response.
 */
export function optionalWalletAuth(req, res, next) {
  const wallet    = req.headers['x-wallet-address']
  const message   = req.headers['x-wallet-message']
  const signature = req.headers['x-wallet-signature']

  if (wallet && message && signature) {
    if (isSignatureTimely(message) && verifyWalletSignature(wallet, message, signature)) {
      req.wallet = wallet.toLowerCase()
    }
  }
  next()
}

export default { requireWalletAuth, optionalWalletAuth }

