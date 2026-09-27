export function assertServedSourceIdentity(local, served) {
  for (const [file, hash] of Object.entries(local)) {
    if (served[file] !== hash) throw new Error(`served source mismatch: ${file}`);
  }
  for (const file of Object.keys(served)) {
    if (!(file in local)) throw new Error(`unexpected served source: ${file}`);
  }
  return local;
}
