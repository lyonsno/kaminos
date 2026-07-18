const FETCH_OPTION_SNAPSHOT_KIND = Symbol('kaminos.fetch-option-snapshot-kind');

function snapshotValue(value, path, ancestors, label) {
  if (
    value == null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || typeof value === 'undefined'
  ) return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new Error(`${label} fetchOptions must contain finite ordinary numbers; invalid value at ${path}`);
    }
    return value;
  }
  if (typeof value !== 'object') {
    throw new Error(`${label} fetchOptions cannot snapshot ${typeof value} at ${path}`);
  }
  if (ancestors.has(value)) throw new Error(`${label} fetchOptions contain a cycle at ${path}`);

  const HeadersConstructor = globalThis.Headers;
  if (typeof HeadersConstructor === 'function' && value instanceof HeadersConstructor) {
    return Object.freeze({
      [FETCH_OPTION_SNAPSHOT_KIND]: 'headers',
      entries: Object.freeze([...value.entries()].map(entry => Object.freeze([...entry]))),
    });
  }
  const BlobConstructor = globalThis.Blob;
  if (typeof BlobConstructor === 'function' && value instanceof BlobConstructor) {
    return Object.freeze({ [FETCH_OPTION_SNAPSHOT_KIND]: 'blob', value });
  }
  const ParamsConstructor = globalThis.URLSearchParams;
  if (typeof ParamsConstructor === 'function' && value instanceof ParamsConstructor) {
    return Object.freeze({
      [FETCH_OPTION_SNAPSHOT_KIND]: 'url-search-params',
      value: value.toString(),
    });
  }
  if (value instanceof ArrayBuffer) {
    return Object.freeze({
      [FETCH_OPTION_SNAPSHOT_KIND]: 'array-buffer',
      bytes: Object.freeze([...new Uint8Array(value)]),
    });
  }
  if (ArrayBuffer.isView(value)) {
    if (typeof SharedArrayBuffer !== 'undefined' && value.buffer instanceof SharedArrayBuffer) {
      throw new Error(`${label} fetchOptions cannot snapshot SharedArrayBuffer at ${path}`);
    }
    return Object.freeze({
      [FETCH_OPTION_SNAPSHOT_KIND]: 'bytes',
      bytes: Object.freeze([...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)]),
    });
  }

  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    const name = value.constructor?.name || 'host object';
    throw new Error(`${label} fetchOptions cannot snapshot mutable ${name} at ${path}`);
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const snapshot = new Array(value.length);
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
          throw new Error(`${label} fetchOptions require dense data arrays; invalid element at ${path}[${index}]`);
        }
        snapshot[index] = snapshotValue(descriptor.value, `${path}[${index}]`, ancestors, label);
      }
      const namedKeys = Reflect.ownKeys(value).filter(key => (
        key !== 'length' && (typeof key === 'symbol' || !/^(0|[1-9][0-9]*)$/.test(key))
      ));
      if (namedKeys.length > 0) {
        throw new Error(`${label} fetchOptions arrays cannot carry named properties at ${path}`);
      }
      return Object.freeze(snapshot);
    }
    const snapshot = Object.create(prototype);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === 'symbol') {
        throw new Error(`${label} fetchOptions cannot snapshot symbol keys at ${path}`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new Error(`${label} fetchOptions require enumerable data properties at ${path}.${key}`);
      }
      Object.defineProperty(snapshot, key, {
        value: snapshotValue(descriptor.value, `${path}.${key}`, ancestors, label),
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Object.freeze(snapshot);
  } finally {
    ancestors.delete(value);
  }
}

export function materializeWebGpuModelFetchOptions(snapshot) {
  if (snapshot == null || typeof snapshot !== 'object') return snapshot;
  const kind = snapshot[FETCH_OPTION_SNAPSHOT_KIND];
  if (kind === 'headers') return new globalThis.Headers(snapshot.entries);
  if (kind === 'blob') return snapshot.value;
  if (kind === 'url-search-params') return new globalThis.URLSearchParams(snapshot.value);
  if (kind === 'array-buffer') return Uint8Array.from(snapshot.bytes).buffer;
  if (kind === 'bytes') return Uint8Array.from(snapshot.bytes);
  if (Array.isArray(snapshot)) return snapshot.map(materializeWebGpuModelFetchOptions);
  const value = Object.create(Object.getPrototypeOf(snapshot));
  for (const [key, child] of Object.entries(snapshot)) {
    Object.defineProperty(value, key, {
      value: materializeWebGpuModelFetchOptions(child),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return value;
}

export function snapshotWebGpuModelFetchOptions(fetchOptions, options = {}) {
  if (fetchOptions == null) return null;
  const label = options.label || 'model resource';
  if (!fetchOptions || typeof fetchOptions !== 'object' || Array.isArray(fetchOptions)) {
    throw new Error(`${label} fetchOptions must be an object`);
  }
  const signalDescriptor = Object.getOwnPropertyDescriptor(fetchOptions, 'signal');
  if (signalDescriptor && Object.hasOwn(signalDescriptor, 'value') && signalDescriptor.value != null) {
    const owner = options.signalOwner || 'the load invocation';
    throw new Error(`${label} fetchOptions.signal is not supported; ${owner} owns the invocation signal`);
  }
  return snapshotValue(fetchOptions, 'fetchOptions', new Set(), label);
}
