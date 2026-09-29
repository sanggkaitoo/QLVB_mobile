// Máy chủ QLVB Mobile: phục vụ PWA tĩnh + 3 endpoint đăng nhập. Không có database, không log dữ liệu.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { startLogin, newCaptcha, finishLogin, SYSTEMS } from './lib/sso.js';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
// Máy chủ *.laocai.gov.vn gửi thiếu chứng chỉ trung gian GlobalSign; trình duyệt tự bù, Node thì không.
// Nạp bổ sung 2 intermediate (vẫn giữ kiểm tra TLS đầy đủ). Biến này chỉ có hiệu lực lúc khởi động
// nên nếu chưa đặt thì tự chạy lại tiến trình con kèm biến.
const EXTRA_CA = fileURLToPath(new URL('./certs/globalsign-intermediates.pem', import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'cache-control': 'no-store', ...headers });
  res.end(body);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), { 'content-type': 'application/json; charset=utf-8' });

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new Error('Body quá lớn');
  }
  return raw ? JSON.parse(raw) : {};
}

// Giới hạn đơn giản chống dò mật khẩu: 20 lượt /auth mỗi IP mỗi 10 phút.
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 600_000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 20;
}

async function api(req, res, path) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  if (limited(ip)) return json(res, 429, { error: 'Thử quá nhiều lần, đợi vài phút' });
  const body = await readJson(req);
  if (path === '/api/auth/start') {
    if (!SYSTEMS[body.sys]) return json(res, 400, { error: 'Hệ thống không hợp lệ' });
    return json(res, 200, await startLogin(body.sys));
  }
  if (path === '/api/auth/captcha') return json(res, 200, await newCaptcha(body.loginId));
  if (path === '/api/auth/finish') {
    if (!body.username || !body.password || !body.captcha) return json(res, 400, { error: 'Thiếu tài khoản, mật khẩu hoặc mã xác thực' });
    return json(res, 200, await finishLogin(body.loginId, body.username, body.password, body.captcha));
  }
  return json(res, 404, { error: 'Not found' });
}

async function serveStatic(req, res, path) {
  if (path === '/') path = '/index.html';
  const file = normalize(join(PUBLIC, path));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden');
  try {
    if (!(await stat(file)).isFile()) throw new Error();
    const type = TYPES[extname(file)] || 'application/octet-stream';
    const cache = path === '/sw.js' || path === '/index.html' ? 'no-cache' : 'public, max-age=300';
    send(res, 200, await readFile(file), { 'content-type': type, 'cache-control': cache });
  } catch {
    send(res, 404, 'Not found');
  }
}

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
};

function start() {
  http
    .createServer(async (req, res) => {
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
      const path = new URL(req.url, 'http://x').pathname;
      try {
        if (path.startsWith('/api/')) return await api(req, res, path);
        return await serveStatic(req, res, path);
      } catch (e) {
        const cause = e.cause?.code || e.cause?.message;
        if (!e.expired) console.error(path, e.message, cause || '');
        json(res, e.expired ? 410 : 502, {
          error: cause ? `Không kết nối được máy chủ SSO/QLVB (${cause})` : e.message || 'Lỗi máy chủ',
          expired: !!e.expired,
        });
      }
    })
    .listen(PORT, HOST, () => console.log(`QLVB Mobile: http://localhost:${PORT}`));
}

if (process.env.NODE_EXTRA_CA_CERTS) start();
else {
  const child = spawn(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, NODE_EXTRA_CA_CERTS: EXTRA_CA },
  });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
  child.on('exit', (code) => process.exit(code ?? 0));
}
