#!/usr/bin/env node
// Pilot the agent vantage (the sub) in a live Kaminos page from the terminal.
// Pictures are written as PNG files beside a JSON record of what was asked,
// which page answered, the view, and the objects in frame.
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {checkedCommand, poseAxes, pickRunAt, depthAtPixel, base64ToBytes, DEFAULT_PILOT} from '../agent-vantage-core.mjs';

const USAGE = `Usage: node tools/vantage.mjs [options] <command> [arguments]

Commands
  pages                      linked Kaminos tabs
  status                     subs, operator view and page state
  objects                    scene objects, and where each one is from the sub
  launch [--label L] [--at ahead|operator] [--lens MM]
  remove
  goto X Y Z [--look TARGET]
  move [--forward D] [--right D] [--up D]
  turn [--yaw DEG] [--pitch DEG]     positive yaw turns left, positive pitch looks up
  look TARGET
  orbit TARGET [--radius R] [--azimuth DEG] [--elevation DEG]
  frame TARGET [--margin M]
  align                      move the sub to the operator's view
  snap [--annotate] [--helpers] [--settle FRAMES] [--max-size PX] [--no-map] [--name NAME]
  peek [--annotate] [--clean] [--max-size PX] [--no-map] [--name NAME]     the operator's own view
  burst [--count N] [--interval MS] [--frames] [--annotate] [--cell PX] [--max-size PX] [--no-map] [--depth] [--name NAME]
  map [--size PX]            three-quarter map of the scene with your view cone and each sub's; renders no scene
  sketch                     the scene as named boxes, fields and cameras; renders no scene
  pick X Y [--from sub|operator]      what the renderer draws at a point of the view now; X and Y are fractions from the top left
  pick X Y --picture RECORD.json [--frame N] [--now]   what a kept picture drew at its pixel X Y, from the
                             picture's own pick map; --now casts that picture's camera into the scene as it is now

Pictures carry the map unless --no-map is given, and always a pick map: the renderer's record of which
object it drew at each pixel, with the depth it drew there kept as a file beside the picture (a burst keeps
depth only with --depth). A pick names the pixel its point falls in, through that pixel's centre. A live
pick draws one pixel of a pick map; it never borrows your view.

TARGET is an object id, a label or a unique part of one, "selection", or X Y Z.

Options
  --server URL     Kaminos server (default $KAMINOS_VANTAGE_SERVER or http://127.0.0.1:8484)
  --page ID        page id or unique prefix (default: the focused visible page)
  --pilot NAME     which sub (default $KAMINOS_VANTAGE_PILOT or ${DEFAULT_PILOT})
  --out DIR        picture directory (default $KAMINOS_VANTAGE_OUT or ~/.local/state/kaminos/vantage/<pilot>)
  --timeout S      seconds to wait for the page (default 30; bursts add their duration)
  --json           print the full JSON record instead of a summary`;

const BOOLEAN = new Set(['annotate', 'helpers', 'clean', 'frames', 'json', 'help', 'no-map', 'now', 'depth']);
const VALUED = new Set(['server', 'page', 'pilot', 'out', 'timeout', 'name', 'label', 'at', 'lens', 'look', 'forward', 'right', 'up',
  'yaw', 'pitch', 'radius', 'azimuth', 'elevation', 'margin', 'settle', 'max-size', 'count', 'interval', 'cell', 'size',
  'from', 'picture', 'frame']);

class Exit extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function parse(argv) {
  const options = {}, positional = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) { positional.push(token); continue; }
    const name = token.slice(2);
    if (BOOLEAN.has(name)) options[name] = true;
    else if (VALUED.has(name)) {
      if (i + 1 >= argv.length) throw new Exit(2, `--${name} needs a value`);
      options[name] = argv[++i];
    } else throw new Exit(2, `Unknown option --${name}`);
  }
  return {options, command: positional[0], rest: positional.slice(1)};
}

const number = value => value === undefined ? undefined : Number(value);
const defined = object => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
function targetOf(rest, command) {
  if (!rest.length) throw new Exit(2, `${command} needs a TARGET: an object, "selection", or X Y Z`);
  if (rest.length === 3 && rest.every(token => token.trim() !== '' && Number.isFinite(Number(token)))) return rest.map(Number);
  return rest.join(' ');
}

function commandArgs(command, rest, options, pilot) {
  switch (command) {
    case 'status': return {};
    case 'objects': case 'remove': case 'align': return {pilot};
    case 'launch': return defined({pilot, label: options.label, placement: options.at, lens: number(options.lens)});
    case 'goto':
      if (rest.length !== 3) throw new Exit(2, 'goto needs X Y Z');
      return defined({pilot, position: rest.map(Number), lookAt: options.look});
    case 'move': return defined({pilot, forward: number(options.forward), right: number(options.right), up: number(options.up)});
    case 'turn': return defined({pilot, yaw: number(options.yaw), pitch: number(options.pitch)});
    case 'look': return {pilot, target: targetOf(rest, command)};
    case 'orbit': return defined({pilot, target: targetOf(rest, command), radius: number(options.radius), azimuth: number(options.azimuth), elevation: number(options.elevation)});
    case 'frame': return defined({pilot, target: targetOf(rest, command), margin: number(options.margin)});
    case 'snap': return defined({pilot, settle: number(options.settle), maxSize: number(options['max-size']), annotate: options.annotate, helpers: options.helpers, map: options['no-map'] ? false : undefined});
    case 'peek': return defined({maxSize: number(options['max-size']), annotate: options.annotate, clean: options.clean, map: options['no-map'] ? false : undefined});
    case 'burst': return defined({pilot, count: number(options.count), interval: number(options.interval), settle: number(options.settle),
      maxSize: number(options['max-size']), cell: number(options.cell), annotate: options.annotate, frames: options.frames, map: options['no-map'] ? false : undefined,
      depth: options.depth === true});
    case 'map': return defined({size: number(options.size)});
    case 'sketch': return {};
    case 'pick': return pickArgs(rest, options, pilot);
    default: return {};
  }
}

// A pick names a point as fractions of the view from its top left, or as a
// pixel of a kept picture. A picture's own pick map says what it drew there;
// the page then finds that object and the point on it.
function pickArgs(rest, options, pilot) {
  if (rest.length !== 2 || !rest.every(token => token.trim() !== '' && Number.isFinite(Number(token)))) throw new Exit(2, 'pick needs X Y');
  const [x, y] = rest.map(Number);
  if (!options.picture) {
    if (x > 1 || y > 1) throw new Exit(2, 'Without --picture, X and Y are fractions of the view from its top left (0 to 1). For pixels of a picture, add --picture RECORD.json.');
    return defined({pilot, from: options.from, at: [x, y]});
  }
  let record;
  try { record = JSON.parse(readFileSync(options.picture, 'utf8')); }
  catch (error) { throw new Exit(2, `Cannot read the picture record ${options.picture}: ${error.message}`); }
  const result = record.result ?? record, frame = options.frame === undefined ? null : Number(options.frame);
  if (frame !== null && !(Number.isInteger(frame) && frame >= 1)) throw new Exit(2, '--frame counts burst frames from 1');
  // A burst keeps a pick map per frame; without --frame, its first frame's.
  const source = frame !== null ? result.frames?.[frame - 1] : result.kind === 'burst' ? result.frames?.[0] : result;
  const optics = frame === null ? result.optics : source?.optics;
  if (!optics) throw new Exit(2, frame === null ? `${options.picture} records no camera; take the picture again with this version` : `${options.picture} has no frame ${frame} with a camera`);
  const {width, height} = result.image ?? {};
  if (!(width > 0 && height > 0)) throw new Exit(2, `${options.picture} records no picture size`);
  if (options.now) return {pilot, from: 'sub', at: [x / width, y / height], optics};
  const map = source?.pickMap;
  if (!map) {
    throw new Exit(2, `${options.picture}${frame ? ` frame ${frame}` : ''} has no pick map${source?.pickMapError ? ` (${source.pickMapError})` : ''}, so a pick cannot say what it drew there. Take a new picture, or add --now to cast its camera into the scene as it is now.`);
  }
  let found;
  try { found = pickRunAt(map, [x / width, y / height]); }
  catch (error) { throw new Exit(2, `${options.picture}: ${error.message}`); }
  // The pick goes through the centre of the pixel it read, where the depth was drawn.
  const at = [(found.pixel[0] + 0.5) / map.width, (found.pixel[1] + 0.5) / map.height];
  let depth;
  if (map.depth) {
    let bytes;
    try { bytes = map.depth.path ? new Uint8Array(readFileSync(map.depth.path)) : base64ToBytes(map.depth.data); }
    catch (error) { throw new Exit(2, `Cannot read the picture's depth ${map.depth.path ?? ''}: ${error.message}. Without it the pick could not judge what lay in front.`); }
    depth = depthAtPixel(bytes, map.width, found.pixel);
  }
  const {instances, ...pictured} = map.objects?.find(row => row.n === found.n) ?? {n: found.n};
  const instanceMatrix = instances?.[found.instance];
  return {pilot, from: 'sub', at, optics, pictured: {...pictured, instance: found.instance, pixel: found.pixel, ...(instanceMatrix ? {instanceMatrix} : {}),
    ...(depth ? {depth} : {})}, scene: {clouds: map.clouds ?? [], fields: map.fields ?? [], water: map.water === true}};
}

async function request(server, method, route, body) {
  let response;
  try {
    response = await fetch(new URL(route, server), method === 'GET' ? {} : {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  } catch (error) {
    throw new Exit(3, `Cannot reach Kaminos at ${server} (${error.cause?.code || error.message}). Is serve.py running?`);
  }
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); }
  catch { payload = null; }
  if (response.status === 404 && !(payload && payload.phase)) {
    throw new Exit(3, `${server} has no agent vantage bridge. Serve a Kaminos checkout that includes it.`);
  }
  if (!payload) throw new Exit(3, `Kaminos answered ${response.status} without JSON`);
  return {status: response.status, payload};
}

const stamp = () => {
  const now = new Date(), pad = (value, width = 2) => String(value).padStart(width, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`;
};
const slug = value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const fmt = value => (Math.round(value * 100) / 100).toFixed(2);
const point = values => `(${values.map(fmt).join(', ')})`;
function bearing({right, up}) {
  if (Math.abs(right) > 150) return 'behind';
  const sides = [Math.abs(right) >= 1 ? `${Math.round(Math.abs(right))}° ${right > 0 ? 'right' : 'left'}` : 'ahead'];
  if (Math.abs(up) >= 10) sides.push(`${Math.round(Math.abs(up))}° ${up > 0 ? 'up' : 'down'}`);
  return sides.join(', ');
}

// A pick map's depth is kept as a file beside the picture (little-endian
// float32, one value per pixel, rows from the top); the record keeps its path.
function keepDepth(map, out, prefix, name) {
  if (!map?.depth?.data) return;
  const file = path.join(out, `${prefix}-${slug(name)}-depth.f32`);
  writeFileSync(file, Buffer.from(map.depth.data, 'base64'));
  delete map.depth.data;
  map.depth.path = file;
}

function keepPictures(result, out, prefix) {
  if (!Array.isArray(result?.images)) return [];
  mkdirSync(out, {recursive: true});
  keepDepth(result.pickMap, out, prefix, result.kind ?? 'picture');
  (result.frames ?? []).forEach(frame => keepDepth(frame.pickMap, out, prefix, `frame-${frame.index + 1}`));
  return result.images.map(image => {
    const match = /^data:image\/png;base64,(.*)$/.exec(image.dataUrl || '');
    if (!match) throw new Exit(3, `The page returned ${image.name} without PNG data`);
    const file = path.join(out, `${prefix}-${slug(image.name)}.png`);
    writeFileSync(file, Buffer.from(match[1], 'base64'));
    delete image.dataUrl;
    image.path = file;
    return file;
  });
}

function describePose(sub) {
  if (!sub?.pose) return 'no sub in this scene';
  const forward = poseAxes(sub.pose).forward;
  return `${sub.label} at ${point(sub.pose.position)} facing ${point(forward)}`;
}

function summarize(command, record) {
  const result = record.result ?? {}, lines = [];
  if (result.kind === 'map') {
    lines.push(`map · ${result.images[0]?.width}×${result.images[0]?.height} · grid ${fmt(result.scaleBar?.meters ?? 0)} m`);
    for (const image of result.images) lines.push(`  ${image.name.padEnd(9)} ${image.path}`);
    lines.push(`  record    ${record.recordPath}`);
    lines.push(`  ${(result.sketch?.objects ?? []).length} objects, ${(result.sketch?.fields ?? []).length} fields, ${(result.sketch?.subs ?? []).length} subs`);
  } else if (command === 'sketch') {
    const list = value => Array.isArray(value) ? value : [];
    lines.push(`${list(result.objects).length} objects, ${list(result.fields).length} fields`);
    if (result.operator) lines.push(`you at ${point(result.operator.view.position)} toward ${point(result.operator.view.target)}`);
    for (const sub of list(result.subs)) lines.push(`${sub.label} at ${point(sub.view.position)} toward ${point(sub.view.target)}`);
    for (const object of [...list(result.objects), ...list(result.fields)]) {
      lines.push(`  ${object.label} [${object.id}] ${object.type}${object.bounds ? ` ${point(object.bounds.min)}..${point(object.bounds.max)}` : ''}`);
    }
  } else if (command === 'pick') {
    const who = {picture: 'the picture', camera: 'the picture camera, into the scene as it is now', operator: 'your view'}[result.from] ?? result.from;
    lines.push(`ray from ${who} through (${fmt(result.at[0])}, ${fmt(result.at[1])}) of the frame`);
    const pictured = result.referent === 'pictured', whose = pictured ? 'the picture drew' : 'the renderer draws', when = pictured ? '' : ' now';
    const hit = result.hit, drawn = result.drawn;
    if (hit) {
      lines.push(`  names     ${hit.label} [${hit.id}], which ${whose} there${when} (${hit.authority})`);
      if (hit.point) {
        const surface = [hit.surface?.mesh ? `mesh ${hit.surface.mesh}` : null, Number.isInteger(hit.surface?.face) ? `face ${hit.surface.face}` : null,
          Number.isInteger(hit.surface?.instance) ? `instance ${hit.surface.instance}` : null].filter(Boolean).join(', ');
        lines.push(`  at        ${fmt(hit.distance)} m, ${point(hit.point)}; ${point(hit.local)} in its own frame${surface ? `, ${surface}` : ''}`);
        if (hit.normal) lines.push(`  facing    ${point(hit.normal)}`);
        lines.push(`  point     ${hit.pointBasis === 'depth' ? `where ${pictured ? 'the picture drew it, from its depth' : 'the renderer draws it, from its depth'}`
          : hit.pointBasis === 'recast-now' ? 'cast on the mesh as it is posed now' : pictured ? 'cast on the mesh placed where the picture drew it' : 'cast on the mesh as drawn'}`);
        if (hit.surfaceBasis === 'recast-differs') lines.push('  surface   the mesh no longer passes through that point, so no face or normal is given');
      } else {
        lines.push(`  point     ${{missing: 'none: the object is no longer in the scene', 'mesh-missing': 'none: that mesh is no longer in the object',
          'instance-unknown': 'none: the instance is not known', missed: 'none: the ray does not meet the mesh as it is now'}[hit.now === 'present' ? hit.pointBasis : hit.now] ?? 'none'}`);
      }
      if (pictured && hit.geometry?.status) lines.push(`  geometry  ${hit.geometry.status} since the picture`);
      if (hit.coverage) lines.push(`  coverage  drawn with its own fragment shader; the map traced it with a stand-in`);
    } else if (drawn?.kind === 'not-a-scene-object') lines.push(`  names     ${drawn.name || 'an unnamed drawing'} (${drawn.type ?? 'unknown'}): drawn there, but not a scene object`);
    else if (drawn?.kind === 'unidentified') lines.push(`  names     an unidentified drawing (number ${drawn.n})`);
    else lines.push(`  names     nothing: ${whose} nothing there${when}`);
    for (const item of result.unresolved ?? []) lines.push(`  in front  ${item.label} (${item.type})${Number.isFinite(item.distance) ? ` at ${fmt(item.distance)} m` : ''}: ${item.reason}; it may be what the point shows`);
    for (const field of result.fields ?? []) lines.push(`  through   ${field.label} from ${fmt(field.enter)} to ${fmt(field.exit)} m`);
  } else if (result.images) {
    lines.push(`${result.kind} · ${result.pilot ?? 'operator'} · ${result.route} · ${result.image?.width}×${result.image?.height} · layers: ${(result.layers || []).join(', ')}`);
    for (const image of result.images) lines.push(`  ${image.name.padEnd(9)} ${image.path}`);
    lines.push(`  record    ${record.recordPath}`);
    if (result.unverifiedLayers?.length) lines.push(`  unverified ${result.unverifiedLayers.join(', ')}: pictured, but the page reports no frame counter, so these may be stale`);
    if (result.view) lines.push(`  from      ${point(result.view.position)} toward ${point(result.view.target)}, fov ${fmt(result.view.fov)}°`);
    const seen = result.objects?.inView ?? [], elsewhere = result.objects?.outOfView ?? [];
    lines.push(`  in view   ${seen.map(o => `${o.label} ${fmt(o.distance)} m${o.center ? ` at ${point(o.center)}` : ''}${o.partial ? ' (cut off)' : ''}`).join(' · ') || 'no scene objects'}`);
    if (elsewhere.length) lines.push(`  elsewhere ${elsewhere.map(o => `${o.label} ${fmt(o.distance)} m ${bearing(o.bearing)}`).join(' · ')}`);
    if (result.objects?.occlusion === 'not-tested') lines.push('  (in view means inside the frame by bounds; something nearer may hide it)');
    if (result.frames) lines.push(`  frames    ${result.frames.map(frame => `+${Math.round(frame.atMs)} ms`).join(', ')}`);
    const maps = result.frames ? result.frames : [result];
    const kept = maps.filter(item => item.pickMap).length, failed = maps.find(item => item.pickMapError), deep = maps.filter(item => item.pickMap?.depth).length;
    lines.push(`  pick map  ${kept === maps.length ? `kept${maps.length > 1 ? ` for all ${maps.length} frames` : ''}${deep === maps.length ? ' with depth' : deep ? `, depth for ${deep}` : ', no depth'}: pick on a pixel with --picture` : `${kept} of ${maps.length}${failed ? `: ${failed.pickMapError}` : ''}`}`);
  } else if (command === 'status') {
    lines.push(`page ${record.page?.id} · ${record.page?.title ?? ''} · ${result.visible ? 'visible' : 'hidden'}${result.busy ? ` · busy: ${result.busy}` : ''}`);
    lines.push(`viewport ${result.viewport?.width}×${result.viewport?.height} · camera mode ${result.cameraMode?.mode}`);
    lines.push(`operator at ${point(result.operator?.view?.position ?? [0, 0, 0])} toward ${point(result.operator?.view?.target ?? [0, 0, 0])}; selection ${(result.operator?.selection || []).join(', ') || 'none'}`);
    lines.push(...(result.subs?.length ? result.subs.map(sub => `sub ${sub.pilot}: ${describePose(sub)}`) : ['no subs launched']));
  } else if (command === 'objects') {
    const from = new Map([...(result.fromSub?.inView ?? []), ...(result.fromSub?.outOfView ?? [])].map(o => [o.id, o]));
    lines.push(result.sub ? describePose(result.sub) : 'no sub launched; distances need one');
    for (const object of result.objects ?? []) {
      const seen = from.get(object.id), inView = result.fromSub?.inView?.some(o => o.id === object.id);
      lines.push(`  ${object.label} [${object.id}] ${object.type}${seen ? ` · ${fmt(seen.distance)} m ${inView ? 'in view' : bearing(seen.bearing)}` : ''}`);
    }
  } else if (result.sub || result.removed !== undefined) {
    if (result.removed !== undefined) lines.push(result.removed ? `${result.pilot} removed` : `${result.pilot} was not in the scene`);
    else lines.push(`${result.created === false ? 'already launched: ' : ''}${describePose(result.sub)}${result.target ? ` · target ${result.target.label}` : ''}`);
  } else lines.push(JSON.stringify(result));
  return lines.join('\n');
}

async function main(argv) {
  const {options, command, rest} = parse(argv);
  if (options.help || !command) { console.log(USAGE); return; }
  const server = options.server || process.env.KAMINOS_VANTAGE_SERVER || 'http://127.0.0.1:8484';
  const pilot = options.pilot || process.env.KAMINOS_VANTAGE_PILOT || DEFAULT_PILOT;
  if (command === 'pages') {
    const {payload} = await request(server, 'GET', '/api/vantage/pages');
    if (options.json) { console.log(JSON.stringify(payload, null, 2)); return; }
    if (!payload.pages?.length) console.log(`No pages linked to ${server}. Open ${new URL('/index.html', server)} in a WebGPU browser.`);
    for (const page of payload.pages ?? []) {
      console.log(`${page.id}  ${page.connected ? 'linked' : 'gone'}  ${page.visible ? 'visible' : 'hidden'}${page.focused ? ' focused' : ''}  ${page.title ?? ''}  ${page.href ?? ''}`);
    }
    return;
  }
  let checked;
  try { checked = checkedCommand({command, args: commandArgs(command, rest, options, pilot)}); }
  catch (error) { throw new Exit(2, error.message); }
  const timeout = Number(options.timeout ?? 30);
  if (!(timeout > 0)) throw new Exit(2, '--timeout must be a positive number of seconds');
  const extra = checked.command === 'burst' ? checked.args.count * checked.args.interval / 1000 : 0;
  const body = {command: checked.command, args: checked.args, timeoutMs: Math.round((timeout + extra) * 1000), ...(options.page ? {page: options.page} : {})};
  const sentAt = new Date().toISOString();
  const {status, payload} = await request(server, 'POST', '/api/vantage/command', body);
  if (!payload.ok) throw new Exit(status === 200 ? 1 : 3, `${payload.phase ?? 'error'}: ${payload.error ?? 'the page did not succeed'}`);
  const out = path.resolve(options.out || process.env.KAMINOS_VANTAGE_OUT || path.join(homedir(), '.local/state/kaminos/vantage', pilot));
  const prefix = [stamp(), checked.command === 'peek' ? 'operator' : pilot, options.name ? slug(options.name) : null].filter(Boolean).join('-');
  const record = {request: {server, sentAt, ...body}, page: payload.page, elapsedMs: payload.elapsedMs, result: payload.result};
  const written = keepPictures(payload.result, out, prefix);
  if (written.length) {
    record.recordPath = path.join(out, `${prefix}-${checked.command}.json`);
    writeFileSync(record.recordPath, JSON.stringify(record, null, 2));
  }
  console.log(options.json ? JSON.stringify(record, null, 2) : summarize(checked.command, record));
}

main(process.argv.slice(2)).catch(error => {
  console.error(`vantage: ${error.message}`);
  process.exit(error instanceof Exit ? error.code : 1);
});
