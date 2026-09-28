import { createHash, randomUUID } from 'crypto';
import { Pool, PoolClient } from 'pg';

export interface PersistedIntent {
  intentId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  state: string;
  payload: Record<string, unknown>;
}

export class PgEventJournal {
  public readonly pool: Pool;

  constructor(connectionString: string) {
    if (!connectionString) throw new Error('POSTGRES connection string is required');
    this.pool = new Pool({ connectionString, max: 8 });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS live_events (
        id BIGSERIAL PRIMARY KEY,
        event_type TEXT NOT NULL,
        entity_id TEXT,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS live_intents (
        intent_id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        state TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS live_outbox (
        id BIGSERIAL PRIMARY KEY,
        outbox_id TEXT UNIQUE NOT NULL,
        intent_id TEXT UNIQUE NOT NULL REFERENCES live_intents(intent_id),
        payload JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS live_fencing (
        lock_name TEXT PRIMARY KEY,
        generation BIGINT NOT NULL
      );
    `);
  }

  async healthcheck(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  /**
   * Transactional outbox: intent and executable order package commit together.
   * If this transaction fails, caller must not send anything to Binance.
   */
  async persistIntentAndOutbox(
    intent: PersistedIntent,
    orderPackage: Record<string, unknown>
  ): Promise<string> {
    const client = await this.pool.connect();
    const outboxId = randomUUID();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO live_intents(intent_id,symbol,side,state,payload)
         VALUES($1,$2,$3,$4,$5::jsonb)
         ON CONFLICT(intent_id) DO NOTHING`,
        [intent.intentId, intent.symbol, intent.side, intent.state, JSON.stringify(intent.payload)]
      );
      await client.query(
        `INSERT INTO live_outbox(outbox_id,intent_id,payload)
         VALUES($1,$2,$3::jsonb)
         ON CONFLICT(intent_id) DO NOTHING`,
        [outboxId, intent.intentId, JSON.stringify(orderPackage)]
      );
      await client.query(
        `INSERT INTO live_events(event_type,entity_id,payload)
         VALUES('INTENT_PERSISTED',$1,$2::jsonb)`,
        [intent.intentId, JSON.stringify({ state: intent.state, symbol: intent.symbol, side: intent.side })]
      );
      await client.query('COMMIT');
      return outboxId;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async appendEvent(eventType: string, entityId: string | null, payload: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      `INSERT INTO live_events(event_type,entity_id,payload) VALUES($1,$2,$3::jsonb)`,
      [eventType, entityId, JSON.stringify(payload)]
    );
  }

  async claimOutbox(limit = 10): Promise<Array<{ outboxId: string; intentId: string; payload: Record<string, unknown> }>> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT id,outbox_id,intent_id,payload
           FROM live_outbox
          WHERE status='PENDING'
          ORDER BY id
          FOR UPDATE SKIP LOCKED
          LIMIT $1`,
        [limit]
      );
      if (result.rows.length) {
        await client.query(
          `UPDATE live_outbox
              SET status='PROCESSING', attempts=attempts+1, updated_at=NOW()
            WHERE id = ANY($1::bigint[])`,
          [result.rows.map(r => String(r.id))]
        );
      }
      await client.query('COMMIT');
      return result.rows.map(r => ({
        outboxId: r.outbox_id,
        intentId: r.intent_id,
        payload: r.payload,
      }));
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async markOutboxDone(outboxId: string): Promise<void> {
    await this.pool.query(
      `UPDATE live_outbox SET status='DONE',updated_at=NOW() WHERE outbox_id=$1`,
      [outboxId]
    );
  }

  async counts(): Promise<{ intents: number; outbox: number; events: number }> {
    const [i, o, e] = await Promise.all([
      this.pool.query('SELECT COUNT(*)::int AS n FROM live_intents'),
      this.pool.query('SELECT COUNT(*)::int AS n FROM live_outbox'),
      this.pool.query('SELECT COUNT(*)::int AS n FROM live_events'),
    ]);
    return { intents: i.rows[0].n, outbox: o.rows[0].n, events: e.rows[0].n };
  }

  async truncateForTesting(): Promise<void> {
    if (process.env.NODE_ENV === 'production') throw new Error('Refusing truncate in production');
    await this.pool.query('TRUNCATE live_outbox, live_intents, live_events RESTART IDENTITY CASCADE');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function advisoryKey(name: string): string {
  const hex = createHash('sha256').update(name).digest('hex').slice(0, 15);
  return BigInt('0x' + hex).toString();
}

export class PgLeaderLock {
  private client: PoolClient | null = null;
  private held = false;
  private generation = 0;
  private readonly key: string;

  constructor(private journal: PgEventJournal, private lockName: string) {
    this.key = advisoryKey(lockName);
  }

  async acquire(): Promise<{ acquired: boolean; generation: number }> {
    if (this.held) return { acquired: true, generation: this.generation };
    const client = await this.journal.pool.connect();
    try {
      const result = await client.query(
        'SELECT pg_try_advisory_lock($1::bigint) AS ok',
        [this.key]
      );
      if (!result.rows[0]?.ok) {
        client.release();
        return { acquired: false, generation: 0 };
      }

      await client.query('BEGIN');
      const gen = await client.query(
        `INSERT INTO live_fencing(lock_name,generation)
         VALUES($1,1)
         ON CONFLICT(lock_name) DO UPDATE SET generation=live_fencing.generation+1
         RETURNING generation`,
        [this.lockName]
      );
      await client.query('COMMIT');
      this.client = client;
      this.held = true;
      this.generation = Number(gen.rows[0].generation);
      client.on('error', () => {
        this.held = false;
        this.client = null;
      });
      return { acquired: true, generation: this.generation };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      try { await client.query('SELECT pg_advisory_unlock($1::bigint)', [this.key]); } catch {}
      client.release();
      throw error;
    }
  }

  assertHeld(): number {
    if (!this.held || !this.client) throw new Error('EXECUTION_WRITER_NOT_LEADER');
    return this.generation;
  }

  async release(): Promise<void> {
    if (!this.client) {
      this.held = false;
      return;
    }
    try {
      await this.client.query('SELECT pg_advisory_unlock($1::bigint)', [this.key]);
    } finally {
      this.client.release();
      this.client = null;
      this.held = false;
    }
  }
}
