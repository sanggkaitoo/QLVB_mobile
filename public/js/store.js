// Token của từng hệ thống lưu tách namespace trên máy (không bao giờ dùng chung).
const key = (sys) => `qlvb.auth.${sys}`;

export const auth = {
  get(sys) {
    try {
      return JSON.parse(localStorage.getItem(key(sys)));
    } catch {
      return null;
    }
  },
  set(sys, value) {
    localStorage.setItem(key(sys), JSON.stringify(value));
  },
  clear(sys) {
    localStorage.removeItem(key(sys));
  },
  valid(sys) {
    const a = this.get(sys);
    return a && a.accessToken && a.expiresAt > Date.now() + 30_000 ? a : null;
  },
};

export class AuthError extends Error {
  constructor(sys) {
    super(`Phiên đăng nhập ${sys} đã hết hạn`);
    this.sys = sys;
  }
}

export function fmtDate(v) {
  if (!v) return '';
  if (/^\d{2}\/\d{2}\/\d{4}/.test(v)) return v.slice(0, 10);
  const d = new Date(v);
  return isNaN(d) ? String(v) : d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Chuyển "dd/mm/yyyy[ hh:mm]" hoặc ISO thành mốc thời gian để sắp xếp; không đọc được → NaN.
export function toTime(v) {
  if (!v) return NaN;
  const m = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)).getTime();
  return new Date(v).getTime();
}

export function stripTags(s) {
  return String(s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}
