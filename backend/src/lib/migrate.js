/**
 * Run with: npm run migrate
 * Creates all tables fresh. Safe to re-run (uses IF NOT EXISTS).
 */
import { pool } from './db.js'
import 'dotenv/config'

const SCHEMA = `

-- ── Agents ────────────────────────────────────────────────────────────────────
-- Registered agents (both posters and bidders).
-- rep_score is cached from ERC-8004 and refreshed on each interaction.
CREATE TABLE IF NOT EXISTS agents (
  id            SERIAL PRIMARY KEY,
  wallet        VARCHAR(42)  NOT NULL UNIQUE,   -- checksummed Celo address
  name          VARCHAR(100),                   -- optional display name
  specialty     VARCHAR(50),                    -- data_collection | code_review | content_gen | defi_ops
  rep_score     INTEGER      NOT NULL DEFAULT 0,
  tasks_done    INTEGER      NOT NULL DEFAULT 0,
  total_earned  BIGINT       NOT NULL DEFAULT 0, -- in cUSD wei
  is_online     BOOLEAN      NOT NULL DEFAULT FALSE,
  last_seen     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Tasks ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  title           VARCHAR(200) NOT NULL,
  description     TEXT,
  category        VARCHAR(50)  NOT NULL,         -- matches agent specialty values
  budget_wei      BIGINT       NOT NULL,          -- cUSD in wei (18 decimals)
  deadline        TIMESTAMPTZ  NOT NULL,
  min_rep_score   INTEGER      NOT NULL DEFAULT 0,-- ERC-8004 gate
  poster_wallet   VARCHAR(42)  NOT NULL,
  status          VARCHAR(20)  NOT NULL DEFAULT 'open',
    -- open | bidding | in_progress | completed | disputed | expired
  winning_bid_id  UUID,
  chain_task_id   INTEGER,                        -- on-chain task index in TaskMarket.sol
  tx_hash         VARCHAR(66),                    -- postTask() tx
  ipfs_cid        VARCHAR(100),                   -- deliverable CID (set on completion)
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Bids ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bids (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID         NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  bidder_wallet   VARCHAR(42)  NOT NULL,
  amount_wei      BIGINT       NOT NULL,           -- bid amount in cUSD wei
  rep_score_snap  INTEGER      NOT NULL DEFAULT 0, -- rep at time of bid (snapshot)
  message         TEXT,                            -- optional pitch from bidder agent
  status          VARCHAR(20)  NOT NULL DEFAULT 'pending',
    -- pending | winning | outbid | paid | rejected
  tx_hash         VARCHAR(66),                     -- submitBid() tx
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Transactions (event log) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  type        VARCHAR(30)  NOT NULL,
    -- task_posted | bid_submitted | task_settled | ipfs_submitted | dispute_raised
  task_id     UUID         REFERENCES tasks(id),
  bid_id      UUID         REFERENCES bids(id),
  from_wallet VARCHAR(42),
  to_wallet   VARCHAR(42),
  amount_wei  BIGINT,
  tx_hash     VARCHAR(66),
  meta        JSONB,                               -- any extra data
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Indices ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tasks_status      ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_category    ON tasks(category);
CREATE INDEX IF NOT EXISTS idx_tasks_poster      ON tasks(poster_wallet);
CREATE INDEX IF NOT EXISTS idx_bids_task         ON bids(task_id);
CREATE INDEX IF NOT EXISTS idx_bids_bidder       ON bids(bidder_wallet);
CREATE INDEX IF NOT EXISTS idx_txns_task         ON transactions(task_id);
CREATE INDEX IF NOT EXISTS idx_txns_created      ON transactions(created_at DESC);

-- Auto-update updated_at on tasks
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_updated_at ON tasks;
CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
`

async function migrate() {
  console.log('🗄️  Running migrations...')
  const client = await pool.connect()
  try {
    await client.query(SCHEMA)
    console.log('✅  Schema up to date')
  } catch (err) {
    console.error('❌  Migration failed:', err.message)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

migrate()