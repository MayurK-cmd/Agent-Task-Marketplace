import 'dotenv/config'

const PINATA_API = 'https://api.pinata.cloud'

/**
 * Upload a JSON deliverable to IPFS via Pinata.
 * Returns the IPFS CID.
 */
export async function uploadJSON(data, name = 'deliverable') {
  const res = await fetch(`${PINATA_API}/pinning/pinJSONToIPFS`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.PINATA_JWT}`,
    },
    body: JSON.stringify({
      pinataContent: data,
      pinataMetadata: { name },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Pinata upload failed: ${err}`)
  }

  const json = await res.json()
  return json.IpfsHash  // the CID
}

/**
 * Upload raw text content (e.g. scraped data, generated copy).
 * Wraps it in a standard deliverable envelope.
 */
export async function uploadDeliverable({ taskId, content, contentType, agentWallet }) {
  return uploadJSON({
    taskId,
    agentWallet,
    contentType,   // 'text' | 'json' | 'markdown' | 'code'
    content,
    submittedAt: new Date().toISOString(),
  }, `task-${taskId}-deliverable`)
}

/**
 * Returns a public gateway URL for a CID.
 */
export function gatewayUrl(cid) {
  return `${process.env.PINATA_GATEWAY}/ipfs/${cid}`
}

export default { uploadJSON, uploadDeliverable, gatewayUrl }