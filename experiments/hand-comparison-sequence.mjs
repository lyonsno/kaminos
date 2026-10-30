export function comparisonSequence(report) {
  if (report.status !== 'rendered' || report.authority !== 'recorded_diagnostic_not_live'
      || report.interactionAuthority !== false || !Array.isArray(report.errors) || report.errors.length) {
    throw Error('expected successful recorded diagnostic evidence');
  }
  const frames = structuredClone(report.frames);
  if (!Array.isArray(frames) || !frames.length || frames.length !== report.decodedVideoFrames) {
    throw Error('partial frame sequence');
  }
  frames.forEach((frame, i) => {
    if (!/^frames\/[0-9]+\.png$/.test(frame.file) || !Number.isFinite(frame.captureOffsetMs)
        || !Number.isInteger(frame.sourceSequence)
        || (i && (frame.captureOffsetMs <= frames[i-1].captureOffsetMs
          || frame.sourceSequence <= frames[i-1].sourceSequence))) throw Error('invalid frame chronology');
  });
  const start = frames[0].captureOffsetMs;
  return {
    length: frames.length,
    durationMs: frames.at(-1).captureOffsetMs - start,
    frame(index) {
      if (!Number.isInteger(index) || index < 0 || index >= frames.length) throw Error('invalid frame index');
      return structuredClone(frames[index]);
    },
    atTime(ms) {
      if (!Number.isFinite(ms) || ms < 0) throw Error('invalid time');
      let index = 0;
      while (index + 1 < frames.length && frames[index+1].captureOffsetMs - start <= ms) index++;
      return index;
    },
  };
}
