// Shared rules for Kaminos notes. The page, tools/notes.mjs and the tests use
// this one module; serve.py stores the log and stamps what a client may not
// claim (kaminos_notes.py). See docs/notes.md.
export const NOTES_SCHEMA = 'kaminos.notes.v1';
export const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const NOTE_ID_PATTERN = /^kn-[0-9a-z]{8,32}$/;
const PNG_DATA_URL = 'data:image/png;base64,';
// The server stamps these; a client that sends one is confused or forging.
const STAMPED = ['via', 'author', 'id', 'seq', 'recipients', 'thread', 'pageId', 'type', 'at', 'schema'];

export function normalizeName(raw) {
  const name = String(raw ?? '').trim().replace(/^@/, '').toLowerCase();
  if (!NAME_PATTERN.test(name)) {
    throw new Error(`"${raw}" is not a usable name: use letters, digits, dots, dashes or underscores, starting with a letter or digit`);
  }
  return name;
}

export function parseAddressees(input) {
  const parts = Array.isArray(input) ? input : String(input ?? '').split(/[\s,]+/);
  return [...new Set(parts.filter(part => String(part).trim()).map(normalizeName))];
}

export function checkedAnchor(raw) {
  if (raw?.kind === 'scene') return {kind: 'scene'};
  if (raw?.kind === 'object') {
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!id) throw new Error('An object anchor needs the object id');
    const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : id;
    return {kind: 'object', id, label};
  }
  throw new Error(`Unknown anchor ${JSON.stringify(raw?.kind)}: a note goes on the scene or on one object`);
}

function checkedPicture(raw) {
  if (typeof raw?.dataUrl !== 'string' || !raw.dataUrl.startsWith(PNG_DATA_URL)) {
    throw new Error('A picture is a PNG data URL ({dataUrl: "data:image/png;base64,..."})');
  }
  return {dataUrl: raw.dataUrl};
}

const plainJson = (value, what) => {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${what} must be an object`);
  return JSON.parse(JSON.stringify(value));
};

// What a client composes. The CLI adds `author` for itself after this check;
// the server takes a page's author from the page's own link.
export function checkedPost(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('A note must be an object');
  for (const field of STAMPED) if (field in raw) throw new Error(`${field} is stamped by the server, not sent`);
  const kind = raw.kind ?? 'note';
  if (!['note', 'ref'].includes(kind)) throw new Error(`Unknown note kind ${JSON.stringify(kind)}: use note or ref`);
  if (raw.text != null && typeof raw.text !== 'string') throw new Error('Note text must be a string');
  const text = (raw.text ?? '').trim();
  const parent = raw.parent == null ? null : String(raw.parent);
  if (parent !== null && !NOTE_ID_PATTERN.test(parent)) throw new Error(`"${parent}" is not a note id (kn-...)`);
  if (parent !== null && raw.anchor != null) throw new Error("A reply belongs to its thread's anchor; leave the anchor out");
  const anchor = parent === null ? (raw.anchor == null ? null : checkedAnchor(raw.anchor)) : null;
  if (parent === null && !anchor) throw new Error('A new thread needs an anchor: the scene or an object');
  const picture = raw.picture == null ? null : checkedPicture(raw.picture);
  if (kind === 'note' && !text && !picture) throw new Error('A note needs words or a picture');
  const subject = plainJson(raw.subject, 'subject') ?? {};
  if (subject.scene != null && typeof subject.scene !== 'string') throw new Error('subject.scene must be a scene file name');
  if (raw.urgent != null && typeof raw.urgent !== 'boolean') throw new Error('urgent is true or false');
  return {kind, text, to: parseAddressees(raw.to ?? []), parent, anchor, subject: {scene: subject.scene ?? null},
    context: plainJson(raw.context, 'context'), picture, urgent: raw.urgent === true};
}

// Fold the event log into notes, threads and receipts. A bad event is
// reported in `issues` and the rest of the log still folds.
export function foldNotes(events) {
  const notes = new Map(), threads = [], issues = [];
  let lastSeq = 0;
  const known = (event, apply) => {
    for (const id of Array.isArray(event.notes) ? event.notes : []) {
      const note = notes.get(id);
      if (note) apply(note);
      else issues.push({seq: event.seq, problem: `${event.type} names unknown note ${id}`});
    }
  };
  for (const event of events) {
    lastSeq = Math.max(lastSeq, Number(event?.seq) || 0);
    switch (event?.type) {
      case 'note': {
        if (!NOTE_ID_PATTERN.test(String(event.id))) { issues.push({seq: event.seq, problem: 'note without a valid id'}); break; }
        const note = {...event, replies: [], receipts: {delivered: {}, seen: {}}, resolved: false};
        if (event.parent) {
          const parent = notes.get(event.parent);
          if (!parent) { issues.push({seq: event.seq, problem: `reply to unknown note ${event.parent}`}); break; }
          parent.replies.push(note);
          note.anchor = (notes.get(event.thread) ?? parent).anchor;
          // Answering a note means its author has read it.
          parent.receipts.seen[event.author] ??= {at: event.at, seq: event.seq, by: 'reply'};
        } else {
          threads.push(note);
        }
        notes.set(event.id, note);
        break;
      }
      case 'delivered':
        known(event, note => { note.receipts.delivered[event.recipient] = {at: event.at, seq: event.seq, route: event.route}; });
        break;
      case 'seen':
        known(event, note => { note.receipts.seen[event.author] = {at: event.at, seq: event.seq}; });
        break;
      case 'resolved':
      case 'reopened':
        known(event, note => { note.resolved = event.type === 'resolved'; note.resolution = {by: event.author, at: event.at}; });
        break;
      default:
        issues.push({seq: event?.seq ?? null, problem: `unknown event type ${JSON.stringify(event?.type)}`});
    }
  }
  return {notes, threads, issues, lastSeq};
}

// Notes addressed to `name` (explicitly, or as the author of the note answered).
export function notesFor(state, name, {unseen = false} = {}) {
  const who = normalizeName(name);
  return [...state.notes.values()]
    .filter(note => note.kind !== 'ref' && (note.recipients ?? []).includes(who) && (!unseen || !note.receipts.seen[who]))
    .sort((a, b) => a.seq - b.seq);
}

export function parseRef(text) {
  const match = String(text ?? '').match(/kn-[0-9a-z]{8,32}/);
  if (!match) throw new Error('No Kaminos note id (kn-...) in that reference');
  return match[0];
}

export function noteLink(note, origin = note?.subject?.source?.origin) {
  if (!origin) return null;
  const scene = note?.subject?.scene;
  return `${origin}/index.html?note=${note.id}${scene ? `#scene=${encodeURIComponent(scene)}` : ''}`;
}

const anchorText = anchor => anchor?.kind === 'object' ? `object "${anchor.label}" (${anchor.id})` : 'the scene';

// The text a person copies into a conversation with an agent.
export function formatRef(note) {
  const where = note.anchor?.kind === 'object' ? `"${note.anchor.label}"` : 'the scene';
  const scene = note.subject?.scene ? ` in ${note.subject.scene}` : '';
  const link = noteLink(note);
  return `Kaminos note ${note.id} on ${where}${scene}. Read it with: node tools/notes.mjs show ${note.id}${link ? `  Open: ${link}` : ''}`;
}

const numbers = value => Array.isArray(value) ? `[${value.map(n => Number(Number(n).toFixed(3))).join(', ')}]` : String(value);

function describeLines(note, root, depth, focus) {
  const indent = '  '.repeat(depth);
  const mark = note.id === focus && depth > 0 ? '-> ' : '';
  const lines = [`${indent}${mark}${note.author}: ${note.text || '(picture)'}   [${note.id}${note.via === 'page' ? ', page' : ''}]`];
  if (note.picture) lines.push(`${indent}   picture: ${root}/${note.picture.file} (${note.picture.width}x${note.picture.height})`);
  for (const reply of note.replies) lines.push(...describeLines(reply, root, depth + 1, focus));
  return lines;
}

// Everything an agent needs to act on a note without asking what it means.
export function describeNote(state, id, {root}) {
  const target = state.notes.get(id);
  if (!target) throw new Error(`No note ${id} in this log`);
  const thread = state.notes.get(target.thread) ?? target;
  const lines = [`Kaminos note ${target.id} from ${target.author} (${target.via}) at ${target.at}`];
  if (thread.id !== target.id) lines.push(`in reply within thread ${thread.id}`);
  lines.push(`on ${anchorText(thread.anchor)}${thread.subject?.scene ? ` in scene ${thread.subject.scene}` : ''}`);
  const source = thread.subject?.source;
  if (source) lines.push(`served by ${source.branch}@${String(source.commit).slice(0, 7)}${source.dirty ? ' (uncommitted changes)' : ''} at ${source.origin}`);
  const view = thread.context?.view;
  if (view) lines.push(`camera: position ${numbers(view.position)} target ${numbers(view.target)} fov ${numbers(view.fov)}`);
  const selection = thread.context?.selection;
  if (selection?.ids?.length) lines.push(`selection: ${selection.ids.join(', ')}`);
  if (thread.picture) lines.push(`picture: ${root}/${thread.picture.file} (${thread.picture.width}x${thread.picture.height})`);
  if (thread.context?.pictureIssue) lines.push(`picture problem: ${thread.context.pictureIssue}`);
  const delivered = Object.entries(thread.receipts.delivered).map(([name, receipt]) => `delivered to ${name} (${receipt.route})`);
  lines.push([thread.to?.length ? `to: ${thread.to.join(', ')}` : 'to: anyone', ...delivered, thread.resolved ? 'resolved' : 'open'].join(' · '));
  lines.push(`> ${thread.text || '(picture)'}`);
  for (const reply of thread.replies) lines.push(...describeLines(reply, root, 1, target.id));
  lines.push(`reply: node tools/notes.mjs reply ${target.id} "<your reply>" --as <your name> [--picture <png>]`);
  const link = noteLink(thread);
  if (link) lines.push(`open: ${link}`);
  return lines.join('\n');
}
