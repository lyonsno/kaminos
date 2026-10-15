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

// The note travels in the address hash beside the saved scene, so a saved
// flame scene's trip through its preset page keeps it.
export function noteLink(note, origin = note?.subject?.source?.origin) {
  if (!origin) return null;
  const hash = new URLSearchParams();
  if (note?.subject?.scene) hash.set('scene', note.subject.scene);
  hash.set('note', note.id);
  return `${origin}/index.html#${hash}`;
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

// The view a note was written from: its camera, selection, served code and
// picture, as the agent should read them.
function viewLines(note, root) {
  const lines = [];
  const source = note.subject?.source;
  if (source) lines.push(`served by ${source.branch}@${String(source.commit).slice(0, 7)}${source.dirty ? ' (uncommitted changes)' : ''} at ${source.origin}`);
  const view = note.context?.view;
  if (view) lines.push(`camera: position ${numbers(view.position)} target ${numbers(view.target)} fov ${numbers(view.fov)}`);
  const selection = note.context?.selection;
  if (selection?.ids?.length) lines.push(`selection: ${selection.ids.join(', ')}`);
  if (note.picture) lines.push(`picture: ${root}/${note.picture.file} (${note.picture.width}x${note.picture.height})`);
  if (note.context?.pictureIssue) lines.push(`picture problem: ${note.context.pictureIssue}`);
  return lines;
}

// Everything an agent needs to act on a note without asking what it means. A
// reply is described with its own view; the thread's opening view follows,
// labeled, so one is never presented as the other.
// One shell word, quoted only when it needs to be (an IPv6 host's brackets would glob).
export const shellArg = value => /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${String(value).replace(/'/g, `'\\''`)}'`;

export function describeNote(state, id, {root, as = null, server = null}) {
  const target = state.notes.get(id);
  if (!target) throw new Error(`No note ${id} in this log`);
  const thread = state.notes.get(target.thread) ?? target;
  const reply = thread.id !== target.id;
  const where = `${anchorText(thread.anchor)}${thread.subject?.scene ? ` in scene ${thread.subject.scene}` : ''}`;
  const lines = [`Kaminos note ${target.id} from ${target.author} (${target.via}) at ${target.at}`];
  lines.push(reply ? `a reply in thread ${thread.id} on ${where}` : `on ${where}`);
  const own = viewLines(target, root);
  const recorded = target.context?.view || target.picture || target.context?.selection?.ids?.length;
  if (reply && !recorded) lines.push(...own.filter(line => line.startsWith('served by')), 'no view was recorded with this note');
  else lines.push(...own);
  if (reply) {
    const opening = viewLines(thread, root).filter(line => !line.startsWith('served by'));
    if (opening.length) lines.push(`thread opened by ${thread.author} with:`, ...opening.map(line => `  ${line}`));
  }
  const delivered = Object.entries(thread.receipts.delivered).map(([name, receipt]) => `delivered to ${name} (${receipt.route})`);
  lines.push([thread.to?.length ? `to: ${thread.to.join(', ')}` : 'to: anyone', ...delivered, thread.resolved ? 'resolved' : 'open'].join(' \u00b7 '));
  lines.push(`> ${thread.text || '(picture)'}`);
  for (const answer of thread.replies) lines.push(...describeLines(answer, root, 1, target.id));
  // Given who is reading and through which server, the reply is a command to run as is.
  lines.push(`reply: node tools/notes.mjs${server ? ` --server ${shellArg(server)}` : ''} reply ${target.id} "<your reply>" --as ${as || '<your name>'} [--picture <png>]`);
  const link = noteLink(thread);
  if (link) lines.push(`open: ${link}`);
  return lines.join('\n');
}


// --- @mentions --------------------------------------------------------------

const MENTION = /(^|[\s(,;])@([a-z0-9][a-z0-9._-]{0,63})/gi;
const MENTION_AT_CARET = /(^|[\s(,;])@([a-z0-9._-]{0,64})$/i;

// Every @name written in a text, lowercased, first occurrence first.
export const mentionsIn = text => [...new Set([...String(text ?? '').matchAll(MENTION)].map(match => match[2].toLowerCase()))];

// The @word being typed where the caret is, or null.
export function mentionQueryAt(text, caret) {
  const value = String(text ?? '');
  const match = value.slice(0, caret).match(MENTION_AT_CARET);
  if (!match || /^[a-z0-9._-]/i.test(value.slice(caret))) return null;
  return {start: caret - match[2].length - 1, end: caret, query: match[2].toLowerCase()};
}

// Names that start with what was typed come before names that contain it;
// within each, agents listening now come first.
export function rankParticipants(participants, query) {
  const typed = String(query ?? '').toLowerCase();
  const score = person => person.name.startsWith(typed) ? 0 : person.name.includes(typed) ? 1 : 2;
  return participants.filter(person => score(person) < 2)
    .sort((a, b) => score(a) - score(b) || Number(!!b.listening) - Number(!!a.listening) || a.name.localeCompare(b.name));
}

// Replace the @word being typed with @name, and put the caret after it.
export function completeMention(text, caret, name) {
  const found = mentionQueryAt(text, caret);
  if (!found) return null;
  const value = String(text), after = value.slice(caret), space = after.startsWith(' ') ? '' : ' ';
  return {text: `${value.slice(0, found.start)}@${name}${space}${after}`, caret: found.start + 1 + name.length + space.length};
}

// Only @names someone could answer to address anyone; other @words stay text.
export function addresseesIn(text, known) {
  const names = new Set([...known].map(name => String(name).toLowerCase()));
  const recognized = [], unknown = [];
  for (const name of mentionsIn(text)) (names.has(name) ? recognized : unknown).push(name);
  return {recognized, unknown};
}
