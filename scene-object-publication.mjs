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

export function createSceneObjectPublicationGuard({getMutationToken, isCurrent}) {
  if (typeof getMutationToken !== 'function') {
    throw new TypeError('Scene object publication guard requires a mutation-token reader');
  }
  const mutationToken = getMutationToken();
  return () => getMutationToken() === mutationToken
    && (typeof isCurrent !== 'function' || isCurrent());
}
