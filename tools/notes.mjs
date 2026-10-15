#!/usr/bin/env node
// Talk about Kaminos work from a terminal: wait for notes people leave on the
// scene, read them with their context, and answer into the same thread.
// `node tools/notes.mjs --help`; docs/notes.md describes the whole flow.
import {readFileSync} from 'node:fs';
import {checkedPost, describeNote, foldNotes, formatRef, normalizeName, notesFor, parseRef} from '../notes-core.mjs';

const USAGE = `Kaminos notes from a terminal.

  node tools/notes.mjs [--server URL] [--json] <command> ...

Waiting and reading
  wait --as NAME [--timeout S] [--give-up-after S]
                       Block until a note for NAME arrives, then print it with its
                       context and exit. Run it in the background to be woken.
  inbox --as NAME [--all]
                       Notes for NAME not yet marked seen (--all: every note for NAME).
  show REF             A note and its thread. REF is a note id, the text copied from
                       the page, or a note link.
  list [--scene FILE] [--all]
                       Open threads (--all: resolved ones too).
  presence             Who is listening, and which pages are open.
  participants         Everyone a note can be addressed to, and who is listening.

Writing
  reply REF TEXT --as NAME [--to NAMES] [--picture PNG] [--urgent]
  post TEXT --as NAME [--on scene|OBJECT-ID] [--label LABEL] [--scene FILE]
           [--to NAMES] [--picture PNG] [--urgent]
  seen REF... --as NAME      resolve REF --as NAME      reopen REF --as NAME
  ref REF              Print the text to paste into a conversation.
  register --as NAME [--about TEXT]
                       Say who you are, so people can @mention you from the page.

NAME may also come from KAMINOS_NOTES_AS. The server is --server, else
KAMINOS_NOTES_SERVER, else KAMINOS_VANTAGE_SERVER, else http://127.0.0.1:8090.
Any Kaminos server on this machine works: they share one notes log.

Exit codes: 1 the server refused, 2 invalid arguments, 3 no server answered,
4 --timeout passed with nothing to read.`;

const BOOLEAN = new Set(['json', 'all', 'urgent', 'help']);
class Usage extends Error {}
class Unreachable extends Error {}
class Refused extends Error {}

function parse(argv) {
  const flags = {}, positional = [];
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) { positional.push(token); continue; }
    const [name, inline] = token.slice(2).split(/=(.*)/s);
    if (BOOLEAN.has(name)) { flags[name] = true; continue; }
    const value = inline ?? argv[++index];
    if (value === undefined) throw new Usage(`--${name} needs a value`);
    flags[name] = value;
  }
  return {flags, positional};
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function client(base) {
  const call = async (path, {method = 'GET', body} = {}) => {
    let response;
    try {
      response = await fetch(`${base}${path}`, body === undefined ? {method} : {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    } catch (error) {
      throw new Unreachable(`could not reach the Kaminos server at ${base} (${error.cause?.code || error.message}). Start one with python3 serve.py <port> and point --server or KAMINOS_NOTES_SERVER at it.`);
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Refused(`${data?.phase || response.status}: ${data?.error || response.statusText}`);
    return data;
  };
  return {
    call,
    async state() {
      const listing = await call('/api/notes');
      return {state: foldNotes(listing.events), root: listing.root, listing};
    },
  };
}

const who = flags => {
  const raw = flags.as ?? process.env.KAMINOS_NOTES_AS;
  if (!raw) throw new Usage('Say who you are with --as NAME (or KAMINOS_NOTES_AS)');
  try { return normalizeName(raw); } catch (error) { throw new Usage(error.message); }
};
const refOf = text => { try { return parseRef(text); } catch (error) { throw new Usage(error.message); } };
const pictureOf = file => {
  if (!file) return undefined;
  let data;
  try { data = readFileSync(file); } catch (error) { throw new Usage(`Cannot read --picture ${file}: ${error.message}`); }
  return {dataUrl: `data:image/png;base64,${data.toString('base64')}`};
};
const composed = raw => { try { return checkedPost(raw); } catch (error) { throw new Usage(error.message); } };
const jsonNote = note => JSON.parse(JSON.stringify(note));

async function main(argv) {
  const {flags, positional} = parse(argv);
  const [command, ...args] = positional;
  if (flags.help || !command) { console.log(USAGE); return flags.help ? 0 : 2; }
  const base = (flags.server || process.env.KAMINOS_NOTES_SERVER || process.env.KAMINOS_VANTAGE_SERVER || 'http://127.0.0.1:8090').replace(/\/+$/, '');
  const api = client(base);
  const print = (text, json) => console.log(flags.json ? JSON.stringify(json, null, 2) : text);

  switch (command) {
    case 'post': {
      const as = who(flags);
      if (args.length !== 1) throw new Usage('post takes the note text as one argument');
      const on = flags.on ?? 'scene';
      const anchor = on === 'scene' ? {kind: 'scene'} : {kind: 'object', id: on, label: flags.label ?? on};
      const content = composed({kind: 'note', text: args[0], to: flags.to ?? [], anchor, subject: {scene: flags.scene ?? null},
        picture: pictureOf(flags.picture), urgent: !!flags.urgent});
      const note = await api.call('/api/notes', {method: 'POST', body: {...content, author: as}});
      print(`posted ${note.id} on ${note.anchor.kind === 'object' ? `"${note.anchor.label}"` : 'the scene'}${note.recipients.length ? ` for ${note.recipients.join(', ')}` : ''}`, note);
      return 0;
    }
    case 'reply': {
      if (args.length !== 2) throw new Usage('reply takes a note reference and the reply text');
      const parent = refOf(args[0]);
      const as = who(flags);
      const content = composed({kind: 'note', text: args[1], parent, to: flags.to ?? [], picture: pictureOf(flags.picture), urgent: !!flags.urgent});
      const note = await api.call('/api/notes', {method: 'POST', body: {...content, author: as}});
      print(`replied ${note.id} in thread ${note.thread}${note.recipients.length ? ` for ${note.recipients.join(', ')}` : ''}`, note);
      return 0;
    }
    case 'show': {
      if (args.length !== 1) throw new Usage('show takes one note reference');
      const id = refOf(args[0]);
      const {state, root} = await api.state();
      if (!state.notes.has(id)) throw new Refused(`note: no note ${id} in the log at ${root}`);
      const note = state.notes.get(id);
      print(describeNote(state, id, {root}), {note: jsonNote(state.notes.get(note.thread) ?? note), target: id, root});
      return 0;
    }
    case 'ref': {
      if (args.length !== 1) throw new Usage('ref takes one note reference');
      const id = refOf(args[0]);
      const {state} = await api.state();
      if (!state.notes.has(id)) throw new Refused(`note: no note ${id}`);
      print(formatRef(state.notes.get(id)), {id, text: formatRef(state.notes.get(id))});
      return 0;
    }
    case 'list': {
      const {state} = await api.state();
      const threads = state.threads.filter(note => note.kind !== 'ref' && (flags.all || !note.resolved)
        && (!flags.scene || note.subject?.scene === flags.scene));
      const line = note => {
        const count = (function total(n) { return n.replies.reduce((sum, reply) => sum + 1 + total(reply), 0); })(note);
        const where = note.anchor?.kind === 'object' ? `"${note.anchor.label}"` : 'the scene';
        return `${note.id} [${note.resolved ? 'resolved' : 'open'}] on ${where}${note.subject?.scene ? ` in ${note.subject.scene}` : ''} - ${note.author}: ${note.text || '(picture)'}${count ? ` (${count} repl${count === 1 ? 'y' : 'ies'})` : ''}`;
      };
      print(threads.length ? threads.map(line).join('\n') : 'No open threads.', threads.map(jsonNote));
      return 0;
    }
    case 'inbox': {
      const as = who(flags);
      const {state, root} = await api.state();
      const notes = notesFor(state, as, {unseen: !flags.all});
      print(notes.length ? notes.map(note => describeNote(state, note.id, {root})).join('\n\n')
        : `Nothing ${flags.all ? '' : 'unseen '}for ${as}.`, notes.map(jsonNote));
      return 0;
    }
    case 'wait': {
      const as = who(flags);
      const timeout = flags.timeout === undefined ? Infinity : Number(flags.timeout);
      const giveUp = Number(flags['give-up-after'] ?? 120);
      if (!(timeout > 0) || !(giveUp > 0)) throw new Usage('--timeout and --give-up-after are positive numbers of seconds');
      const started = Date.now();
      let unreachableSince = null;
      for (;;) {
        const left = (timeout - (Date.now() - started) / 1000);
        if (left <= 0) { console.error(`Nothing for ${as} within ${flags.timeout} s.`); return 4; }
        let answer;
        try {
          answer = await api.call(`/api/notes/wait?as=${encodeURIComponent(as)}&timeout=${Math.min(25, Math.ceil(left))}`);
          unreachableSince = null;
        } catch (error) {
          if (!(error instanceof Unreachable)) throw error;
          unreachableSince ??= Date.now();
          if ((Date.now() - unreachableSince) / 1000 >= giveUp) throw error;
          await sleep(1000);
          continue;
        }
        if (!answer.notes.length) continue;
        const {state, root} = await api.state();
        const text = answer.notes.map(note => describeNote(state, note.id, {root})).join('\n\n');
        print(`${answer.notes.length} Kaminos note${answer.notes.length === 1 ? '' : 's'} for ${as}\n\n${text}\n\nRun wait again to keep listening.`,
          {for: as, root, notes: answer.notes.map(note => jsonNote(state.notes.get(note.id)))});
        return 0;
      }
    }
    case 'seen':
    case 'resolve':
    case 'reopen': {
      const as = who(flags);
      if (!args.length) throw new Usage(`${command} takes one or more note references`);
      const type = {seen: 'seen', resolve: 'resolved', reopen: 'reopened'}[command];
      const receipt = await api.call('/api/notes/receipt', {method: 'POST', body: {type, notes: args.map(refOf), author: as}});
      print(`${type} ${receipt.notes.join(', ')}`, receipt);
      return 0;
    }
    case 'register': {
      const as = who(flags);
      const record = await api.call('/api/notes/participants', {method: 'POST', body: {author: as, about: flags.about ?? ''}});
      print(`registered @${record.name}${record.about ? ` \u00b7 ${record.about}` : ''}`, record);
      return 0;
    }
    case 'participants': {
      const {participants, directoryProblem} = await api.call('/api/notes/participants');
      if (directoryProblem) console.error(directoryProblem);
      const line = row => `@${row.name} (${row.kind})${row.listening ? ' \u00b7 listening' : ''}${row.about ? ` \u00b7 ${row.about}` : ''} \u00b7 ${row.sources.join(', ')}`;
      print(participants.length ? participants.map(line).join('\n') : 'No one yet.', participants);
      return 0;
    }
    case 'presence': {
      const presence = await api.call('/api/notes/presence');
      const listeners = presence.listeners.map(row => `${row.name} ${row.waiting ? 'listening' : 'just left'} since ${row.since}`);
      const pages = presence.pages.map(page => `page ${page.id} (${page.author}) open since ${page.since}`);
      print([...listeners, ...pages].join('\n') || 'Nobody is listening and no page is open on this server.', presence);
      return 0;
    }
    default:
      throw new Usage(`Unknown command ${JSON.stringify(command)}. node tools/notes.mjs --help lists them.`);
  }
}

main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
  if (error instanceof Usage) { console.error(error.message); process.exitCode = 2; }
  else if (error instanceof Unreachable) { console.error(error.message); process.exitCode = 3; }
  else if (error instanceof Refused) { console.error(`refused (${error.message})`); process.exitCode = 1; }
  else { console.error(error.stack || String(error)); process.exitCode = 1; }
});
