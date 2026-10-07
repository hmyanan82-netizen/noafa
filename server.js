const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ORDER_URL = process.env.ORDER_URL || '#order';

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=3600'
  });
  res.end(html.replace(/#order/g, ORDER_URL));
}).listen(PORT, '0.0.0.0', () => console.log(`Port ${PORT}`));
