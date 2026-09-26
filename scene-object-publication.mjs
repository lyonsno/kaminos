export function publishSceneObjectIfCurrent({object, isCurrent = () => true, publish, discard}) {
  if (typeof publish !== 'function') throw new TypeError('Scene object publication requires a publish function');
  if (typeof discard !== 'function') throw new TypeError('Scene object publication requires a discard function');
  if (typeof isCurrent === 'function' && !isCurrent()) {
    discard(object);
    return false;
  }
  publish(object);
  return true;
}
