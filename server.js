const http = require('http');
const https = require('https');
const zlib = require('zlib');

const PORT = process.env.PORT || 3000;
const TARGET = 'novawater.com';
const MAGENTO = 'novacp.novawater.com';

function doProxy(hostname, proxyPath, req, res, rewriteBody) {
  const options = {
    hostname,
    port: 443,
    path: proxyPath,
    method: req.method,
    headers: {
      ...req.headers,
      host: hostname,
      'accept-encoding': 'gzip, deflate',
      origin: 'https://novawater.com',
      referer: 'https://novawater.com/'
    }
  };
  delete options.headers['connection'];

  const proxy = https.request(options, (proxyRes) => {
    const contentType = (proxyRes.headers['content-type'] || '');
    const needsRewrite = rewriteBody && (contentType.includes('text/html') || contentType.includes('javascript') || contentType.includes('json'));

    const headers = { ...proxyRes.headers };
    delete headers['content-security-policy'];
    delete headers['content-security-policy-report-only'];
    delete headers['x-frame-options'];
    delete headers['strict-transport-security'];
    headers['access-control-allow-origin'] = '*';
    headers['access-control-allow-methods'] = 'GET, POST, OPTIONS, PUT, DELETE';
    headers['access-control-allow-headers'] = '*';

    if (!needsRewrite) {
      delete headers['content-encoding'];
      res.writeHead(proxyRes.statusCode, headers);
      const encoding = proxyRes.headers['content-encoding'];
      if (encoding === 'gzip') proxyRes.pipe(zlib.createGunzip()).pipe(res);
      else if (encoding === 'deflate') proxyRes.pipe(zlib.createInflate()).pipe(res);
      else proxyRes.pipe(res);
      return;
    }

    const chunks = [];
    let stream = proxyRes;
    const encoding = proxyRes.headers['content-encoding'];
    if (encoding === 'gzip') stream = proxyRes.pipe(zlib.createGunzip());
    else if (encoding === 'deflate') stream = proxyRes.pipe(zlib.createInflate());

    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => {
      let body = Buffer.concat(chunks).toString('utf8');
      const actualHost = req.headers['host'] || '';
      const actualOrigin = 'https://' + actualHost;

      if (contentType.includes('text/html')) {
        body = body.replace(/https:\/\/novacp\.novawater\.com\//g, actualOrigin + '/_backend/');
        body = body.replace(/https:\/\/novacp\.novawater\.com/g, actualOrigin + '/_backend');
      }

      delete headers['content-encoding'];
      headers['content-length'] = Buffer.byteLength(body);
      res.writeHead(proxyRes.statusCode, headers);
      res.end(body);
    });
    stream.on('error', () => { res.writeHead(502); res.end('Error'); });
  });

  proxy.on('error', () => { res.writeHead(502); res.end('Bad Gateway'); });
  req.pipe(proxy);
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS, PUT, DELETE',
      'access-control-allow-headers': '*',
      'access-control-max-age': '86400'
    });
    res.end();
    return;
  }

  // Proxy Magento backend API calls
  if (req.url.startsWith('/_backend/')) {
    const backendPath = req.url.replace('/_backend', '');
    doProxy(MAGENTO, backendPath, req, res, false);
    return;
  }

  // Fix _next/data landing path
  let proxyPath = req.url;
  proxyPath = proxyPath.replace(
    /(\/_next\/data\/[^/]+\/[^/]+\/landings\/)([^/]+)(\/)/,
    '$1novawater.com$3'
  );
  if (proxyPath.match(/^\/[a-z]{2}\/landings\//) && !proxyPath.includes('novawater.com')) {
    proxyPath = proxyPath.replace(/(\/landings\/)([^/]+)(\/)/, '$1novawater.com$3');
  }

  doProxy(TARGET, proxyPath, req, res, true);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Proxy running on port ${PORT}`);
});
