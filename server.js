const http = require('http');
const https = require('https');
const zlib = require('zlib');

const PORT = process.env.PORT || 3000;
const TARGET = 'novawater.com';

function proxyRequest(req, res) {
  const options = {
    hostname: TARGET,
    port: 443,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: TARGET,
      'accept-encoding': 'gzip, deflate'
    }
  };
  delete options.headers['connection'];

  const proxy = https.request(options, (proxyRes) => {
    const contentType = (proxyRes.headers['content-type'] || '');
    const isHTML = contentType.includes('text/html');
    const isJS = contentType.includes('javascript');
    const needsRewrite = isHTML || isJS;

    if (!needsRewrite) {
      const headers = { ...proxyRes.headers };
      delete headers['content-security-policy'];
      delete headers['x-frame-options'];
      delete headers['strict-transport-security'];
      res.writeHead(proxyRes.statusCode, headers);
      proxyRes.pipe(res);
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
      const actualHost = req.headers['host'] || 'noafa.up.railway.app';

      if (isHTML) {
        body = body.replace(/"hostname":"novawater\.com"/g, `"hostname":"${actualHost}"`);
        body = body.replace(/"HOST_NAME":"https:\/\/novawater\.com"/g, `"HOST_NAME":"https://${actualHost}"`);
      }

      const headers = { ...proxyRes.headers };
      delete headers['content-security-policy'];
      delete headers['x-frame-options'];
      delete headers['strict-transport-security'];
      delete headers['content-encoding'];
      headers['content-length'] = Buffer.byteLength(body);
      res.writeHead(proxyRes.statusCode, headers);
      res.end(body);
    });
    stream.on('error', () => {
      res.writeHead(502);
      res.end('Error');
    });
  });

  proxy.on('error', () => {
    res.writeHead(502);
    res.end('Bad Gateway');
  });

  req.pipe(proxy);
}

const server = http.createServer(proxyRequest);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Proxy server running on port ${PORT}`);
});
