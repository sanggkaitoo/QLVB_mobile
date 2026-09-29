// Auth broker: đăng nhập SSO login.yenbai.gov.vn (WSO2) thay cho trình duyệt, trả token cho PWA.
// Mỗi lượt đăng nhập dùng 1 cookie jar riêng trong RAM và bị xoá ngay sau khi xong/hết hạn,
// nên 2 tài khoản (egov1 / csdlvb) không bao giờ dùng chung phiên SSO. Không lưu mật khẩu.
import { randomUUID } from 'node:crypto';

const SSO = 'https://login.yenbai.gov.vn';
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36';
const SESSION_TTL_MS = 5 * 60 * 1000;

export const SYSTEMS = {
  egov1: {
    label: 'egov1 – Quản lý điều hành',
    redirectUri: 'https://egov1.laocai.gov.vn/account/signin',
    authorizeUrl() {
      const q = new URLSearchParams({
        client_id: 'b9536f8a-7e5a-45b9-b38b-6b01c2402468',
        redirect_uri: this.redirectUri,
        scope: 'jwt,ssolcinew',
        response_type: 'code',
      });
      return `https://id.vnpthub.vn/OAuth/Authorize?${q}`;
    },
    async exchange(code) {
      const q = new URLSearchParams({ code, returlUrl: this.redirectUri, domain: 'https://egov1.laocai.gov.vn' });
      const res = await fetch(`https://egov-gateway.laocai.gov.vn/iwork/Oauth/api/v1/ProcessAuthCode?${q}`, {
        headers: { 'user-agent': UA, accept: 'application/json' },
      });
      const j = await res.json();
      if (j.code !== 'OK' || !j.value?.token?.accessToken) {
        const reason = String(j.message || '').match(/"error":"([^"]+)"/)?.[1] || String(j.message || '').slice(0, 120);
        throw new Error(`Đổi mã đăng nhập egov1 thất bại${reason ? ` (${reason})` : ''}`);
      }
      const { user, token } = j.value;
      return {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: jwtExp(token.accessToken),
        user: {
          name: user.fullName,
          userName: user.userName,
          unit: user.infoCompany?.name,
          permissions: (user.permissions || []).filter((p) => p.startsWith('IOFFICE_')),
        },
      };
    },
  },
  csdlvb: {
    label: 'csdlvb – CSDL văn bản (Data360X)',
    redirectUri: 'https://csdlvb.laocai.gov.vn/callback',
    authorizeUrl() {
      const q = new URLSearchParams({
        response_type: 'code',
        client_id: 'aqM9zYzuhhGOEbUp11c6tHa5Mf0a',
        redirect_uri: this.redirectUri,
        scope: 'openid',
      });
      return `${SSO}/oauth2/authorize?${q}`;
    },
    async exchange(code) {
      const q = new URLSearchParams({ code, redirectUri: this.redirectUri });
      const res = await fetch(`https://csdlvb.laocai.gov.vn/identity/api/SSO/exchange-token?${q}`, {
        headers: { 'user-agent': UA, accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`Đổi mã đăng nhập csdlvb thất bại (HTTP ${res.status})`);
      const j = await res.json();
      if (!j.access_token) throw new Error('csdlvb không trả access_token');
      let name = j.sdt;
      try {
        const info = await fetch('https://csdlvb.laocai.gov.vn/identity/connect/userinfo', {
          headers: { authorization: `Bearer ${j.access_token}`, 'user-agent': UA },
        }).then((r) => r.json());
        name = info.name || name;
        if (info.role) name += ` (${info.role})`;
      } catch {}
      return {
        accessToken: j.access_token,
        refreshToken: null,
        expiresAt: Date.now() + (j.expires_in || 3600) * 1000,
        user: { name, userName: j.sdt },
      };
    },
  },
};

function jwtExp(jwt) {
  try {
    return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).exp * 1000;
  } catch {
    return Date.now() + 30 * 60 * 1000;
  }
}

// Cookie jar tối giản: đủ cho luồng redirect SSO (theo host, bỏ qua path/expiry).
class Jar {
  #byHost = new Map();
  store(url, res) {
    const host = new URL(url).host;
    const list = res.headers.getSetCookie?.() ?? [];
    const jar = this.#byHost.get(host) ?? new Map();
    for (const c of list) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    this.#byHost.set(host, jar);
  }
  header(url) {
    const jar = this.#byHost.get(new URL(url).host);
    return jar ? [...jar].map(([k, v]) => `${k}=${v}`).join('; ') : '';
  }
}

async function req(jar, url, init = {}) {
  const headers = { 'user-agent': UA, ...(init.headers || {}) };
  const cookie = jar.header(url);
  if (cookie) headers.cookie = cookie;
  const res = await fetch(url, { ...init, headers, redirect: 'manual' });
  jar.store(url, res);
  return res;
}

// Đi theo redirect thủ công; dừng khi gặp URL thoả `stop` (không gọi tới URL đó).
async function follow(jar, url, stop, init) {
  for (let i = 0; i < 15; i++) {
    if (stop(url)) return { url };
    const res = await req(jar, url, i === 0 ? init : undefined);
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      url = new URL(loc, url).href;
      continue;
    }
    return { url, res };
  }
  throw new Error('Quá nhiều bước chuyển hướng');
}

const sessions = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.created > SESSION_TTL_MS) sessions.delete(id);
}, 30_000).unref();

async function fetchCaptcha(s) {
  const r = await req(s.jar, `${SSO}/vnconnect-api/password/generate/captchalogin?sessionDataKey=${s.sessionDataKey}`);
  const j = await r.json();
  if (j.status !== 'SUCCESS') throw new Error('Không lấy được mã xác thực');
  return `data:image/png;base64,${j.message}`;
}

export async function startLogin(sys) {
  const cfg = SYSTEMS[sys];
  if (!cfg) throw new Error('Hệ thống không hợp lệ');
  const jar = new Jar();
  const { url } = await follow(jar, cfg.authorizeUrl(), (u) => u.includes('/authenticationendpoint/login.do'));
  const sessionDataKey = new URL(url).searchParams.get('sessionDataKey');
  if (!sessionDataKey) throw new Error('Không mở được trang đăng nhập SSO');
  const relyingParty = new URL(url).searchParams.get('relyingParty');
  await req(jar, `${SSO}/logincontext?sessionDataKey=${sessionDataKey}&relyingParty=${relyingParty}&tenantDomain=carbon.super`).catch(() => {});
  const s = { id: randomUUID(), sys, jar, sessionDataKey, created: Date.now() };
  sessions.set(s.id, s);
  return { loginId: s.id, captcha: await fetchCaptcha(s) };
}

export async function newCaptcha(loginId) {
  const s = sessions.get(loginId);
  if (!s) throw Object.assign(new Error('Phiên đăng nhập đã hết hạn, hãy bắt đầu lại'), { expired: true });
  return { captcha: await fetchCaptcha(s) };
}

export async function finishLogin(loginId, username, password, captcha) {
  const s = sessions.get(loginId);
  if (!s) throw Object.assign(new Error('Phiên đăng nhập đã hết hạn, hãy bắt đầu lại'), { expired: true });
  const cfg = SYSTEMS[s.sys];
  username = String(username || '').trim();

  const chk = await req(s.jar, `${SSO}/vnconnect-api/active/check`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, sessionDataKey: s.sessionDataKey, captchaLogin: captcha }),
  }).then((r) => r.json());
  if (chk.status !== 'SUCCESS') {
    // Mã sai: giữ phiên, cấp captcha mới để nhập lại.
    return { ok: false, error: chk.message || 'Mã xác thực không đúng', captcha: await fetchCaptcha(s) };
  }

  const form = new URLSearchParams({
    usernameUserInput: username,
    username: `${username}@carbon.super`,
    password,
    captcha,
    sessionDataKey: s.sessionDataKey,
  });
  const { url } = await follow(s.jar, `${SSO}/commonauth`, (u) => u.startsWith(cfg.redirectUri) || u.includes('authFailure=true'), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  sessions.delete(loginId);

  const params = new URL(url).searchParams;
  const code = params.get('code');
  if (!code) {
    const msg = params.get('errorMessage') || params.get('authFailureMsg');
    return { ok: false, restart: true, error: msg === 'login.fail.message' || !msg ? 'Sai tài khoản hoặc mật khẩu' : msg };
  }
  return { ok: true, sys: s.sys, ...(await cfg.exchange(code)) };
}
