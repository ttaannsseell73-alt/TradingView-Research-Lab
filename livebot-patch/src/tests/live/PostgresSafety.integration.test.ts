import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgEventJournal, PgLeaderLock } from '../../live/PostgresSafety';

const url = process.env.LIVEBOT_TEST_PG_URL;
const suite = url ? describe : describe.skip;

suite('PostgreSQL fail-closed journal + leader fencing', () => {
  let journalA: PgEventJournal;
  let journalB: PgEventJournal;

  beforeAll(async () => {
    journalA = new PgEventJournal(url!);
    journalB = new PgEventJournal(url!);
    await journalA.init();
    await journalB.init();
    await journalA.truncateForTesting();
  });

  afterAll(async () => {
    await journalA?.close();
    await journalB?.close();
  });

  it('persists intent and outbox atomically', async () => {
    await journalA.persistIntentAndOutbox(
      { intentId:'intent-1',symbol:'QUSDT',side:'BUY',state:'RISK_APPROVED',payload:{candle:123} },
      { symbol:'QUSDT', side:'BUY', type:'LIMIT', timeInForce:'IOC' }
    );
    const c=await journalA.counts();
    expect(c.intents).toBe(1);
    expect(c.outbox).toBe(1);
    expect(c.events).toBeGreaterThanOrEqual(1);
  });

  it('only one execution writer can hold the advisory lock', async () => {
    const a=new PgLeaderLock(journalA,'canonical-live-writer');
    const b=new PgLeaderLock(journalB,'canonical-live-writer');
    const ar=await a.acquire();
    const br=await b.acquire();
    expect(ar.acquired).toBe(true);
    expect(ar.generation).toBeGreaterThan(0);
    expect(br.acquired).toBe(false);
    await a.release();
    const br2=await b.acquire();
    expect(br2.acquired).toBe(true);
    expect(br2.generation).toBeGreaterThan(ar.generation);
    await b.release();
  });

  it('journal failure throws instead of silently allowing execution', async () => {
    const broken=new PgEventJournal('postgres://127.0.0.1:1/does-not-exist?connect_timeout=1');
    await expect(
      broken.persistIntentAndOutbox(
        { intentId:'broken',symbol:'QUSDT',side:'BUY',state:'RISK_APPROVED',payload:{} },
        { symbol:'QUSDT' }
      )
    ).rejects.toBeTruthy();
    await broken.close().catch(()=>undefined);
  });
});
