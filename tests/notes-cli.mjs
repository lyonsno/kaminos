// kaminos-test: node
// tools/notes.mjs against a real serve.py: an agent waits, wakes with a note
// from the page, reads everything it needs, and answers into the same thread.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {execFile, spawn} from 'node:child_process';
import {mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const cli = path.join(repo, 'tools', 'notes.mjs');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const dataUrl = `data:image/png;base64,${PNG.toString('base64')}`;

const freePort = () => new Promise(resolve => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => { const {port} = server.address(); server.close(() => resolve(port)); });
});

const request = (url, {method = 'GET', body, headers = {}} = {}) => new Promise((resolve, reject) => {
  const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const req = http.request(url, {method, headers: {...(data ? {'Content-Type': 'application/json', 'Content-Length': data.length} : {}), ...headers}}, response => {
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => {
      const raw = Buffer.concat(chunks);
      resolve({status: response.statusCode, body: (response.headers['content-type'] || '').startsWith('application/json') ? JSON.parse(raw) : raw});
    });
  });
  req.on('error', reject);
  if (data) req.write(data);
  req.end();
});

// A page's identity: the token its event stream hands it.
const openPage = (base, pageId) => new Promise((resolve, reject) => {
  const req = http.get(`${base}/api/notes/stream?page=${pageId}&after=0`, response => {
    if (response.statusCode !== 200) {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => reject(new Error(`notes stream answered ${response.statusCode}: ${body.slice(0, 200)}`)));
      return;
    }
    let buffer = '';
    response.on('data', chunk => {
      buffer += chunk;
      const match = buffer.match(/event: hello\ndata: (.*)\n\n/);
      if (match) {
        const hello = JSON.parse(match[1]);
        response.removeAllListeners('data');
        response.resume();
        resolve({hello, headers: {'X-Kaminos-Notes-Page': pageId, 'X-Kaminos-Notes-Token': hello.token}, close: () => req.destroy()});
      }
    });
  });
  req.on('error', reject);
});

async function startServer(t) {
  const port = await freePort();
  const tmp = mkdtempSync(path.join(tmpdir(), 'kaminos-notes-cli-'));
  const root = path.join(tmp, 'notes');
  const server = spawn('python3', [path.join(repo, 'serve.py'), String(port)], {cwd: repo, stdio: ['ignore', 'ignore', 'pipe'],
    env: {...process.env, KAMINOS_BIND_HOST: '127.0.0.1', KAMINOS_NOTES_ROOT: root, KAMINOS_NOTES_PAGE_AUTHOR: 'noah'}});
  let stderr = '';
  server.stderr.on('data', chunk => { stderr += chunk; });
  t.after(() => { server.kill(); rmSync(tmp, {recursive: true, force: true}); });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30000;
  for (;;) {
    try { const answer = await request(`${base}/api/roots`); if (answer.status === 200) break; } catch {}
    if (server.exitCode !== null || Date.now() > deadline) throw new Error(`serve.py did not start: ${stderr}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return {base, root, tmp};
}

const run = (args, env = {}) => new Promise(resolve => {
  execFile(process.execPath, [cli, ...args], {env: {...process.env, KAMINOS_NOTES_AS: '', ...env}, timeout: 30000},
    (error, stdout, stderr) => resolve({code: error ? (error.code ?? 1) : 0, stdout, stderr}));
});

const events = async base => (await request(`${base}/api/notes`)).body.events;

test('an agent waits, wakes with the note and its context, and answers into the thread', {timeout: 60000}, async t => {
  const {base, root, tmp} = await startServer(t);
  const page = await openPage(base, 'page-aaaaaaaa');
  t.after(page.close);
  const waiting = run(['--server', base, 'wait', '--as', 'notes-agent']);
  await new Promise(resolve => setTimeout(resolve, 400));
  const posted = await request(`${base}/api/notes`, {method: 'POST', headers: page.headers, body: {
    kind: 'note', text: 'why is the rim clipped here?', to: ['notes-agent'],
    anchor: {kind: 'object', id: 'cube', label: 'Cube'}, subject: {scene: 'bench.kaminos.json'},
    context: {view: {position: [0, 1, 3], target: [0, 1, 0], up: [0, 1, 0], fov: 45, near: 0.1, far: 100}, selection: {ids: ['cube'], activeId: 'cube'}},
    picture: {dataUrl}}});
  assert.equal(posted.status, 200, JSON.stringify(posted.body));
  const id = posted.body.id;
  const woke = await waiting;
  assert.equal(woke.code, 0, woke.stderr);
  for (const expected of [id, 'from noah (page)', 'object "Cube" (cube)', 'scene bench.kaminos.json', 'selection: cube',
    `picture: ${realpathSync(root)}/pictures/${id}.png (1x1)`, '> why is the rim clipped here?',
    // What to run next is spelled out with this server and name, nothing to fill in but the words.
    `reply: node tools/notes.mjs --server ${base} reply ${id} "<your reply>" --as notes-agent`,
    `keep listening: node tools/notes.mjs --server ${base} wait --as notes-agent`]) {
    assert.ok(woke.stdout.includes(expected), `wait output names ${expected}:\n${woke.stdout}`);
  }
  assert.deepEqual(readFileSync(path.join(root, 'pictures', `${id}.png`)), PNG);

  const answer = path.join(tmp, 'answer.png');
  writeFileSync(answer, PNG);
  const replied = await run(['--server', base, 'reply', id, 'the near plane cuts it at this zoom', '--as', 'notes-agent', '--picture', answer]);
  assert.equal(replied.code, 0, replied.stderr);
  const reply = (await events(base)).find(event => event.type === 'note' && event.parent === id);
  assert.ok(reply, 'the reply is in the log');
  assert.deepEqual(reply.recipients, ['noah'], 'the reply goes back to the person who asked');
  assert.equal(reply.via, 'cli');
  assert.equal(reply.picture.width, 1);
  assert.ok(replied.stdout.includes(reply.id), replied.stdout);

  const shown = await run(['--server', base, 'show', `Kaminos note ${id} on "Cube"`]);
  assert.equal(shown.code, 0, shown.stderr);
  assert.ok(shown.stdout.includes('notes-agent: the near plane cuts it at this zoom'), shown.stdout);
  const json = await run(['--server', base, '--json', 'show', id]);
  assert.equal(JSON.parse(json.stdout).note.replies[0].id, reply.id);
  const delivered = (await events(base)).find(event => event.type === 'delivered');
  assert.deepEqual(delivered.notes, [id]);
  assert.equal(delivered.recipient, 'notes-agent');
});

test('the inbox holds what has not been seen, and seen clears it', {timeout: 60000}, async t => {
  const {base} = await startServer(t);
  const page = await openPage(base, 'page-bbbbbbbb');
  t.after(page.close);
  const ids = [];
  for (const text of ['first', 'second']) {
    const posted = await request(`${base}/api/notes`, {method: 'POST', headers: page.headers,
      body: {kind: 'note', text, to: ['sub-pilot'], anchor: {kind: 'scene'}}});
    ids.push(posted.body.id);
  }
  const inbox = await run(['--server', base, 'inbox', '--as', 'sub-pilot']);
  assert.equal(inbox.code, 0, inbox.stderr);
  assert.ok(ids.every(id => inbox.stdout.includes(id)), inbox.stdout);
  const seen = await run(['--server', base, 'seen', ids[0]], {KAMINOS_NOTES_AS: 'sub-pilot'});
  assert.equal(seen.code, 0, seen.stderr);
  const after = await run(['--server', base, 'inbox', '--as', 'sub-pilot']);
  assert.ok(!after.stdout.includes(ids[0]) && after.stdout.includes(ids[1]), after.stdout);
});

test('an agent posts on an object for the person, and may not post under their name', {timeout: 60000}, async t => {
  const {base, tmp} = await startServer(t);
  const picture = path.join(tmp, 'burner.png');
  writeFileSync(picture, PNG);
  const posted = await run(['--server', base, 'post', 'moved the burner 0.3 m; does the plume look right from here?',
    '--as', 'notes-agent', '--on', 'burner', '--label', 'Burner', '--scene', 'kiln.kaminos.json', '--to', '@noah', '--picture', picture]);
  assert.equal(posted.code, 0, posted.stderr);
  const note = (await events(base)).at(-1);
  assert.deepEqual(note.anchor, {kind: 'object', id: 'burner', label: 'Burner'});
  assert.deepEqual(note.recipients, ['noah']);
  assert.equal(note.subject.scene, 'kiln.kaminos.json');
  const impostor = await run(['--server', base, 'post', 'land it', '--as', 'noah', '--on', 'scene']);
  assert.equal(impostor.code, 1);
  assert.match(impostor.stderr, /reserved/i);
  assert.equal((await events(base)).length, 1, 'the refused post wrote nothing');
});

test('wait gives up loudly when no server answers', {timeout: 60000}, async () => {
  const port = await freePort();
  const started = Date.now();
  const result = await run(['--server', `http://127.0.0.1:${port}`, 'wait', '--as', 'notes-agent', '--give-up-after', '1']);
  assert.equal(result.code, 3, result.stderr);
  assert.match(result.stderr, /could not reach/i);
  assert.ok(Date.now() - started < 10000);
});

test('arguments are checked before anything is sent', {timeout: 60000}, async () => {
  const unused = `http://127.0.0.1:${await freePort()}`;
  for (const args of [['post', 'hello'], ['reply', 'not-an-id', 'x', '--as', 'a'], ['wait'], ['shout', 'x'], ['post', 'x', '--as', 'Bad Name', '--on', 'scene']]) {
    const result = await run(['--server', unused, ...args]);
    assert.equal(result.code, 2, `${args.join(' ')} -> ${result.code} ${result.stderr}`);
  }
});

test('an agent registers itself and is listed among who can be addressed', {timeout: 60000}, async t => {
  const {base} = await startServer(t);
  const joined = await run(['--server', base, 'register', '--as', 'helper-agent', '--about', 'reads fluid notes', '--avatar', 'vantage-helper']);
  assert.equal(joined.code, 0, joined.stderr);
  const listed = await run(['--server', base, 'participants']);
  assert.equal(listed.code, 0, listed.stderr);
  assert.ok(listed.stdout.includes('helper-agent') && listed.stdout.includes('reads fluid notes') && listed.stdout.includes('avatar vantage-helper'), listed.stdout);
  assert.ok(listed.stdout.includes('noah (person)'), listed.stdout);
  const nameless = await run(['--server', base, 'register']);
  assert.equal(nameless.code, 2, nameless.stderr);
});
