import assert from 'node:assert/strict';

export function balancedWgslBlock(source, marker, { label = marker } = {}) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing ${label} marker`);
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, `missing ${label} opening brace`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated ${label} block`);
}

export function wgslCallCount(source, name) {
  const pattern = new RegExp(`\\b${name}\\s*\\(`, 'g');
  return [...source.matchAll(pattern)].filter(match => {
    const prefix = source.slice(Math.max(0, match.index - 3), match.index);
    return prefix !== 'fn ';
  }).length;
}

export function assertWgslCallsOwnedByBlock(source, marker, expectedCalls, { label = marker } = {}) {
  const block = balancedWgslBlock(source, marker, { label });
  for (const [name, expectedCount] of Object.entries(expectedCalls)) {
    assert.equal(
      wgslCallCount(block, name),
      expectedCount,
      `${label} must contain exactly ${expectedCount} live ${name} call(s)`,
    );
    assert.equal(
      wgslCallCount(source, name),
      expectedCount,
      `${label} must own every live ${name} call`,
    );
  }
  return block;
}
