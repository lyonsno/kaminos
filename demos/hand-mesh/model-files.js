import { readModelPackage } from '../../models/mobrecon/model-package-source.js';

const kinds = { mobrecon: 'mobrecon.browser-weight-package.v0', detector: 'wilor-hand-detector.browser-weight-package.v0' };
export async function readLocalModels(files) {
  const byName = new Map();
  for (const file of files) {
    if (byName.has(file.name)) throw new Error(`Duplicate model file: ${file.name}`);
    byName.set(file.name, file);
  }
  const result = {};
  for (const [kind, schema] of Object.entries(kinds)) {
    const file = byName.get(`${kind}.package.json`);
    if (!file) throw new Error(`Choose the prepared model folder: missing ${kind}.package.json`);
    let metadata;
    try { metadata = JSON.parse(await file.text()); } catch { throw new Error(`${file.name} is not valid JSON`); }
    const bundleName = metadata.resources?.[0]?.file;
    if (typeof bundleName !== 'string' || /[/\\]/.test(bundleName)) throw new Error(`${kind} package must name one local bundle file`);
    const bundle = byName.get(bundleName);
    if (!bundle) throw new Error(`Missing model data: ${bundleName}`);
    const packageSource = { metadata, bundle };
    await readModelPackage({ packageSource, schema });
    result[kind] = packageSource;
  }
  return result;
}

// Transactional replacement: invalid imports never overwrite a working cache.
export function createModelStore(indexedDB, name = 'kaminos-hand-mesh-models-v1') {
  const open = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('models');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const run = async (mode, operation) => {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('models', mode), request = operation(tx.objectStore('models'));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = tx.onabort = () => reject(tx.error || request.error || new Error('Model storage failed'));
      });
    } finally { db.close(); }
  };
  return { get: () => run('readonly', store => store.get('active')), put: value => run('readwrite', store => store.put(value, 'active')) };
}
