import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { db, q, nowIso } from './db.js';

export const ENV = process.env.PUFFWATT_ENV || (process.env.NODE_ENV === 'production' ? 'production' : 'development');
export const IS_PROD = ENV === 'production';

export function hashPassword(pw) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(pw, salt, 64).toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  if (!stored) return false;
  const [, salt, hash] = stored.split('$');
  const a = Buffer.from(hash, 'hex'), b = scryptSync(pw, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}
export const ipHash = (ip) => createHash('sha256').update(ip || '').digest('hex').slice(0, 16);

export function createSession(userId, kind = 'password') {
  const token = randomBytes(32).toString('base64url');
  const exp = new Date(Date.now() + 7 * 864e5).toISOString();
  q.run('INSERT INTO sessions (token,userId,kind,createdAt,expiresAt) VALUES (?,?,?,?,?)', token, userId, kind, nowIso(), exp);
  q.run('UPDATE users SET lastSignedIn=? WHERE id=?', nowIso(), userId);
  return token;
}
export function destroySession(token) { if (token) q.run('DELETE FROM sessions WHERE token=?', token); }

export function loadUser(userId) {
  const u = q.get('SELECT * FROM users WHERE id=?', userId);
  if (!u) return null;
  u.roles = q.all('SELECT role FROM user_roles WHERE userId=? AND isActive=1', userId).map(r => r.role);
  // effective tier: active manual override wins
  const ov = q.get(`SELECT * FROM manual_overrides WHERE userId=? AND overrideType='TIER' AND revertedAt IS NULL AND startsAt<=? AND (endsAt IS NULL OR endsAt>?) ORDER BY id DESC LIMIT 1`, userId, nowIso(), nowIso());
  u.autoTierCode = u.tierCode;
  if (ov) { u.tierCode = ov.afterValue; u.tierOverride = ov; }
  delete u.passwordHash;
  return u;
}
export function userFromToken(token) {
  if (!token) return null;
  const s = q.get('SELECT * FROM sessions WHERE token=? AND expiresAt>?', token, nowIso());
  return s ? loadUser(s.userId) : null;
}
export const hasRole = (u, ...roles) => !!u && roles.some(r => u.roles.includes(r));
export const isAdmin = (u) => hasRole(u, 'ADMIN', 'SUPER_ADMIN');

export function parseCookies(h = '') {
  return Object.fromEntries(h.split(';').map(s => s.trim()).filter(Boolean).map(s => { const i = s.indexOf('='); return [s.slice(0, i), decodeURIComponent(s.slice(i + 1))]; }));
}
export function cookieHeader(token, clear = false) {
  const base = `pw_session=${clear ? '' : token}; Path=/; HttpOnly; SameSite=Lax${IS_PROD ? '; Secure' : ''}`;
  return clear ? `${base}; Max-Age=0` : `${base}; Max-Age=${7 * 86400}`;
}
export function flag(key) { const f = q.get('SELECT enabled FROM feature_flags WHERE key=?', key); return !!(f && f.enabled); }
export function flags() { return Object.fromEntries(q.all('SELECT key,enabled FROM feature_flags').map(f => [f.key, !!f.enabled])); }
export function audit(adminId, action, objectType, objectId, before, after, reason, ip) {
  q.run('INSERT INTO admin_audit_logs (adminId,action,objectType,objectId,beforeJson,afterJson,reason,ipHash) VALUES (?,?,?,?,?,?,?,?)',
    adminId, action, objectType, String(objectId ?? ''), before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), reason || null, ipHash(ip));
}
export class HttpError extends Error { constructor(status, code, message) { super(message || code); this.status = status; this.code = code; } }
