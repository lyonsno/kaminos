const FETCH_OPTION_SNAPSHOT_KIND = Symbol('kaminos.fetch-option-snapshot-kind');
const HeadersConstructor = globalThis.Headers;
const headersAppend = HeadersConstructor?.prototype?.append;
const headersForEach = HeadersConstructor?.prototype?.forEach;

function headerPrimitive(value, path, label) {
  if (
    value == null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
    || typeof value === 'bigint'
  ) return String(value);
  throw new Error(`${label} fetchOptions headers require primitive names and values at ${path}`);
}

function assertOnlyDenseArrayIndexes(value, path, label) {
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    if (typeof key === 'symbol' || !/^(0|[1-9][0-9]*)$/.test(key)) {
      throw new Error(`${label} fetchOptions arrays cannot carry named properties at ${path}`);
    }
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new Error(`${label} fetchOptions require dense data arrays; invalid element at ${path}[${index}]`);
    }
  }
}

function snapshotHeadersInit(value, path, label) {
  if (value == null) return value;
  if (
    typeof HeadersConstructor !== 'function'
    || typeof headersAppend !== 'function'
    || typeof headersForEach !== 'function'
  ) {
    throw new Error(`${label} fetchOptions headers require the platform Headers API`);
  }

  const normalized = new HeadersConstructor();
  if (value instanceof HeadersConstructor) {
    Reflect.apply(headersForEach, value, [
      (headerValue, headerName) => {
        Reflect.apply(headersAppend, normalized, [headerName, headerValue]);
      },
    ]);
  } else if (Array.isArray(value)) {
    assertOnlyDenseArrayIndexes(value, path, label);
    for (let index = 0; index < value.length; index += 1) {
      const tuple = Object.getOwnPropertyDescriptor(value, index).value;
      if (!Array.isArray(tuple) || tuple.length !== 2) {
        throw new Error(`${label} fetchOptions headers ${path}[${index}] must be a two-entry array`);
      }
      assertOnlyDenseArrayIndexes(tuple, `${path}[${index}]`, label);
      const name = headerPrimitive(
        Object.getOwnPropertyDescriptor(tuple, 0).value,
        `${path}[${index}][0]`,
        label,
      );
      const headerValue = headerPrimitive(
        Object.getOwnPropertyDescriptor(tuple, 1).value,
        `${path}[${index}][1]`,
        label,
      );
      Reflect.apply(headersAppend, normalized, [name, headerValue]);
    }
  } else {
    const prototype = typeof value === 'object' ? Object.getPrototypeOf(value) : null;
    if (!value || typeof value !== 'object' || (prototype !== Object.prototype && prototype !== null)) {
      throw new Error(`${label} fetchOptions headers must be Headers, a record, or tuple arrays`);
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === 'symbol') {
        throw new Error(`${label} fetchOptions headers cannot contain symbol keys at ${path}`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new Error(`${label} fetchOptions headers require enumerable data properties at ${path}.${key}`);
      }
      Reflect.apply(headersAppend, normalized, [
        key,
        headerPrimitive(descriptor.value, `${path}.${key}`, label),
      ]);
    }
  }

  const entries = [];
  Reflect.apply(headersForEach, normalized, [
    (headerValue, headerName) => {
      entries.push(Object.freeze([headerName, headerValue]));
    },
  ]);
  return Object.freeze({
    [FETCH_OPTION_SNAPSHOT_KIND]: 'headers',
    entries: Object.freeze(entries),
  });
}

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

  if (typeof HeadersConstructor === 'function' && value instanceof HeadersConstructor) {
    return snapshotHeadersInit(value, path, label);
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

  if (Array.isArray(value)) {
    throw new Error(`${label} fetchOptions arrays are only supported at fetchOptions.headers`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    const name = value.constructor?.name || 'host object';
    throw new Error(`${label} fetchOptions cannot snapshot mutable ${name} at ${path}`);
  }

  ancestors.add(value);
  try {
    const snapshot = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === 'symbol') {
        throw new Error(`${label} fetchOptions cannot snapshot symbol keys at ${path}`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new Error(`${label} fetchOptions require enumerable data properties at ${path}.${key}`);
      }
      const childPath = `${path}.${key}`;
      Object.defineProperty(snapshot, key, {
        value: path === 'fetchOptions' && key === 'headers'
          ? snapshotHeadersInit(descriptor.value, childPath, label)
          : snapshotValue(descriptor.value, childPath, ancestors, label),
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
  if (kind === 'headers') {
    const headers = Object.create(null);
    for (let index = 0; index < snapshot.entries.length; index += 1) {
      const entry = Object.getOwnPropertyDescriptor(snapshot.entries, index).value;
      Object.defineProperty(headers, entry[0], {
        value: entry[1],
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return headers;
  }
  if (kind === 'blob') return snapshot.value;
  if (kind === 'url-search-params') return new globalThis.URLSearchParams(snapshot.value);
  if (kind === 'array-buffer') return Uint8Array.from(snapshot.bytes).buffer;
  if (kind === 'bytes') return Uint8Array.from(snapshot.bytes);
  if (Array.isArray(snapshot)) throw new Error('model resource fetchOptions snapshot contains an unsupported array');
  const value = Object.create(null);
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
