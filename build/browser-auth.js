// Browser replacement for server/auth.js — no Node crypto (demo-grade hashing; not for production).
const ENV = 'development', IS_PROD = false;
const djb = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i); return (h >>> 0).toString(16); };
function hashPassword(pw) { const salt = Math.random().toString(36).slice(2, 10); return `djb$${salt}$${djb(salt + pw)}`; }
function verifyPassword(pw, stored) { if (!stored) return false; const [, salt, h] = stored.split('$'); return djb(salt + pw) === h; }
const ipHash = () => 'local';
function createSession(userId, kind = 'password') { const token = Math.random().toString(36).slice(2) + Date.now().toString(36); q.run('INSERT INTO sessions (token,userId,kind,createdAt,expiresAt) VALUES (?,?,?,?,?)', token, userId, kind, nowIso(), new Date(Date.now() + 7 * 864e5).toISOString()); q.run('UPDATE users SET lastSignedIn=? WHERE id=?', nowIso(), userId); return token; }
function destroySession(token) { if (token) q.run('DELETE FROM sessions WHERE token=?', token); }
function loadUser(userId) {
  const u = q.get('SELECT * FROM users WHERE id=?', userId); if (!u) return null;
  u.roles = q.all('SELECT role FROM user_roles WHERE userId=? AND isActive=1', userId).map(r => r.role);
  const ov = q.get(`SELECT * FROM manual_overrides WHERE userId=? AND overrideType='TIER' AND revertedAt IS NULL AND startsAt<=? AND (endsAt IS NULL OR endsAt>?) ORDER BY id DESC LIMIT 1`, userId, nowIso(), nowIso());
  u.autoTierCode = u.tierCode; if (ov) { u.tierCode = ov.afterValue; u.tierOverride = ov; }
  delete u.passwordHash; return u;
}
function userFromToken(token) { if (!token) return null; const s = q.get('SELECT * FROM sessions WHERE token=? AND expiresAt>?', token, nowIso()); return s ? loadUser(s.userId) : null; }
const hasRole = (u, ...roles) => !!u && roles.some(r => u.roles.includes(r));
const isAdmin = (u) => hasRole(u, 'ADMIN', 'SUPER_ADMIN');
function parseCookies(h = '') { return Object.fromEntries(h.split(';').map(s => s.trim()).filter(Boolean).map(s => { const i = s.indexOf('='); return [s.slice(0, i), decodeURIComponent(s.slice(i + 1))]; })); }
function cookieHeader(token, clear = false) { return clear ? 'pw_session=; Max-Age=0' : `pw_session=${token}`; }
function flag(key) { const f = q.get('SELECT enabled FROM feature_flags WHERE key=?', key); return !!(f && f.enabled); }
function flags() { return Object.fromEntries(q.all('SELECT key,enabled FROM feature_flags').map(f => [f.key, !!f.enabled])); }
function audit(adminId, action, objectType, objectId, before, after, reason, ip) { q.run('INSERT INTO admin_audit_logs (adminId,action,objectType,objectId,beforeJson,afterJson,reason,ipHash) VALUES (?,?,?,?,?,?,?,?)', adminId, action, objectType, String(objectId ?? ''), before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), reason || null, 'local'); }
class HttpError extends Error { constructor(status, code, message) { super(message || code); this.status = status; this.code = code; } }
const process = { env: {} };
