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

      CREATE TABLE IF NOT EXISTS live_fills (
        fill_id TEXT PRIMARY KEY,
        intent_id TEXT,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        expected_price DOUBLE PRECISION,
        fill_price DOUBLE PRECISION NOT NULL,
        quantity DOUBLE PRECISION NOT NULL,
        commission DOUBLE PRECISION NOT NULL DEFAULT 0,
        commission_asset TEXT,
        implementation_shortfall_bps DOUBLE PRECISION,
        event_time BIGINT NOT NULL,
        payload JSONB NOT NULL
      );

      CREATE TABLE IF NOT EXISTS live_position_snapshots (
        id BIGSERIAL PRIMARY KEY,
        symbol TEXT NOT NULL,
        position_amt DOUBLE PRECISION NOT NULL,
        entry_price DOUBLE PRECISION,
        mark_price DOUBLE PRECISION,
        liquidation_price DOUBLE PRECISION,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS live_position_adjustments (
        id BIGSERIAL PRIMARY KEY,
        symbol TEXT NOT NULL,
        quantity_delta DOUBLE PRECISION NOT NULL,
        reason TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS live_risk_snapshots (
        id BIGSERIAL PRIMARY KEY,
        symbol TEXT,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

  async knownIntentIds(): Promise<string[]> {
    const result = await this.pool.query('SELECT intent_id FROM live_intents ORDER BY created_at');
    return result.rows.map(r => String(r.intent_id));
  }

  async hasIntentForCandle(symbol: string, candleOpenTime: number): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1
         FROM live_intents
        WHERE symbol=$1
          AND payload->>'candleOpenTime'=$2
        LIMIT 1`,
      [symbol, String(candleOpenTime)]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async knownProtectionIds(): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT DISTINCT payload->>'clientAlgoId' AS id
         FROM live_events
        WHERE event_type='PROTECTION_ACK'
          AND payload ? 'clientAlgoId'`
    );
    return result.rows.map(r => String(r.id)).filter(Boolean);
  }

  async expectedPriceForIntent(intentId: string): Promise<number | null> {
    const result = await this.pool.query(
      `SELECT payload->>'price' AS price
         FROM live_outbox
        WHERE intent_id=$1
        ORDER BY id DESC
        LIMIT 1`,
      [intentId]
    );
    if (!result.rows.length) return null;
    const value = Number(result.rows[0].price);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  async expectedNetPosition(symbol: string): Promise<number> {
    const result = await this.pool.query(
      `SELECT (
          SELECT COALESCE(SUM(
            CASE
              WHEN side='BUY' THEN quantity
              WHEN side='SELL' THEN -quantity
              ELSE 0
            END
          ),0)::float8
          FROM live_fills
          WHERE symbol=$1
        ) + (
          SELECT COALESCE(SUM(quantity_delta),0)::float8
          FROM live_position_adjustments
          WHERE symbol=$1
        ) AS qty`,
      [symbol]
    );
    return Number(result.rows[0]?.qty ?? 0);
  }

  async applyPositionAdjustment(args: {
    symbol: string;
    quantityDelta: number;
    reason: string;
    payload: Record<string, unknown>;
  }): Promise<string> {
    if (!Number.isFinite(args.quantityDelta) || Math.abs(args.quantityDelta) < 1e-12) {
      throw new Error('INVALID_POSITION_ADJUSTMENT');
    }
    if (!args.reason.trim()) throw new Error('POSITION_ADJUSTMENT_REASON_REQUIRED');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO live_position_adjustments(symbol,quantity_delta,reason,payload)
         VALUES($1,$2,$3,$4::jsonb)
         RETURNING id::text AS id`,
        [args.symbol, args.quantityDelta, args.reason, JSON.stringify(args.payload)]
      );
      const id = String(inserted.rows[0].id);
      await client.query(
        `INSERT INTO live_events(event_type,entity_id,payload)
         VALUES('POSITION_LEDGER_ADJUSTED',$1,$2::jsonb)`,
        [args.symbol, JSON.stringify({
          adjustmentId: id,
          quantityDelta: args.quantityDelta,
          reason: args.reason,
          ...args.payload,
        })]
      );
      await client.query('COMMIT');
      return id;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async unresolvedOutbox(): Promise<Array<{ outboxId: string; intentId: string; status: string; payload: Record<string, unknown> }>> {
    const result = await this.pool.query(
      `SELECT outbox_id,intent_id,status,payload
         FROM live_outbox
        WHERE status IN ('PENDING','PROCESSING')
        ORDER BY id`
    );
    return result.rows.map(r => ({
      outboxId: String(r.outbox_id),
      intentId: String(r.intent_id),
      status: String(r.status),
      payload: r.payload,
    }));
  }

  async markOutboxUnknownResolved(outboxId: string, resolution: string, payload: Record<string, unknown>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE live_outbox SET status='DONE',updated_at=NOW() WHERE outbox_id=$1`,
        [outboxId]
      );
      await client.query(
        `INSERT INTO live_events(event_type,entity_id,payload)
         SELECT 'ORDER_UNKNOWN_RESOLVED', intent_id, $2::jsonb
           FROM live_outbox WHERE outbox_id=$1`,
        [outboxId, JSON.stringify({ resolution, ...payload })]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async recordFill(args: {
    fillId: string;
    intentId?: string | null;
    symbol: string;
    side: string;
    expectedPrice?: number | null;
    fillPrice: number;
    quantity: number;
    commission?: number;
    commissionAsset?: string | null;
    eventTime: number;
    payload: Record<string, unknown>;
  }): Promise<boolean> {
    const expected = args.expectedPrice ?? null;
    const sideSign = args.side === 'BUY' ? 1 : args.side === 'SELL' ? -1 : 0;
    const shortfall =
      expected && expected > 0 && sideSign !== 0
        ? sideSign * ((args.fillPrice - expected) / expected) * 10_000
        : null;
    const result = await this.pool.query(
      `INSERT INTO live_fills(
          fill_id,intent_id,symbol,side,expected_price,fill_price,quantity,
          commission,commission_asset,implementation_shortfall_bps,event_time,payload
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
        ON CONFLICT(fill_id) DO NOTHING`,
      [
        args.fillId,
        args.intentId ?? null,
        args.symbol,
        args.side,
        expected,
        args.fillPrice,
        args.quantity,
        args.commission ?? 0,
        args.commissionAsset ?? null,
        shortfall,
        args.eventTime,
        JSON.stringify(args.payload),
      ]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async recordPositionSnapshot(symbol: string, snapshot: any): Promise<void> {
    const row = Array.isArray(snapshot) ? snapshot.find((x: any) => x.symbol === symbol) ?? {} : snapshot ?? {};
    await this.pool.query(
      `INSERT INTO live_position_snapshots(
        symbol,position_amt,entry_price,mark_price,liquidation_price,payload
      ) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        symbol,
        Number(row.positionAmt ?? 0),
        Number(row.entryPrice ?? 0),
        Number(row.markPrice ?? 0),
        Number(row.liquidationPrice ?? 0),
        JSON.stringify(snapshot ?? {}),
      ]
    );
  }

  async recordRiskSnapshot(symbol: string | null, payload: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      'INSERT INTO live_risk_snapshots(symbol,payload) VALUES($1,$2::jsonb)',
      [symbol, JSON.stringify(payload)]
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
    await this.pool.query('TRUNCATE live_outbox, live_intents, live_events, live_fills, live_position_snapshots, live_position_adjustments, live_risk_snapshots RESTART IDENTITY CASCADE');
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
