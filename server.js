const http = require('http');
const https = require('https');
const zlib = require('zlib');

const PORT = process.env.PORT || 3000;
const TARGET = 'novawater.com';
const BACKEND = 'novacp.novawater.com';

function fetchAndRewrite(hostname, urlPath, req, res, transform) {
  const options = {
    hostname,
    port: 443,
    path: urlPath,
    method: req.method,
    headers: {
      ...req.headers,
      host: hostname,
      origin: 'https://novawater.com',
      referer: 'https://novawater.com/'
    }
  };
  delete options.headers['connection'];
  delete options.headers['accept-encoding'];
  delete options.headers['x-forwarded-host'];
  delete options.headers['x-forwarded-for'];
  delete options.headers['x-forwarded-proto'];
  delete options.headers['x-real-ip'];
  delete options.headers['cf-connecting-ip'];
  delete options.headers['cf-ray'];
  delete options.headers['cf-visitor'];

  const p = https.request(options, (upstream) => {
    const headers = { ...upstream.headers };
    delete headers['content-security-policy'];
    delete headers['content-security-policy-report-only'];
    delete headers['x-frame-options'];
    delete headers['strict-transport-security'];
    delete headers['content-encoding'];
    headers['access-control-allow-origin'] = '*';
    headers['access-control-allow-methods'] = 'GET,POST,OPTIONS,PUT,DELETE';
    headers['access-control-allow-headers'] = '*';

    if (!transform) {
      res.writeHead(upstream.statusCode, headers);
      upstream.pipe(res);
      return;
    }

    const enc = upstream.headers['content-encoding'];
    let stream = upstream;
    if (enc === 'gzip') stream = upstream.pipe(zlib.createGunzip());
    else if (enc === 'deflate') stream = upstream.pipe(zlib.createInflate());
    else if (enc === 'br') stream = upstream.pipe(zlib.createBrotliDecompress());

    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => {
      let body = Buffer.concat(chunks).toString('utf8');
      body = transform(body);
      delete headers['transfer-encoding'];
      headers['content-length'] = Buffer.byteLength(body);
      res.writeHead(upstream.statusCode, headers);
      res.end(body);
    });
    stream.on('error', () => { res.writeHead(502); res.end('Error'); });
  });

  p.on('error', () => { res.writeHead(502); res.end('Bad Gateway'); });
  req.pipe(p);
}

function streamProxy(hostname, urlPath, req, res) {
  fetchAndRewrite(hostname, urlPath, req, res, null);
}

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS,PUT,DELETE',
      'access-control-allow-headers': '*',
      'access-control-max-age': '86400'
    });
    return res.end();
  }

  const actualHost = req.headers['host'] || '';
  const actualOrigin = 'https://' + actualHost;

  // Proxy Magento backend API
  if (req.url.startsWith('/_backend/')) {
    return streamProxy(BACKEND, req.url.replace('/_backend', ''), req, res);
  }

  // HTML pages - replace MAGENTO_BACKEND_URL so API calls go through proxy
  const isPageReq = req.headers['accept'] && req.headers['accept'].includes('text/html');
  if (isPageReq && !req.url.startsWith('/_next/')) {
    return fetchAndRewrite(TARGET, req.url, req, res, (body) => {
      body = body.replace(/https:\/\/novacp\.novawater\.com\//g, actualOrigin + '/_backend/');
      body = body.replace(/https:\/\/novacp\.novawater\.com/g, actualOrigin + '/_backend');
      if (actualHost && actualHost !== TARGET) {
        const esc = actualHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        body = body.replace(new RegExp('"landing":"' + esc + '"', 'g'), '"landing":"novawater.com"');
      }
      return body;
    });
  }

  // _buildManifest.js - fix landing rewrite destinations
  if (req.url.includes('_buildManifest.js')) {
    return fetchAndRewrite(TARGET, req.url, req, res, (body) => {
      body = body.replace(/:landing\/desktop/g, 'novawater.com/desktop');
      body = body.replace(/:landing\/mobile/g, 'novawater.com/mobile');
      return body;
    });
  }

  // Everything else - straight proxy
  streamProxy(TARGET, req.url, req, res);

}).listen(PORT, '0.0.0.0', () => console.log(`Port ${PORT}`));
