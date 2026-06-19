#!/usr/bin/env node
// Unified static server for the viz extension suite.
// Serves the project root on one port so all three extensions
// (/radial, /heatmap, /pretty-table) plus the shared lib/ and
// tableau-core.js load from the same origin — matching the URLs
// hard-coded in each .trex manifest.
//
//   node server.js            -> http://localhost:1111
//   PORT=8080 node server.js  -> override the port
//
// No dependencies, no build step. Tableau Desktop allows
// http://localhost; Tableau Cloud/Server need HTTPS (see README).

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 1111;
// Leave HOST unset by default so Node binds every interface in dual-stack mode
// (both IPv4 127.0.0.1 and IPv6 ::1). Binding the literal 'localhost' picks only
// ONE family, so clients using the other family get connection-refused/404.
const HOST = process.env.HOST || undefined;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.trex': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

const server = http.createServer((req, res) => {
  // Decode and strip the query string, then resolve safely under ROOT.
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(ROOT, path.normalize(urlPath));
  // Block path traversal outside the project root.
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // Never cache during development so edits show on reload.
      'Cache-Control': 'no-store',
      // The extensions and shared assets share this origin, but allow
      // cross-origin reads too so the .trex can be hosted elsewhere.
      'Access-Control-Allow-Origin': '*',
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use.`);
    console.error(`  Stop the other server or run:  PORT=8080 node server.js\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(...(HOST ? [PORT, HOST] : [PORT]), () => {
  const base = `http://localhost:${PORT}`;
  console.log(`\n  Viz extension suite served from ${ROOT}`);
  console.log(`  Listening on ${base}\n`);
  console.log(`  Radial Bar Chart  ${base}/radial/index.html`);
  console.log(`  Calendar Heatmap  ${base}/heatmap/heatmap.html`);
  console.log(`  Pretty Table      ${base}/pretty-table/pretty-table.html`);
  console.log(`\n  Add the matching .trex to a worksheet. Ctrl+C to stop.\n`);
});
