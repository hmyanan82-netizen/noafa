const http = require('http');
const https = require('https');
const zlib = require('zlib');

const PORT = process.env.PORT || 3000;
const TARGET = 'novawater.com';
const BACKEND = 'novacp.novawater.com';

const INJECT_SCRIPT = `<script>
(function(){
  var nd = window.__NEXT_DATA__;
  if (!nd) return;
  var sc = nd.props && nd.props.pageProps && nd.props.pageProps.storeConfig;
  var sv = nd.props && nd.props.pageProps && nd.props.pageProps.storeViews;
  var mm = nd.props && nd.props.pageProps && nd.props.pageProps.megaMenu;
  var cb = nd.props && nd.props.pageProps && nd.props.pageProps.cmsBlocks;
  var origFetch = window.fetch;
  window.fetch = function(url, opts) {
    if (opts && opts.method === 'POST' && typeof url === 'string' && url.indexOf('graphql') !== -1) {
      try {
        var body = typeof opts.body === 'string' ? opts.body : '';
        if (body.indexOf('storeConfig') !== -1 && body.indexOf('createEmptyCart') === -1 && sc) {
          return Promise.resolve(new Response(JSON.stringify({data:{storeConfig:sc}}), {status:200, headers:{'content-type':'application/json'}}));
        }
        if (body.indexOf('availableStores') !== -1 && sv) {
          return Promise.resolve(new Response(JSON.stringify({data:{availableStores:sv}}), {status:200, headers:{'content-type':'application/json'}}));
        }
        if (body.indexOf('megaMenu') !== -1 && mm) {
          return Promise.resolve(new Response(JSON.stringify({data:{categoryList:mm}}), {status:200, headers:{'content-type':'application/json'}}));
        }
        if (body.indexOf('createEmptyCart') !== -1) {
          return Promise.resolve(new Response(JSON.stringify({data:{createEmptyCart:"guest-" + Math.random().toString(36).slice(2)}}), {status:200, headers:{'content-type':'application/json'}}));
        }
        if (body.indexOf('customerCart') !== -1) {
          return Promise.resolve(new Response(JSON.stringify({data:{customerCart:{id:"guest-" + Math.random().toString(36).slice(2)}}}), {status:200, headers:{'content-type':'application/json'}}));
        }
      } catch(e) {}
    }
    return origFetch.apply(this, arguments);
  };
})();
</script>`;

function proxyRequest(hostname, urlPath, req, res, transform) {
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

  if (req.url.startsWith('/_backend/')) {
    return proxyRequest(BACKEND, req.url.replace('/_backend', ''), req, res, null);
  }

  const isPage = req.headers['accept'] && req.headers['accept'].includes('text/html');
  if (isPage && !req.url.startsWith('/_next/')) {
    return proxyRequest(TARGET, req.url, req, res, (body) => {
      const origin = 'https://' + actualHost;
      body = body.replace(/https:\/\/novacp\.novawater\.com\//g, origin + '/_backend/');
      body = body.replace(/https:\/\/novacp\.novawater\.com/g, origin + '/_backend');
      if (actualHost && actualHost !== TARGET) {
        const esc = actualHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        body = body.replace(new RegExp('"landing":"' + esc + '"', 'g'), '"landing":"novawater.com"');
      }
      body = body.replace('</head>', INJECT_SCRIPT + '</head>');
      return body;
    });
  }

  if (req.url.includes('_buildManifest.js')) {
    return proxyRequest(TARGET, req.url, req, res, (body) => {
      body = body.replace(/:landing\/desktop/g, 'novawater.com/desktop');
      body = body.replace(/:landing\/mobile/g, 'novawater.com/mobile');
      return body;
    });
  }

  proxyRequest(TARGET, req.url, req, res, null);

}).listen(PORT, '0.0.0.0', () => console.log(`Port ${PORT}`));
