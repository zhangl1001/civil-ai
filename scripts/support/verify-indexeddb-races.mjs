import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';

/** Exercise commit races using IDB transactions rather than a map pretending to be a database. */
export async function verifyIndexedDbRaces(server) {
  const load = file => server.ssrLoadModule(`/src/${file}.ts`);
  const [agent, { TutorIndexedDb }, { IndexedDbTransactionScope, IndexedDbUnitOfWork }, { IndexedDbAgentRunRepository }, { IndexedDbOutboxRepository }, { IndexedDbGenerationRepository }] = await Promise.all([
    load('modules/agent/public'), load('capabilities/database/adapters/indexeddb/TutorIndexedDb'),
    load('capabilities/database/adapters/indexeddb/IndexedDbUnitOfWork'), load('modules/agent/adapters/IndexedDbAgentRunRepository'),
    load('modules/task/adapters/IndexedDbOutboxRepository'), load('modules/content/adapters/IndexedDbGenerationRepository')
  ]);
  const original = globalThis.indexedDB;
  globalThis.indexedDB = new IDBFactory();
  let sequence = 0;
  const ids = { next: ns => `${ns}:race:${++sequence}` };
  const clock = { now: () => 1_800_000_000_000 };
  const tab = () => {
    const db = new TutorIndexedDb(), scope = new IndexedDbTransactionScope(), unit = new IndexedDbUnitOfWork(db, scope);
    const runs = new IndexedDbAgentRunRepository(db, scope), outbox = new IndexedDbOutboxRepository(db, scope);
    return { db, scope, unit, runs, outbox, progress: new agent.UpdateAgentRunProgress(unit, runs, outbox, clock, ids), transition: new agent.TransitionAgentRun(unit, runs, outbox, clock, ids) };
  };
  const a = tab(), b = tab();
  async function createRun(key) {
    const created = await new agent.CreateAgentRun(a.unit, a.runs, a.outbox, clock, ids).execute({ idempotencyKey: key, runType: 'tutor_turn', targetResourceType: 'business_operation', inputSnapshot: { intent: 'mock' } });
    const [claimed] = await new agent.ClaimAgentRuns(a.runs, clock, ids).execute({ workerId: 'race-worker', leaseExpiresAt: clock.now() + 60_000, limit: 1 });
    assert.equal(created.run.id, claimed.run.id);
    return claimed;
  }
  const pauseCommit = () => {
    let release, ready;
    const paused = new Promise(r => { ready = r; }), wait = new Promise(r => { release = r; });
    const write = a.db.writeBatch.bind(a.db);
    a.db.writeBatch = async operations => { a.db.writeBatch = write; ready(); await wait; return write(operations); };
    return { paused, release };
  };
  const writeProgress = run => a.progress.execute({ agentRunId: run.id, step: agent.TaskCenterStep.InvokingModel, progress: 42, message: 'race', leaseToken: agent.leaseTokenOf(run) });
  try {
    const cancelled = await createRun('race:cancel');
    const pause = pauseCommit();
    const pending = writeProgress(cancelled.run);
    const rejection = assert.rejects(pending, error => error.code === 'agent_run.lease_lost');
    await pause.paused;
    await new agent.CancelAgentRun(b.transition).execute({ agentRunId: cancelled.run.id });
    pause.release(); await rejection;
    const final = await b.runs.findById(cancelled.run.id);
    assert.equal(final.run.status, 'cancelled');
    assert(final.events.some(e => e.eventType === 'cancelled'));
    assert.equal(await a.runs.hasActiveLease(agent.leaseTokenOf(cancelled.run), clock.now()), false);
    assert.equal((await a.db.getAll('domain_outbox')).some(e => e.aggregateId === cancelled.run.id && e.eventType === 'tutor_agent_run.progressed'), false, 'failed compare-and-write rolls back its outbox too');

    const renewal = await createRun('race:renew');
    const pause2 = pauseCommit(), progress = writeProgress(renewal.run);
    await pause2.paused;
    assert(await b.runs.renewLease(agent.leaseTokenOf(renewal.run), clock.now(), clock.now() + 120_000));
    pause2.release(); await progress;
    assert.equal((await a.runs.findById(renewal.run.id)).run.leaseExpiresAt, clock.now() + 120_000);

    // One transaction records both a result and validation; neither may erase the other's fields.
    const invocation = { id: 'invocation:race', agentRunId: renewal.run.id, validationStatus: 'pending', provider: 'mock', model: 'mock', modelRole: 'chat', requestHash: 'hash', createdAt: clock.now() };
    await a.unit.run(ctx => a.runs.appendInvocation(invocation, ctx));
    const pause3 = pauseCommit();
    const ledger = a.unit.run(async ctx => {
      await a.runs.updateInvocationResult(invocation.id, { inputTokens: 10, outputTokens: 20 }, ctx);
      await a.runs.updateInvocationValidation(invocation.id, 'valid', undefined, ctx);
    });
    await pause3.paused;
    await new agent.CancelAgentRun(b.transition).execute({ agentRunId: renewal.run.id });
    pause3.release(); await ledger;
    assert.equal((await a.runs.findById(renewal.run.id)).run.status, 'cancelled', 'ledger update cannot resurrect a run');
    const [stored] = await a.runs.listInvocations(renewal.run.id);
    assert.equal(stored.validationStatus, 'valid'); assert.equal(stored.inputTokens, 10); assert.equal(stored.outputTokens, 20);

    const generationsA = new IndexedDbGenerationRepository(a.db, a.scope), generationsB = new IndexedDbGenerationRepository(b.db, b.scope);
    const generation = id => ({ spec: { id: `spec:${id}` }, workflow: { id, idempotencyKey: 'race:same-generation', version: 1 } });
    const created = await Promise.allSettled([
      a.unit.run(async ctx => { await generationsA.create(generation('workflow:a'), ctx); await a.outbox.append({ id: 'outbox:a' }, ctx); }),
      b.unit.run(async ctx => { await generationsB.create(generation('workflow:b'), ctx); await b.outbox.append({ id: 'outbox:b' }, ctx); })
    ]);
    assert.equal(created.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((await a.db.getAll('generation_aggregates')).length, 1);
    assert.equal((await a.db.getAll('domain_outbox')).filter(e => ['outbox:a', 'outbox:b'].includes(e.id)).length, 1);
    console.log('IndexedDB cancellation, renewal, ledger and generation commit races passed.');
  } finally { a.db.close(); b.db.close(); globalThis.indexedDB = original; }
}
