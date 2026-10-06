const http = require('http');
const https = require('https');
const zlib = require('zlib');

const PORT = process.env.PORT || 3000;
const TARGET = 'novawater.com';

function proxyRequest(req, res) {
  let proxyPath = req.url;

  // Fix _next/data requests: replace proxy hostname with novawater.com in landing paths
  proxyPath = proxyPath.replace(
    /(\/_next\/data\/[^/]+\/[^/]+\/landings\/)([^/]+)(\/)/,
    '$1novawater.com$3'
  );

  // Fix landings paths in regular navigation
  if (proxyPath.match(/\/landings\/[^/]+\/(desktop|mobile)/)) {
    proxyPath = proxyPath.replace(
      /(\/landings\/)([^/]+)(\/)/,
      '$1novawater.com$3'
    );
  }

  const options = {
    hostname: TARGET,
    port: 443,
    path: proxyPath,
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
    const isText = contentType.includes('text/html') || contentType.includes('javascript') || contentType.includes('json');

    if (!isText) {
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
      const actualHost = req.headers['host'] || '';

      if (contentType.includes('text/html')) {
        // Fix __NEXT_DATA__ hostname and HOST_NAME
        body = body.replace(/"hostname":"novawater\.com"/g, `"hostname":"${actualHost}"`);
        body = body.replace(/"HOST_NAME":"https:\/\/novawater\.com"/g, `"HOST_NAME":"https://${actualHost}"`);
        // Fix sub_domain references
        body = body.replace(/https:\/\/novawater\.com/g, `https://${actualHost}`);
      }

      if (contentType.includes('javascript') && body.includes('__BUILD_MANIFEST')) {
        // Replace host-based rewrite: make it always capture "novawater.com" as landing
        // Change {type:"host",value:"(?<landing>.*)"} so the captured landing is always novawater.com
        body = body.replace(
          /type:b,value:p/g,
          `type:"header",key:"x-proxy-landing",value:"(?<landing>novawater\\\\.com)"`
        );
        // Add a custom header matcher that always provides novawater.com as landing
        body = body.replace(
          /self\.__BUILD_MANIFEST_CB&&self\.__BUILD_MANIFEST_CB\(\)/,
          `self.__BUILD_MANIFEST.____rewriteHostFix=true;self.__BUILD_MANIFEST_CB&&self.__BUILD_MANIFEST_CB()`
        );
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
