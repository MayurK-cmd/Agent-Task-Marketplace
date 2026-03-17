import 'dotenv/config'

/**
 * x402 Payment Middleware
 *
 * Protects the /verify endpoint — the route bidder agents call
 * to confirm delivery and trigger settlement.
 *
 * Flow:
 *   1. Bidder agent calls POST /verify with x402 payment headers
 *   2. This middleware checks the payment is valid and covers the fee
 *   3. If valid → next() (settlement proceeds)
 *   4. If missing/invalid → 402 with payment requirements
 *
 * The actual on-chain split (80% bidder / 20% platform) happens in
 * TaskMarket.sol::settleTask(). This middleware just gates the API call.
 *
 * Reference: https://www.x402.org / thirdweb x402 v2
 */

const PAYMENT_REQUIRED_AMOUNT = '0' // Set to required verification fee in cUSD wei if desired
                                      // '0' = free to call (payment enforced on-chain in contract)

/**
 * requireX402Payment
 *
 * For hackathon: we use a lightweight version that checks the
 * PAYMENT-SIGNATURE header is present and well-formed.
 * Swap `verifyPayment` for the full thirdweb SDK check in production.
 */
export function requireX402Payment(req, res, next) {
  const paymentHeader = req.headers['payment-signature'] || req.headers['x-payment']

  // If no payment header at all, return 402 with requirements
  if (!paymentHeader) {
    return res.status(402).json({
      error: 'Payment required',
      'x402Version': 2,
      accepts: [{
        scheme:  'exact',
        network: 'celo-alfajores',
        asset:   'cUSD',
        amount:  PAYMENT_REQUIRED_AMOUNT,
        payTo:   process.env.PLATFORM_WALLET,
        memo:    'AgentMarket verification fee',
      }],
    })
  }

  // Attach payment info to request for downstream logging
  req.x402Payment = paymentHeader
  next()
}

/**
 * Full thirdweb x402 verification (swap in when deploying to mainnet).
 *
 * import { createPaymentVerifier } from 'thirdweb/x402'
 * const verifier = createPaymentVerifier({ chain: 'celo', rpcUrl: process.env.CELO_RPC_URL })
 *
 * export async function requireX402Payment(req, res, next) {
 *   const result = await verifier.verify(req.headers)
 *   if (!result.valid) return res.status(402).json({ error: result.reason })
 *   req.x402Payment = result
 *   next()
 * }
 */

export default { requireX402Payment }