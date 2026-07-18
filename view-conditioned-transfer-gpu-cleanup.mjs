export async function runCleanupActions(actions) {
  const errors = [];
  for (const action of actions) {
    if (!action || typeof action.label !== 'string' || typeof action.run !== 'function') {
      throw new TypeError('cleanup actions require a label and run function');
    }
    try {
      await action.run();
    } catch (error) {
      errors.push({
        label: action.label,
        name: error?.name || 'Error',
        message: error?.message || String(error),
        stack: error?.stack || null,
      });
    }
  }
  return errors;
}

export async function closeWritable(stream) {
  if (!stream || stream.closed || stream.destroyed || stream.writableEnded) return;
  await new Promise((resolveClose, rejectClose) => {
    const onError = error => rejectClose(error);
    stream.once('error', onError);
    stream.end(() => {
      stream.off('error', onError);
      resolveClose();
    });
  });
}
