const DEFAULT_NAME = 'kaminos-hand-reach-trials';

function requireId(id) {
  if (typeof id !== 'string' || !id.trim()) throw new TypeError('Trial id is required');
}

function openDatabase(indexedDB, name) {
  return new Promise((resolve, reject) => {
    if (!indexedDB?.open) throw new Error('IndexedDB is unavailable; hand reach retention cannot start');
    const request = indexedDB.open(name, 1);
    let abandoned = false;
    request.onblocked = () => {
      abandoned = true;
      reject(new Error('Hand reach retention database upgrade is blocked by another connection'));
    };
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      if (abandoned) {request.transaction.abort(); return;}
      const db = request.result;
      db.createObjectStore('trials', {keyPath: 'id'});
      db.createObjectStore('frames', {keyPath: ['trialId', 'sequence']}).createIndex('trialId', 'trialId');
    };
    request.onsuccess = () => {
      const db = request.result;
      if (abandoned) {db.close(); return;}
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

// Request success precedes commit. Resolve only on complete, including metadata
// and the frame in the same transaction; an abort leaves prior rows untouched.
function transact(db, stores, mode, run) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode, mode === 'readwrite' ? {durability: 'strict'} : undefined);
    let result, failure;
    const guard = fn => (...args) => {
      try {fn(...args);} catch (error) {
        failure = error;
        try {tx.abort();} catch {reject(error);}
      }
    };
    tx.onerror = event => {failure ??= event.target.error ?? tx.error;};
    tx.onabort = () => reject(failure ?? tx.error ?? new DOMException('Retention transaction aborted', 'AbortError'));
    tx.oncomplete = () => resolve(result);
    guard(() => run(tx, value => {result = value;}, guard))();
  });
}

function readDatabase(db, id) {
  return transact(db, ['trials', 'frames'], 'readonly', (tx, result, guard) => {
    const metadata = tx.objectStore('trials').get(id);
    const frames = tx.objectStore('frames').index('trialId').getAll(id);
    frames.onsuccess = guard(() => {
      const trial = metadata.result;
      // Equal index keys are ordered by the [trialId, sequence] primary key.
      result(trial ? {id, source: trial.source, status: trial.status, summary: trial.summary,
        frames: frames.result.map(entry => entry.row)} : null);
    });
  });
}

// Source and rows are opaque structured-clone data, never JSON projections.
// A failure row may lack an image only when capture itself failed. No eviction,
// deletion or retention cap is performed; browser storage policy still applies.
export async function createHandReachRetention({indexedDB = globalThis.indexedDB,
  name = DEFAULT_NAME, id = crypto.randomUUID(), source} = {}) {
  requireId(id);
  if (source === null || source === undefined || (typeof source !== 'object' && typeof source !== 'string')
    || (typeof source === 'string' && !source.trim())) throw new TypeError('Trial source is required');
  const metadata = {id, source: structuredClone(source), status: 'recording', count: 0, summary: null};
  const db = await openDatabase(indexedDB, name);
  try {
    await transact(db, ['trials'], 'readwrite', tx => {tx.objectStore('trials').add(metadata);});
  } catch (error) {db.close(); throw error;}

  const update = (stores, apply) => transact(db, stores, 'readwrite', (tx, result, guard) => {
    const trials = tx.objectStore('trials');
    const request = trials.get(id);
    request.onsuccess = guard(() => {
      const trial = request.result;
      if (!trial) throw new Error(`Hand reach trial not found: ${id}`);
      if (trial.status !== 'recording') throw new Error(`Hand reach trial is finished: ${id}`);
      apply(tx, trial);
      trials.put(trial);
    });
  });

  return Object.freeze({
    id,
    async append(row) {
      if (!row || typeof row !== 'object' || row.frameId === null || row.frameId === undefined)
        throw new TypeError('Retained row requires a frameId');
      const captureFailed = typeof row.failure === 'string' && Boolean(row.failure.trim());
      if (row.image == null ? !captureFailed : !(row.image instanceof Blob) || row.image.type !== 'image/png')
        throw new TypeError('Retained row requires a PNG Blob (or a capture failure without an image)');
      // Clone before the metadata request so inference can reuse its typed arrays.
      const snapshot = structuredClone(row);
      await update(['trials', 'frames'], (tx, trial) => {
        tx.objectStore('frames').add({trialId: id, sequence: trial.count, row: snapshot});
        trial.count++;
      });
    },
    async finish(summary = {}) {
      if (!summary || typeof summary !== 'object') throw new TypeError('Trial summary must be an object');
      const snapshot = structuredClone(summary);
      const status = snapshot.status ?? (snapshot.error ? 'failed' : 'complete');
      if (typeof status !== 'string' || !status.trim() || status === 'recording')
        throw new TypeError('Trial finish requires a terminal status');
      await update(['trials'], (tx, trial) => {trial.status = status; trial.summary = snapshot;});
    },
    read() {return readDatabase(db, id);},
    // Native close allows already-created transactions to finish, and forbids
    // new ones. It never finishes a trial or deletes any retained evidence.
    close() {db.close();},
  });
}

export async function readHandReachTrial({indexedDB = globalThis.indexedDB, name = DEFAULT_NAME, id} = {}) {
  requireId(id);
  const db = await openDatabase(indexedDB, name);
  try {return await readDatabase(db, id);} finally {db.close();}
}
