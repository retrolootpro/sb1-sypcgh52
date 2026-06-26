const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = process.cwd();
const outDir = path.join(root, 'work', 'clover-functional-review');
fs.mkdirSync(outDir, { recursive: true });

const chromeCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const chromePath = chromeCandidates.find((candidate) => fs.existsSync(candidate));

if (!chromePath) {
  console.error('Chrome or Edge was not found in the standard install paths.');
  process.exit(1);
}

const html = String.raw`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>RetroLootPro Clover Functional Review</title>
  <style>
    html, body { margin: 0; background: #050807; overflow: hidden; }
    canvas { display: block; width: 1280px; height: 720px; }
  </style>
</head>
<body>
<canvas id="stage" width="1280" height="720"></canvas>
<script>
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;
const DURATION = 56000;
const started = performance.now();

function money(value) {
  return '$' + value.toFixed(2);
}

function roundRect(x, y, w, h, r, fill, stroke = 'rgba(255,255,255,.08)', line = 1) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = line;
    ctx.stroke();
  }
}

function text(label, x, y, size = 24, color = '#f8fafc', weight = '600', align = 'left') {
  ctx.font = weight + ' ' + size + 'px Arial, sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.fillText(label, x, y);
}

function wrap(label, x, y, width, size = 22, color = '#cbd5e1', weight = '500', lineHeight = 32) {
  ctx.font = weight + ' ' + size + 'px Arial, sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const words = label.split(' ');
  let line = '';
  let offset = 0;
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > width && line) {
      ctx.fillText(line, x, y + offset);
      line = word;
      offset += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, y + offset);
}

function logo(x, y, size) {
  roundRect(x, y, size, size, 18, '#062412', '#39ff72', 5);
  ctx.strokeStyle = '#39ff72';
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x + size * .28, y + size * .32);
  ctx.lineTo(x + size * .52, y + size * .50);
  ctx.lineTo(x + size * .28, y + size * .68);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + size * .58, y + size * .70);
  ctx.lineTo(x + size * .78, y + size * .70);
  ctx.stroke();
}

function baseFrame(title, subtitle) {
  const grd = ctx.createLinearGradient(0, 0, W, H);
  grd.addColorStop(0, '#061008');
  grd.addColorStop(.65, '#090b0f');
  grd.addColorStop(1, '#020403');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);

  roundRect(22, 20, 1236, 84, 18, '#101413', 'rgba(255,255,255,.1)', 1);
  logo(44, 38, 48);
  text('retroloot', 112, 37, 30, '#ffffff', '800');
  text('PRO', 253, 43, 17, '#39ff72', '800');
  text('Private Clover POS functional review', 112, 73, 16, '#94a3b8', '500');
  text(title, 646, 32, 26, '#f8fafc', '800', 'center');
  text(subtitle, 646, 68, 16, '#94a3b8', '500', 'center');
}

function metric(label, value, detail, x, y, w = 250) {
  roundRect(x, y, w, 92, 12, '#111514', 'rgba(255,255,255,.1)');
  text(label.toUpperCase(), x + 18, y + 16, 13, '#94a3b8', '800');
  text(value, x + 18, y + 42, 27, value.startsWith('$') ? '#39ff72' : '#f8fafc', '800');
  text(detail, x + 18, y + 70, 14, '#94a3b8', '500');
}

function posShell(mode = 'Sell', cartItems = 0, due = 0, customer = 'Walk-in customer') {
  baseFrame('RetroLootPro POS', 'Clover Station Duo 2 register workflow');
  metric('Register', 'Find item', 'Manual or inventory item', 44, 128, 285);
  metric('Customer', customer, 'Credit $0.00', 348, 128, 285);
  metric('Cart Items', String(cartItems), cartItems + ' active', 652, 128, 285);
  metric('Due', money(due), 'After tax / credit', 956, 128, 280);

  const tabs = [
    ['Sell', 44, mode === 'Sell'],
    ['Buy / Trade', 232, mode === 'Trade'],
    ['Customers', 470, mode === 'Customers'],
    ['Checkout', 708, mode === 'Checkout'],
    ['History', 946, mode === 'History'],
  ];
  for (const [label, x, active] of tabs) {
    roundRect(x, 238, label === 'Checkout' ? 206 : 168, 54, 10, active ? '#39ff72' : '#15191a', active ? '#39ff72' : 'rgba(255,255,255,.1)');
    text(label, x + (label === 'Checkout' ? 103 : 84), 254, 18, active ? '#031107' : '#e5e7eb', '800', 'center');
  }

  roundRect(44, 320, 820, 336, 14, '#111514', 'rgba(255,255,255,.1)');
  roundRect(890, 320, 346, 336, 14, '#111514', 'rgba(255,255,255,.1)');
  text('Receipt Cart', 914, 348, 24, '#f8fafc', '800');
  text('Subtotal', 914, 548, 17, '#cbd5e1', '700');
  text(money(due / 1.06 || 0), 1210, 548, 17, '#f8fafc', '700', 'right');
  text('Tax', 914, 582, 17, '#cbd5e1', '700');
  text(money(due - (due / 1.06 || 0)), 1210, 582, 17, '#f8fafc', '700', 'right');
  text('Total', 914, 618, 26, '#ffffff', '900');
  text(money(due), 1210, 618, 28, '#39ff72', '900', 'right');
}

function saleScene(progress) {
  posShell('Sell', progress > .55 ? 1 : 0, progress > .55 ? 1.06 : 0);
  text('Sell: add manual or inventory item', 78, 352, 27, '#f8fafc', '900');
  roundRect(78, 404, 500, 58, 10, '#080a0b', 'rgba(255,255,255,.14)');
  text(progress > .25 ? 'Functional Review Test Item' : 'Manual item, service, or misc sale', 102, 421, 21, progress > .25 ? '#f8fafc' : '#64748b', '600');
  roundRect(598, 404, 190, 58, 10, '#080a0b', 'rgba(255,255,255,.14)');
  text(progress > .42 ? '$1.00' : 'Price', 624, 421, 21, progress > .42 ? '#f8fafc' : '#64748b', '700');
  roundRect(78, 484, 710, 64, 12, progress > .55 ? '#39ff72' : '#152018', progress > .55 ? '#39ff72' : 'rgba(57,255,114,.25)');
  text(progress > .55 ? 'Added to receipt cart' : 'Add Item', 433, 502, 22, progress > .55 ? '#031107' : '#39ff72', '900', 'center');
  if (progress > .55) {
    roundRect(914, 400, 290, 74, 10, '#080a0b', 'rgba(255,255,255,.12)');
    text('Functional Review Test Item', 934, 416, 16, '#f8fafc', '800');
    text('$1.00', 1184, 442, 22, '#39ff72', '900', 'right');
  } else {
    wrap('The POS can add manual sale items or inventory items to the cart for checkout on Clover hardware.', 914, 405, 280, 18, '#94a3b8', '500', 27);
  }
}

function customerScene(progress) {
  posShell('Customers', 1, 1.06, progress > .55 ? 'Review Customer' : 'Walk-in customer');
  text('Customers / Rewards', 78, 352, 27, '#f8fafc', '900');
  roundRect(78, 404, 360, 56, 10, '#080a0b', 'rgba(255,255,255,.14)');
  text(progress > .3 ? 'Review Customer' : 'Search customer...', 102, 421, 20, progress > .3 ? '#f8fafc' : '#64748b', '600');
  roundRect(458, 404, 128, 56, 10, '#161b1a', 'rgba(255,255,255,.14)');
  text('Search', 522, 421, 20, '#f8fafc', '800', 'center');
  roundRect(78, 488, 508, 82, 12, progress > .55 ? '#0d2e18' : '#080a0b', progress > .55 ? '#39ff72' : 'rgba(255,255,255,.12)', 2);
  text('Review Customer', 102, 508, 22, '#ffffff', '900');
  text('Credit $0.00   Lifetime spend $0.00', 102, 540, 17, '#94a3b8', '500');
  wrap('Customer records support rewards, trade credit, and purchase history. Staff can complete checkout for walk-in or known customers.', 914, 400, 280, 18, '#94a3b8', '500', 28);
}

function checkoutScene(progress) {
  posShell('Checkout', 1, 1.06, 'Review Customer');
  roundRect(356, 178, 568, 444, 18, '#101413', 'rgba(255,255,255,.18)', 2);
  text('Checkout', 392, 214, 30, '#ffffff', '900');
  text('Amount due', 392, 265, 17, '#94a3b8', '800');
  text('$1.06', 850, 252, 42, '#39ff72', '900', 'right');
  text('Payment Method', 392, 328, 18, '#ffffff', '800');
  roundRect(392, 362, 496, 58, 10, '#080a0b', '#39ff72', 2);
  text(progress > .45 ? 'Card - Clover' : 'Cash', 416, 379, 21, '#f8fafc', '800');
  if (progress > .45) {
    roundRect(392, 442, 496, 72, 10, '#0d2e18', 'rgba(57,255,114,.35)');
    wrap('Ready to send payment to the Clover Duo. This review video stops before processing a real card charge.', 416, 462, 448, 18, '#d1fae5', '600', 25);
  } else {
    roundRect(392, 442, 236, 58, 10, '#080a0b', 'rgba(255,255,255,.14)');
    text('Cash received', 416, 459, 18, '#94a3b8', '600');
    roundRect(652, 442, 236, 58, 10, '#080a0b', 'rgba(255,255,255,.14)');
    text('Change due', 676, 459, 18, '#94a3b8', '600');
  }
  roundRect(392, 536, 496, 58, 12, '#39ff72', '#39ff72');
  text(progress > .75 ? 'Payment ready for Clover hardware' : 'Complete Sale', 640, 553, 21, '#031107', '900', 'center');
}

function historyScene(progress) {
  posShell('History', 0, 0, 'Review Customer');
  text('Transaction history and reporting', 78, 352, 27, '#f8fafc', '900');
  const rows = [
    ['Functional Review Test Item', 'Card - Clover', '$1.06', 'Recorded'],
    ['Inventory item sale', 'Cash', '$12.99', 'Finance'],
    ['Customer trade credit', 'Store Credit', '$8.00', 'Customer'],
  ];
  let y = 408;
  for (const row of rows) {
    roundRect(78, y, 712, 58, 10, '#080a0b', 'rgba(255,255,255,.12)');
    text(row[0], 100, y + 18, 17, '#ffffff', '800');
    text(row[1], 392, y + 18, 16, '#94a3b8', '700');
    text(row[2], 620, y + 17, 20, '#39ff72', '900', 'right');
    text(row[3], 756, y + 18, 16, '#cbd5e1', '700', 'right');
    y += 72;
  }
  wrap('Completed POS activity records transactions in RetroLootPro finance reports and supports void/refund workflows for store operations.', 914, 400, 280, 18, '#94a3b8', '500', 28);
}

function titleScene() {
  baseFrame('RetroLootPro on Clover', 'Functional usage video for private app review');
  logo(562, 182, 156);
  text('RetroLootPro POS', 640, 374, 48, '#ffffff', '900', 'center');
  text('Private in-store register for resale operations', 640, 432, 25, '#94a3b8', '600', 'center');
  roundRect(408, 498, 464, 58, 14, '#39ff72', '#39ff72');
  text('No real card payment is processed in this video', 640, 516, 20, '#031107', '900', 'center');
}

function draw() {
  const elapsed = performance.now() - started;
  const t = Math.min(elapsed / DURATION, 1);
  if (t < .13) titleScene();
  else if (t < .35) saleScene((t - .13) / .22);
  else if (t < .52) customerScene((t - .35) / .17);
  else if (t < .78) checkoutScene((t - .52) / .26);
  else historyScene((t - .78) / .22);
  requestAnimationFrame(draw);
}

async function main() {
  const preferred = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
  ];
  const mimeType = preferred.find((type) => MediaRecorder.isTypeSupported(type)) || '';
  const recorder = new MediaRecorder(canvas.captureStream(30), mimeType ? { mimeType, videoBitsPerSecond: 3500000 } : undefined);
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size) chunks.push(event.data);
  };
  recorder.onstop = async () => {
    const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
    await fetch('/upload', {
      method: 'POST',
      headers: { 'content-type': blob.type || 'application/octet-stream' },
      body: blob
    });
    document.body.dataset.done = 'true';
  };
  draw();
  recorder.start(250);
  setTimeout(() => recorder.stop(), DURATION + 750);
}

main().catch(async (error) => {
  await fetch('/error', { method: 'POST', body: String(error && error.stack || error) });
});
</script>
</body>
</html>`;

function run() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
      if (req.method === 'POST' && req.url === '/upload') {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          const contentType = req.headers['content-type'] || 'video/webm';
          const ext = contentType.includes('mp4') ? 'mp4' : 'webm';
          const output = path.join(outDir, `retrolootpro-clover-functional-review.${ext}`);
          fs.writeFileSync(output, Buffer.concat(chunks));
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end('saved');
          resolve(output);
          setTimeout(() => server.close(), 100);
        });
        return;
      }
      if (req.method === 'POST' && req.url === '/error') {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => reject(new Error(Buffer.concat(chunks).toString('utf8'))));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'retroloot-video-chrome-'));
      const chrome = spawn(chromePath, [
        '--headless=new',
        '--disable-gpu',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--autoplay-policy=no-user-gesture-required',
        '--window-size=1280,720',
        `--user-data-dir=${profile}`,
        `http://127.0.0.1:${port}/`,
      ], { stdio: 'ignore' });

      const timeout = setTimeout(() => {
        chrome.kill();
        reject(new Error('Timed out while recording the functional review video.'));
      }, 90000);

      Promise.resolve().then(() => undefined).finally(() => {
        const cleanup = () => {
          clearTimeout(timeout);
          try { chrome.kill(); } catch {}
        };
        server.once('close', cleanup);
      });
    });
  });
}

run()
  .then((output) => {
    console.log(output);
    process.exit(0);
  })
  .catch((error) => {
    console.error(error.stack || error.message || error);
    process.exit(1);
  });
