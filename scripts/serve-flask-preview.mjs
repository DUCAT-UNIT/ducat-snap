/** Serve a frozen development artifact and its connector, on loopback only. */
import { VirtualFile, validateSnapShasum } from '@metamask/snaps-utils';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (path) => readFileSync(resolve(root, path));
const manifestBytes = load('.snap/dev/snap.manifest.json');
const manifest = JSON.parse(manifestBytes);
const expected = ['http://localhost:3000', 'http://localhost:8075', 'http://frontend:3000', 'http://ducat-admin:8075', 'https://dev.app.ducatprotocol.com'];
if (JSON.stringify(manifest.initialPermissions?.['endowment:rpc']?.allowedOrigins) !== JSON.stringify(expected)) throw new Error('Build the reviewed development artifact with npm run build:harness-dev first.');
const snapFiles = new Map([
  ['/snap.manifest.json', ['application/json', manifestBytes]],
  ['/dist/bundle.js', ['text/javascript', load('.snap/dev/dist/bundle.js')]],
  ['/images/icon.svg', ['image/svg+xml', load('.snap/dev/images/icon.svg')]],
  ['/package.json', ['application/json', load('.snap/dev/package.json')]],
]);
await validateSnapShasum({
  manifest: new VirtualFile({ path: 'snap.manifest.json', value: manifestBytes, result: manifest }),
  sourceCode: new VirtualFile({ path: 'dist/bundle.js', value: snapFiles.get('/dist/bundle.js')[1] }),
  svgIcon: new VirtualFile({ path: 'images/icon.svg', value: snapFiles.get('/images/icon.svg')[1] }),
  auxiliaryFiles: [], localizationFiles: [],
});
const pageFiles = new Map([
  ['/', ['text/html', load('scripts/flask-preview/index.html')]],
  ['/app.mjs', ['text/javascript', load('scripts/flask-preview/app.mjs')]],
  ['/connector.mjs', ['text/javascript', load('scripts/flask-preview/connector.mjs')]],
]);
function server(port, files, cors = false) {
  const instance = createServer((req, res) => {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(cors ? { 'Access-Control-Allow-Origin': '*' } : {}) };
    if (!['localhost:'+port, '127.0.0.1:'+port].includes(req.headers.host)) { res.writeHead(403, headers); res.end(); return; }
    if (cors && req.method === 'OPTIONS') { res.writeHead(204, {...headers, 'Access-Control-Allow-Methods':'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers':'*'}); res.end(); return; }
    if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405, headers); res.end(); return; }
    if (!cors && req.headers.host.startsWith('127.0.0.1:')) { res.writeHead(302, {...headers, Location:'http://localhost:3000/'}); res.end(); return; }
    const file = files.get(new URL(req.url, 'http://localhost').pathname);
    if (!file) { res.writeHead(404, headers); res.end('Not found'); return; }
    res.writeHead(200, { ...headers, 'Content-Type':file[0], 'Content-Length':file[1].length });
    res.end(req.method === 'HEAD' ? undefined : file[1]);
  });
  return new Promise((resolve, reject) => { instance.once('error', reject); instance.listen(port,'127.0.0.1',() => resolve(instance)); });
}
const servers = [];
try {
  servers.push(await server(8086, snapFiles, true));
  servers.push(await server(3000, pageFiles));
  console.log('Ducat local Snap: http://localhost:8086\nConnect in Flask: http://localhost:3000/');
} catch (error) {
  for (const instance of servers) instance.close();
  console.error(`Could not start local preview: ${error.message}`);
  process.exitCode = 1;
}
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => { for (const instance of servers) instance.close(); });
