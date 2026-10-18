export function createRetainedSetup({document, validate = () => {}}) {
  const clone = value => structuredClone(value);
  const checked = value => { const copy = clone(value); validate(copy); return copy; };
  let value = checked(document), revision = 0;
  const undo = [], redo = [];
  const read = () => ({revision, document: clone(value), undoCount: undo.length, redoCount: redo.length});
  return {
    read,
    replace(document) { value = checked(document); revision++; undo.length = redo.length = 0; return read(); },
    undo() { if (!undo.length) return false; redo.push(value); value = undo.pop(); revision++; return read(); },
    redo() { if (!redo.length) return false; undo.push(value); value = redo.pop(); revision++; return read(); },
    prepare({observe, project}) {
      const baseline = clone(value), observed = clone(observe()), expectedRevision = revision;
      const describe = () => {
        if (revision !== expectedRevision) throw Error('Setup changed; open a new proposal');
        const result = project({baseline:clone(baseline),observed:clone(observed),choices:{},describeOnly:true});
        if (!Array.isArray(result?.groups)) throw Error('Setup projection requires semantic groups');
        return {groups:clone(result.groups)};
      };
      const preview = (choices = {}) => {
        if (revision !== expectedRevision) throw Error('Setup changed; open a new proposal');
        const result = project({baseline: clone(baseline), observed: clone(observed), choices: clone(choices)});
        if (!result || !Array.isArray(result.groups)) throw Error('Setup projection requires semantic groups');
        return {...clone(result), document: checked(result.document)};
      };
      return {describe, preview, commit(choices) {
        const next = preview(choices).document;
        undo.push(value); redo.length = 0; value = next; revision++;
        return read();
      }};
    },
  };
}
