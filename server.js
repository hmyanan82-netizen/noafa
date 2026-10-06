const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;
const TARGET = 'novawater.com';
const BACKEND = 'novacp.novawater.com';

function proxy(targetHost, targetPath, req, res) {
  const options = {
    hostname: targetHost,
    port: 443,
    path: targetPath,
    method: req.method,
    headers: {
      ...req.headers,
      host: targetHost,
      origin: 'https://novawater.com',
      referer: 'https://novawater.com/',
      'x-forwarded-host': targetHost
    }
  };
  delete options.headers['connection'];
  delete options.headers['accept-encoding'];

  const p = https.request(options, (r) => {
    const h = { ...r.headers };
    delete h['content-security-policy'];
    delete h['content-security-policy-report-only'];
    delete h['x-frame-options'];
    delete h['strict-transport-security'];
    delete h['content-encoding'];
    h['access-control-allow-origin'] = '*';
    h['access-control-allow-methods'] = 'GET,POST,OPTIONS,PUT,DELETE';
    h['access-control-allow-headers'] = '*';
    h['access-control-allow-credentials'] = 'true';
    res.writeHead(r.statusCode, h);
    r.pipe(res);
  });

  p.on('error', () => { res.writeHead(502); res.end('Bad Gateway'); });
  req.pipe(p);
}

http.createServer((req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS,PUT,DELETE',
      'access-control-allow-headers': '*',
      'access-control-max-age': '86400'
    });
    return res.end();
  }

  // Proxy Magento backend
  if (req.url.startsWith('/_backend/')) {
    return proxy(BACKEND, req.url.replace('/_backend', ''), req, res);
  }

  // Fix _next/data landing paths
  let path = req.url;
  const dataMatch = path.match(/(\/_next\/data\/[^/]+\/[^/]+\/landings\/)([^/]+)(\/.*)/);
  if (dataMatch && dataMatch[2] !== 'novawater.com') {
    path = dataMatch[1] + 'novawater.com' + dataMatch[3];
  }

  // Proxy to novawater.com
  proxy(TARGET, path, req, res);

}).listen(PORT, '0.0.0.0', () => console.log(`Port ${PORT}`));
