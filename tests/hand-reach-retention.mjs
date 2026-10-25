// kaminos-test: node
import assert from 'node:assert/strict';
import {createHandReachRetention, readHandReachTrial} from '../models/mobrecon/hand-reach-retention.js';

// Injected subset, not browser conformance evidence. It models the IndexedDB
// transaction/clone contract: https://w3c.github.io/IndexedDB/#transaction-lifecycle
// The parent's browser witness must prove PNG/typed-array recovery after reload.
// Serialization is deliberately stricter than browser readonly scheduling.
function memoryIndexedDB() {
  const databases = new Map(), connections = [], transactions = [];
  let hold = null, commitError = null, requestError = null;
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};
  const keyOf = (value, keyPath) => Array.isArray(keyPath) ? keyPath.map(key => value[key]) : value[keyPath];
  const compare = (a, b) => {
    if (Array.isArray(a)) {
      for (let i = 0; i < a.length; i++) {const order = compare(a[i], b[i]); if (order) return order;}
      return 0;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  };
  const factory = {
    connections, transactions,
    stored(name, store) {return structuredClone([...databases.get(name).stores.get(store).rows.values()]);},
    holdNextCommit() {
      const reached = deferred(), release = deferred();
      hold = {reached, release};
      return {reached: reached.promise, release: release.resolve};
    },
    failNextCommit(error) {commitError = error;},
    failNextRequest(error) {requestError = error;},
    open(name, version) {
      const request = {};
      queueMicrotask(() => {
        let data = databases.get(name);
        const fresh = !data;
        if (!data) {data = {stores: new Map(), tail: Promise.resolve()}; databases.set(name, data);}
        const db = {
          closed: false,
          close() {this.closed = true;},
          createObjectStore(name, {keyPath}) {
            const store = {keyPath, indexes: new Map(), rows: new Map()};
            data.stores.set(name, store);
            return {createIndex(name, path) {store.indexes.set(name, path);}};
          },
          transaction(names, mode, options) {
            if (this.closed) throw new DOMException('Connection closed', 'InvalidStateError');
            names = typeof names === 'string' ? [names] : names;
            let snapshot, ended = false, aborted = false;
            const pending = [];
            const held = mode === 'readwrite' ? hold : null;
            const failure = mode === 'readwrite' ? commitError : null;
            const badRequest = requestError;
            if (mode === 'readwrite') {hold = null; commitError = null;}
            requestError = null;
            const tx = {
              names, mode, options, committed: false,
              abort() {if (ended) throw new DOMException('Transaction ended', 'InvalidStateError'); aborted = true;},
              objectStore(name) {
                assert.ok(names.includes(name));
                const schema = data.stores.get(name);
                const enqueue = action => {
                  if (ended || aborted) throw new DOMException('Transaction inactive', 'TransactionInactiveError');
                  const request = {}; pending.push({request, action}); return request;
                };
                const write = (value, replace) => {
                  assert.equal(mode, 'readwrite');
                  const copy = structuredClone(value), key = JSON.stringify(keyOf(copy, schema.keyPath));
                  return enqueue(() => {
                    const rows = snapshot.get(name);
                    if (!replace && rows.has(key)) throw new DOMException('Duplicate key', 'ConstraintError');
                    rows.set(key, copy); return keyOf(copy, schema.keyPath);
                  });
                };
                return {
                  add: value => write(value, false), put: value => write(value, true),
                  get: key => enqueue(() => structuredClone(snapshot.get(name).get(JSON.stringify(key)))),
                  index(indexName) {
                    const path = schema.indexes.get(indexName); assert.ok(path);
                    return {getAll: key => enqueue(() => structuredClone([...snapshot.get(name).values()]
                      .filter(value => value[path] === key)
                      .sort((a, b) => compare(keyOf(a, schema.keyPath), keyOf(b, schema.keyPath)))))};
                  },
                };
              },
            };
            transactions.push(tx);
            const run = async () => {
              snapshot = new Map(names.map(name => [name, new Map(data.stores.get(name).rows)]));
              let first = true;
              while (pending.length && !aborted) {
                await tick();
                const {request, action} = pending.shift();
                try {
                  if (first && badRequest) throw badRequest;
                  first = false; request.result = action(); request.onsuccess?.({target: request});
                } catch (error) {
                  request.error = error; request.onerror?.({target: request});
                  tx.error = error; tx.onerror?.({target: request}); aborted = true;
                }
              }
              await tick();
              if (held && !aborted) {held.reached.resolve(); await held.release.promise;}
              if (failure && !aborted) {tx.error = failure; aborted = true;}
              ended = true;
              if (aborted) tx.onabort?.({target: tx});
              else {
                if (mode === 'readwrite') for (const [name, rows] of snapshot) data.stores.get(name).rows = rows;
                tx.committed = true; tx.oncomplete?.({target: tx});
              }
            };
            data.tail = data.tail.then(run);
            return tx;
          },
        };
        connections.push(db); request.result = db;
        if (fresh) request.onupgradeneeded?.({oldVersion: 0, newVersion: version});
        request.onsuccess?.({target: request});
      });
      return request;
    },
  };
  return factory;
}

const source = {kind: 'live-camera', id: 'camera-track', route: 'mobrecon-webgpu'};
const png = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')], {type: 'image/png'});
const frame = frameId => ({frameId, image: png, inputSource: {id: source.id, width: 1, height: 1},
  prediction: {vertices: new Float32Array([1.25, -2, 3]), faces: new Uint16Array([0, 1, 2]), hasHand: true},
  effective: {placement: {translation: [0, .2, -.6]}, state: {grabbed: false}}, failure: null});
const idb = memoryIndexedDB();
const options = {indexedDB: idb, name: 'retention-contract', id: 'trial-a', source};

await assert.rejects(createHandReachRetention({...options, source: undefined}), /source/i);
await assert.rejects(createHandReachRetention({...options, source: null}), /source/i);
await assert.rejects(createHandReachRetention({...options, source: ''}), /source/i);
assert.equal(idb.connections.length, 0, 'missing source must not create an anonymous trial');
await assert.rejects(createHandReachRetention({...options, indexedDB: undefined}), /IndexedDB/);

const trial = await createHandReachRetention(options);
assert.equal(trial.id, options.id);
assert.equal(idb.transactions.at(-1).committed, true, 'create waits for metadata commit');
assert.equal(idb.transactions.at(-1).options.durability, 'strict');
const empty = await trial.read();
assert.deepEqual(empty, {id: options.id, source, status: 'recording', summary: null, frames: []});

const first = frame('frame-10'), held = idb.holdNextCommit();
let acknowledged = false;
const append = trial.append(first).then(() => {acknowledged = true;});
first.prediction.vertices[0] = 99;
first.effective.state.grabbed = true;
await held.reached;
assert.equal(acknowledged, false, 'request success is not durable transaction completion');
held.release(); await append;
const read = await trial.read();
assert.equal(read.frames.length, 1);
assert.ok(read.frames[0].image instanceof Blob);
assert.equal(read.frames[0].image.type, 'image/png');
assert.deepEqual(await read.frames[0].image.arrayBuffer(), await png.arrayBuffer());
assert.ok(read.frames[0].prediction.vertices instanceof Float32Array);
assert.ok(read.frames[0].prediction.faces instanceof Uint16Array);
assert.deepEqual([...read.frames[0].prediction.vertices], [1.25, -2, 3]);
assert.equal(read.frames[0].effective.state.grabbed, false, 'snapshot is taken at append, before the caller reuses arrays');
read.frames[0].prediction.vertices[0] = -99;
assert.equal((await trial.read()).frames[0].prediction.vertices[0], 1.25, 'reads do not alias stored state');

const other = await createHandReachRetention({...options, id: 'trial-b', source: 'other-camera'});
await other.append(frame('other'));
await Promise.all([trial.append(frame('frame-2')), trial.append(frame('frame-1'))]);
assert.deepEqual((await trial.read()).frames.map(row => row.frameId), ['frame-10', 'frame-2', 'frame-1']);
assert.equal((await other.read()).frames.length, 1, 'reads isolate trial ids');
await assert.rejects(createHandReachRetention(options), {name: 'ConstraintError'});
assert.equal(idb.connections.at(-1).closed, true, 'failed duplicate creation closes its connection');

idb.failNextCommit(new DOMException('Storage full', 'QuotaExceededError'));
await assert.rejects(trial.append(frame('lost')), {name: 'QuotaExceededError'});
await assert.rejects(trial.append({...frame('uncloneable'), unsupported() {}}), {name: 'DataCloneError'});
await assert.rejects(trial.append({...frame('wrong-image'), image: new Blob(['jpeg'], {type: 'image/jpeg'})}), /PNG/i);
const failureRow = {frameId: 'failed-capture', image: null, prediction: null, effective: {state: {tracking: false}}, failure: 'capture: unavailable'};
await trial.append(failureRow);
assert.deepEqual((await trial.read()).frames.map(row => row.frameId), ['frame-10', 'frame-2', 'frame-1', 'failed-capture']);
assert.deepEqual((await trial.read()).frames.at(-1), failureRow);
assert.equal(idb.stored(options.name, 'trials').find(row => row.id === trial.id).count, 4,
  'frame and count roll back together on failed commit');
assert.deepEqual(idb.stored(options.name, 'frames').filter(row => row.trialId === trial.id)
  .map(row => [row.trialId, row.sequence]), [[trial.id, 0], [trial.id, 1], [trial.id, 2], [trial.id, 3]]);

idb.failNextRequest(new DOMException('Read failed', 'UnknownError'));
await assert.rejects(trial.read(), {name: 'UnknownError'});
const terminal = {error: null, endedAt: 1234, state: {tracking: false}};
idb.failNextCommit(new DOMException('Finish aborted', 'AbortError'));
await assert.rejects(trial.finish(terminal), {name: 'AbortError'});
assert.equal((await trial.read()).status, 'recording', 'aborted finish leaves the trial recoverable');
await trial.finish(terminal);
await assert.rejects(trial.append(frame('after-finish')), /finished|terminal/i);
assert.deepEqual((await trial.read()).summary, terminal);
assert.equal((await trial.read()).status, 'complete');
await assert.rejects(trial.finish({error: 'late rewrite'}), /finished|terminal/i);
trial.close(); trial.close();
await assert.rejects(trial.read(), {name: 'InvalidStateError'});
const recovered = await readHandReachTrial(options);
assert.deepEqual(recovered.summary, terminal);
assert.equal(recovered.frames.length, 4);
assert.ok(recovered.frames[0].prediction.vertices instanceof Float32Array);
assert.equal(idb.connections.at(-1).closed, true, 'recovery helper always closes its connection');
assert.equal(await readHandReachTrial({...options, id: 'not-found'}), null);
assert.equal(idb.connections.at(-1).closed, true);
idb.failNextRequest(new DOMException('Recovery read failed', 'UnknownError'));
await assert.rejects(readHandReachTrial(options), {name: 'UnknownError'});
assert.equal(idb.connections.at(-1).closed, true, 'failed recovery closes its connection too');

const unfinished = await createHandReachRetention({...options, id: 'unfinished'});
const finalAppend = unfinished.append(frame(0));
unfinished.close(); await finalAppend;
const partial = await readHandReachTrial({...options, id: 'unfinished'});
assert.equal(partial.status, 'recording', 'close does not claim trial completion');
assert.equal(partial.frames.length, 1, 'close lets an already-started append commit');
const ordered = await createHandReachRetention({...options, id: 'ordered'});
const rows = Array.from({length: 12}, (_, i) => frame(12 - i));
const pending = rows.map(row => ordered.append(row));
const finishing = ordered.finish({endedAt: 9876});
await Promise.all([...pending, finishing]);
assert.deepEqual((await ordered.read()).frames.map(row => row.frameId), rows.map(row => row.frameId),
  'finish drains prior appends; sequences are numeric, not lexical or frame-id sorted');
ordered.close();
await other.finish({error: 'inference failed', endedAt: 5678, state: {tracking: false}});
assert.equal((await other.read()).status, 'failed');
other.close();
assert.ok(idb.connections.every(connection => connection.closed), 'no retained test connections');
console.log('hand reach retention: commit acknowledgement, clone fidelity, ordering, abort rollback and restart recovery pass (injected IDB only)');
