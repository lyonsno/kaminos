// The observed Chrome154 / Node25 WebSocket route closes on a 12MiB response.
// Keep the complete immutable JSON in one remote object and transfer every
// character in smaller messages. This changes message size, never data retained.
export async function evaluateJsonTransfer(client, expression, {onProgress = () => {}} = {}) {
  const checked = response => {
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result;
  };
  const remote = checked(await client.call('Runtime.evaluate', {
    expression: `(async () => { const json = JSON.stringify(await (${expression})); if (typeof json !== 'string') throw Error('Capture is not JSON serializable'); return Object.freeze({json}); })()`,
    returnByValue: false, awaitPromise: true,
  }));
  if (!remote?.objectId) throw new Error('Capture remote object missing');
  try {
    const read = async (functionDeclaration, args) => checked(await client.call('Runtime.callFunctionOn', {
      objectId: remote.objectId, functionDeclaration, returnByValue: true,
      arguments: args?.map(value => ({value})),
    })).value;
    const length = await read('function() { return this.json.length; }');
    if (!Number.isSafeInteger(length) || length < 1) throw new Error('Invalid capture JSON length');
    const parts = [];
    const messageChars = 1024 * 1024;
    for (let start = 0; start < length; start += messageChars) {
      const end = Math.min(start + messageChars, length);
      const part = await read('function(start, end) { return this.json.slice(start, end); }', [start, end]);
      if (typeof part !== 'string' || part.length !== end - start) throw new Error(`Capture chunk length mismatch at ${start}`);
      parts.push(part);
      onProgress({receivedChars: end, totalChars: length});
    }
    return JSON.parse(parts.join(''));
  } finally {
    await client.call('Runtime.releaseObject', {objectId: remote.objectId});
  }
}
