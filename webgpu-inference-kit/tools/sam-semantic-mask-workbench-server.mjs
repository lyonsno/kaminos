#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    'kit-root': { type: 'string', default: resolve(new URL('..', import.meta.url).pathname) },
    'packet-root': { type: 'string' },
    'sample-root': { type: 'string' },
    'host': { type: 'string', default: '127.0.0.1' },
    'port': { type: 'string', default: '18596' },
    'receipt': { type: 'string' },
    'commit': { type: 'string' },
  },
  strict: true,
});

if (!values['packet-root']) throw new Error('--packet-root is required');
if (!values['sample-root']) throw new Error('--sample-root is required');

const roots = {
  kit: realpathSync(resolve(values['kit-root'])),
  packet: realpathSync(resolve(values['packet-root'])),
  samples: realpathSync(resolve(values['sample-root'])),
};
const host = values.host;
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid --port ${values.port}`);

const manifestPath = resolve(roots.packet, 'tensor-manifest.json');
if (!existsSync(manifestPath)) throw new Error(`packet root missing tensor-manifest.json: ${roots.packet}`);
for (const sample of ['truck.jpg', 'groceries.jpg', 'test_image.jpg']) {
  if (!existsSync(resolve(roots.samples, sample))) throw new Error(`sample root missing ${sample}: ${roots.samples}`);
}

function sha256File(path) {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function contentType(path) {
  const extension = extname(path).toLowerCase();
  if (extension === '.html') return 'text/html; charset=utf-8';
  if (extension === '.js' || extension === '.mjs') return 'text/javascript; charset=utf-8';
  if (extension === '.json') return 'application/json; charset=utf-8';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.png') return 'image/png';
  if (extension === '.css') return 'text/css; charset=utf-8';
  return 'application/octet-stream';
}

const requestedRoute = '/smokes/sam-semantic-mask-workbench.html';
const effectiveRoute = `${requestedRoute}?manifest=${encodeURIComponent('/workbench-packet/tensor-manifest.json')}`;
const routeReceipt = {
  schema: 'kaminos.sam3-semantic-mask-workbench-route.v0',
  registrationState: 'mounted',
  requestedRoute,
  effectiveRoute,
  effectiveUrl: `http://${host}:${port}${effectiveRoute}`,
  commit: values.commit || null,
  manifestSha256: sha256File(manifestPath),
  mounts: {
    kit: { route: '/', root: roots.kit },
    packet: { route: '/workbench-packet/', root: roots.packet },
    samples: { route: '/sam3-samples/', root: roots.samples },
  },
  samples: Object.fromEntries(['truck.jpg', 'groceries.jpg', 'test_image.jpg'].map(file => [file, sha256File(resolve(roots.samples, file))])),
  startedAt: new Date().toISOString(),
};

function send(response, status, body, type) {
  response.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-embedder-policy': 'require-corp',
    'cross-origin-resource-policy': 'same-origin',
  });
  response.end(body);
}

function resolveMount(pathname) {
  if (pathname.startsWith('/workbench-packet/')) {
    return { root: roots.packet, relative: pathname.slice('/workbench-packet/'.length) };
  }
  if (pathname.startsWith('/sam3-samples/')) {
    return { root: roots.samples, relative: pathname.slice('/sam3-samples/'.length) };
  }
  return { root: roots.kit, relative: pathname.slice(1) };
}

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, `http://${host}:${port}`);
    if (url.pathname === '/api/sam3-workbench-route') {
      send(response, 200, `${JSON.stringify(routeReceipt, null, 2)}\n`, 'application/json; charset=utf-8');
      return;
    }
    if (url.pathname === '/') {
      response.writeHead(302, { location: effectiveRoute, 'cache-control': 'no-store' });
      response.end();
      return;
    }
    const { root, relative } = resolveMount(url.pathname);
    const filePath = resolve(root, decodeURIComponent(relative));
    if (filePath !== root && !filePath.startsWith(`${root}/`)) {
      send(response, 403, 'forbidden\n', 'text/plain; charset=utf-8');
      return;
    }
    if (!existsSync(filePath)) {
      send(response, 404, `missing ${url.pathname}\n`, 'text/plain; charset=utf-8');
      return;
    }
    const realFilePath = realpathSync(filePath);
    if (realFilePath !== root && !realFilePath.startsWith(`${root}/`)) {
      send(response, 403, 'forbidden\n', 'text/plain; charset=utf-8');
      return;
    }
    if (!statSync(realFilePath).isFile()) {
      send(response, 404, `missing ${url.pathname}\n`, 'text/plain; charset=utf-8');
      return;
    }
    send(response, 200, readFileSync(realFilePath), contentType(realFilePath));
  } catch (error) {
    send(response, 500, `${String(error?.stack || error)}\n`, 'text/plain; charset=utf-8');
  }
});

server.listen(port, host, () => {
  if (values.receipt) writeFileSync(resolve(values.receipt), `${JSON.stringify(routeReceipt, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(routeReceipt)}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
