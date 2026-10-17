import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BridgeRequest, FrameEntry } from '../protocol.js';
import { createCalls, createSourceStore, Source } from './sources.js';

const setup = (entry: Partial<FrameEntry> = {}) => {
  const sent: BridgeRequest[] = [];
  const calls = createCalls((message) => void sent.push(message));
  const source = new Source(calls, 'c', 'k', { start: 'demand', keep: 'latest', ...entry });
  const statuses: string[] = [];
  source.subscribe(() => statuses.push(source.state.status));
  /** The id of the most recent call. */
  const lastId = () => (sent.findLast((m) => m.type === 'call') as { id: number }).id;
  return { sent, calls, source, statuses, lastId };
};

test('a request: loading, then open with its value, then done', async () => {
  const { sent, calls, source, statuses, lastId } = setup({ input: { a: 1 } });
  const ended = source.run();
  assert.deepEqual(sent, [{ type: 'call', id: 1, component: 'c', key: 'k', input: { a: 1 } }]);

  calls.receive({ type: 'next', id: lastId(), data: 3 });
  calls.receive({ type: 'done', id: lastId() });
  assert.deepEqual(statuses, ['loading', 'open', 'done']);
  assert.deepEqual(source.state, { status: 'done', value: 3, values: [3], error: undefined });
  assert.equal(await ended, 3);
});

test('run(input) replaces the default input; no input is sent when there is none', () => {
  const { sent, source } = setup({ input: { a: 1 } });
  void source.run({ a: 2 });
  assert.deepEqual((sent[0] as { input: unknown }).input, { a: 2 });

  const bare = setup();
  void bare.source.run();
  assert.equal('input' in bare.sent[0]!, false);
});

test('keep: latest, all, and the last N', () => {
  for (const [keep, expected] of [
    ['latest', [4]],
    ['all', [1, 2, 3, 4]],
    [2, [3, 4]],
  ] as const) {
    const { calls, source, lastId } = setup({ keep });
    void source.run();
    for (const data of [1, 2, 3, 4]) calls.receive({ type: 'next', id: lastId(), data });
    assert.deepEqual(source.state.values, expected, String(keep));
    assert.equal(source.state.value, 4);
    assert.equal(source.state.status, 'open');
  }
});

test('running again cancels the previous run, resets values and keeps the stale value', async () => {
  const { sent, calls, source, lastId } = setup({ keep: 'all' });
  const first = source.run();
  const firstId = lastId();
  calls.receive({ type: 'next', id: firstId, data: 'old' });

  void source.run();
  assert.deepEqual(sent.slice(1), [
    { type: 'cancel', id: firstId },
    { type: 'call', id: firstId + 1, component: 'c', key: 'k' },
  ]);
  assert.equal(await first, 'old', 'the cancelled run settles with what it had');
  assert.deepEqual(source.state, { status: 'loading', value: 'old', values: [], error: undefined });

  // Late responses to the cancelled call are dropped.
  calls.receive({ type: 'next', id: firstId, data: 'late' });
  assert.equal(source.state.value, 'old');

  calls.receive({ type: 'next', id: lastId(), data: 'new' });
  assert.deepEqual(source.state.values, ['new']);
});

test('an error ends the run, keeping the last value', async () => {
  const { calls, source, lastId } = setup();
  const ended = source.run();
  calls.receive({ type: 'next', id: lastId(), data: 1 });
  calls.receive({ type: 'error', id: lastId(), message: 'boom' });
  assert.deepEqual(source.state, { status: 'error', value: 1, values: [1], error: { message: 'boom' } });
  assert.equal(await ended, 1);

  // A new run clears the error.
  void source.run();
  assert.equal(source.state.error, undefined);
});

test('cancel stops the run and goes idle; cancelling nothing changes nothing', async () => {
  const { sent, source, statuses, lastId } = setup();
  source.cancel();
  assert.deepEqual(statuses, []);

  const ended = source.run();
  source.cancel();
  assert.deepEqual(sent.at(-1), { type: 'cancel', id: lastId() });
  assert.equal(source.state.status, 'idle');
  assert.equal(await ended, undefined);
});

test('a lost session ends every pending run with an error', async () => {
  const { calls, source } = setup();
  const other = new Source(calls, 'c', 'other', { start: 'demand', keep: 'latest' });
  const ended = [source.run(), other.run()];
  calls.lost();
  for (const s of [source, other]) assert.deepEqual(s.state.error, { message: 'Connection lost' });
  await Promise.all(ended);
});

test('a store runs mount entries on start, rejects unknown keys and cancels on dispose', () => {
  const sent: BridgeRequest[] = [];
  const calls = createCalls((message) => void sent.push(message));
  const store = createSourceStore(
    'c',
    {
      now: { start: 'mount', keep: 'latest' },
      later: { start: 'demand', keep: 'latest' },
    },
    calls,
  );

  store.start();
  assert.deepEqual(sent, [{ type: 'call', id: 1, component: 'c', key: 'now' }]);
  assert.equal(store.get('later').state.status, 'idle');
  assert.throws(() => store.get('nope'), /"nope" is not in this component's contract/);
  assert.throws(() => store.get('__proto__'), /not in this component's contract/);

  store.dispose();
  assert.deepEqual(sent.at(-1), { type: 'cancel', id: 1 });
  assert.equal(store.get('now').state.status, 'idle');
});
