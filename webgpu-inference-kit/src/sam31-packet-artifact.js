function sha256Hex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifySam31PacketFloat32Bytes(entry, buffer) {
  if (!entry?.file || !entry.sha256 || !Number.isInteger(entry.byteLength)) {
    throw new Error('tensor manifest entry is incomplete');
  }
  if (!(buffer instanceof ArrayBuffer)) throw new TypeError('tensor artifact must be an ArrayBuffer');
  if (buffer.byteLength !== entry.byteLength || buffer.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error(`tensor byte length mismatch for ${entry.role}: ${buffer.byteLength} != ${entry.byteLength}`);
  }
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const actualSha256 = `sha256:${sha256Hex(new Uint8Array(digest))}`;
  if (actualSha256 !== entry.sha256) {
    throw new Error(`tensor byte hash mismatch for ${entry.role}: ${actualSha256} != ${entry.sha256}`);
  }
  return new Float32Array(buffer);
}
