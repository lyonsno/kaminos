// Both ports accept the same verified bundle from a hosted URL or a local Blob.
// The kit still validates the complete resource manifest and SHA-256 bytes.
export async function readModelPackage({ packageUrl, packageSource, schema, signal }) {
  if (packageUrl && packageSource) throw new Error('choose a URL or a local model package, not both');
  let metadata, source;
  if (packageSource) {
    metadata = packageSource.metadata;
    source = packageSource.bundle;
    if (!(source instanceof Blob)) throw new Error('local model bundle must be a Blob');
  } else {
    if (!packageUrl) throw new Error('a model package URL or local package is required');
    const base = new URL(packageUrl.endsWith('/') ? packageUrl : `${packageUrl}/`, globalThis.location?.href);
    const response = await fetch(new URL('package.json', base), { cache: 'no-store', signal });
    if (!response.ok) throw new Error(`model package: HTTP ${response.status}`);
    metadata = await response.json();
    const file = metadata.resources?.[0]?.file;
    if (typeof file === 'string') source = new URL(file, base);
  }
  if (metadata?.schema !== schema || metadata.status !== 'succeeded') throw new Error(`model package must be a succeeded ${schema}`);
  if (metadata.resources?.length !== 1) throw new Error('model package must hold exactly one resource bundle');
  const row = metadata.resources[0];
  if (!source) throw new Error('model package has no resource source');
  if (source instanceof Blob && source.size !== row.manifest?.bundle?.byteLength) throw new Error('local model bundle size does not match its manifest');
  return { metadata, source, row };
}
