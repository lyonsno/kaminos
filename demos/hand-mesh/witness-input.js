// Runs inside the witness browser as well as the small contract tests.
// Playback consumes this Blob, rather than fetching the URL again after checking.
export async function verifyVideoResponse({ response, expectedSha256, sourceUrl }) {
  if (!response.ok) throw Error(`fixture HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  if (sha256 !== expectedSha256) throw Error(`fixture SHA-256 mismatch: retained ${expectedSha256}, played ${sha256}`);
  return { blob: new Blob([bytes], { type: 'video/webm' }), identity: { sha256, byteLength: bytes.byteLength, requestedUrl: sourceUrl, effectiveUrl: response.url || sourceUrl, verifiedBlob: true } };
}
