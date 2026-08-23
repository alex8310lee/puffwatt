import { q, tx, nowIso } from './db.js';
import { seed, DEMO_PW } from './seed.js';
import * as S from './services.js';
import { IS_PROD, ENV, userFromToken, hashPassword, verifyPassword, createSession, destroySession, parseCookies, cookieHeader, HttpError, flag, flags, hasRole, isAdmin, loadUser } from './auth.js';
export const JOB_TOKEN = process.env.PUFFWATT_JOB_TOKEN || (IS_PROD ? null : 'dev-job-token');
export const routes = [];
const on = (method, pattern, handler, opts = {}) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, ...opts });
const need = (u) => { if (!u) throw new HttpError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.'); };
const needAdmin = (u) => { need(u); if (!isAdmin(u)) throw new HttpError(403, 'ADMIN_REQUIRED', '관리자 권한이 필요합니다.'); };

// ---- auth
on('GET', '/api/auth/me', ({ user }) => ({ user: user ? S.publicUser(user) : null, env: ENV, demoEnabled: !IS_PROD && flag('ENABLE_DEMO_LOGIN') }));
on('GET', '/api/auth/demo-accounts', () => {
  if (IS_PROD || !flag('ENABLE_DEMO_LOGIN')) throw new HttpError(404, 'DEMO_DISABLED');
  return q.all('SELECT id,email,name,tierCode,creatorTier,sellerStatus FROM users WHERE isDemo=1 ORDER BY id').map(u => ({ ...u, roles: q.all('SELECT role FROM user_roles WHERE userId=?', u.id).map(r => r.role), wallet: S.wallet(u.id).available }));
});
on('POST', '/api/auth/demo-login', ({ body, res }) => {
  if (IS_PROD || !flag('ENABLE_DEMO_LOGIN')) throw new HttpError(404, 'DEMO_DISABLED');
  const u = q.get('SELECT id FROM users WHERE email=? AND isDemo=1', body.email); if (!u) throw new HttpError(404, 'NO_ACCOUNT');
  res.setHeader('Set-Cookie', cookieHeader(createSession(u.id, 'demo'))); return { user: S.publicUser(loadUser(u.id)) };
});
on('POST', '/api/auth/login', ({ body, res }) => {
  const u = q.get('SELECT id, passwordHash FROM users WHERE email=?', String(body.email || '').toLowerCase());
  if (!u || !verifyPassword(String(body.password || ''), u.passwordHash)) throw new HttpError(401, 'BAD_CREDENTIALS', '이메일 또는 비밀번호가 올바르지 않습니다.');
  res.setHeader('Set-Cookie', cookieHeader(createSession(u.id, 'password'))); return { user: S.publicUser(loadUser(u.id)) };
});
on('GET', '/api/auth/invitation/:code', ({ params }) => {
  const inv = q.get('SELECT * FROM invitations WHERE code=?', params.code.toUpperCase());
  if (!inv || inv.status !== 'ACTIVE' || inv.usedCount >= inv.maxUses || (inv.expiresAt && inv.expiresAt < nowIso())) throw new HttpError(404, 'INVALID_INVITATION', '유효하지 않은 초대 코드입니다.');
  const inviter = inv.inviterUserId ? q.get('SELECT name FROM users WHERE id=?', inv.inviterUserId) : null;
  return { code: inv.code, tierCode: inv.tierCode || 'STANDARD', inviter: inviter ? inviter.name.slice(0, 1) + '○' + inviter.name.slice(-1) : null, remaining: inv.maxUses - inv.usedCount };
});
on('POST', '/api/auth/signup', ({ body, res }) => {
  const email = String(body.email || '').toLowerCase().trim(); const pw = String(body.password || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'BAD_EMAIL', '이메일 형식을 확인하세요.');
  if (pw.length < 8) throw new HttpError(400, 'WEAK_PASSWORD', '비밀번호는 8자 이상이어야 합니다.');
  const id = tx(() => {
    const inv = q.get('SELECT * FROM invitations WHERE code=?', String(body.code || '').toUpperCase());
    if (!inv || inv.status !== 'ACTIVE' || inv.usedCount >= inv.maxUses || (inv.expiresAt && inv.expiresAt < nowIso())) throw new HttpError(400, 'INVALID_INVITATION', '유효하지 않은 초대 코드입니다.');
    if (q.get('SELECT 1 FROM users WHERE email=?', email)) throw new HttpError(409, 'EMAIL_TAKEN', '이미 가입된 이메일입니다.');
    const n = q.get('SELECT COUNT(*) n FROM users').n + 1;
    const r = q.run('INSERT INTO users (email,passwordHash,name,memberCode,tierCode,referralCode) VALUES (?,?,?,?,?,?)', email, hashPassword(pw), body.name || email.split('@')[0], `PW-${String(n).padStart(6, '0')}`, inv.tierCode || 'STANDARD', `PW-${inv.tierCode || 'STD'}-${2000 + n}`);
    const uid = Number(r.lastInsertRowid);
    q.run('INSERT INTO user_roles (userId,role,source) VALUES (?,?,?)', uid, inv.allowedRole || 'GENERAL', 'invitation');
    q.run('UPDATE invitations SET usedCount=usedCount+1 WHERE id=?', inv.id);
    if (inv.inviterUserId) {
      q.run('INSERT INTO referral_relations (referredUserId,referrerUserId,level,sourceCode) VALUES (?,?,1,?)', uid, inv.inviterUserId, inv.code);
      const up = q.get('SELECT referrerUserId FROM referral_relations WHERE referredUserId=? AND level=1', inv.inviterUserId);
      if (up) q.run('INSERT INTO referral_relations (referredUserId,referrerUserId,level,sourceCode) VALUES (?,?,2,?)', uid, up.referrerUserId, inv.code);
    }
    q.run('INSERT INTO user_titles (userId,titleCode,earnedAt) VALUES (?,?,?)', uid, 'FIRST_LIGHT', nowIso()); q.run('UPDATE users SET featuredTitle=? WHERE id=?', 'FIRST_LIGHT', uid);
    const credit = q.get('SELECT monthlyCredit FROM policy_tier_rules WHERE policyVersionId=? AND tierCode=?', S.activePolicy().id, inv.tierCode || 'STANDARD');
    if (credit?.monthlyCredit) q.run(`INSERT INTO point_ledger (userId,pointType,entryType,status,amount,remainingAmount,sourceType,idempotencyKey,availableAt,expiresAt,reason) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, uid, 'MONTHLY_CREDIT', 'CREDIT', 'AVAILABLE', credit.monthlyCredit, credit.monthlyCredit, 'WELCOME', `welcome:${uid}`, nowIso(), new Date(Date.now() + 60 * 864e5).toISOString(), '가입 베네핏');
    return uid;
  });
  res.setHeader('Set-Cookie', cookieHeader(createSession(id, 'password'))); return { user: S.publicUser(loadUser(id)) };
});
on('POST', '/api/auth/logout', ({ token, res }) => { destroySession(token); res.setHeader('Set-Cookie', cookieHeader('', true)); return { ok: true }; });

// ---- member
on('GET', '/api/club', ({ user }) => { need(user); return S.clubHome(user); });
on('GET', '/api/catalog', ({ user, query }) => { need(user); return { items: S.catalog(user, query), policyVersion: S.activePolicy().version }; });
on('GET', '/api/product/:id', ({ user, params, query }) => { need(user); return S.productDetail(user, params.id, { requestedPoint: query.point == null ? undefined : Number(query.point), quantity: Number(query.qty || 1), couponId: query.coupon === 'none' ? null : undefined, voucherId: query.voucher === 'none' ? null : undefined }); });
on('GET', '/api/cart', ({ user, query }) => { need(user); return S.cart(user, { requestedPoint: query.point == null ? undefined : Number(query.point), couponId: query.coupon === 'none' ? null : undefined, voucherId: query.voucher === 'none' ? null : undefined }); });
on('POST', '/api/cart/add', ({ user, body }) => { need(user); S.addToCart(user, body.productId, body.quantity | 0 || 1); return S.cart(user); });
on('POST', '/api/cart/remove', ({ user, body }) => { need(user); S.removeCartItem(user, body.cartItemId); return S.cart(user); });
on('POST', '/api/checkout', ({ user, body }) => { need(user); return S.checkout(user, { requestedPoint: body.requestedPoint == null ? undefined : Number(body.requestedPoint), couponId: body.useCoupon === false ? null : undefined, voucherId: body.useVoucher === false ? null : undefined }); });
on('GET', '/api/orders', ({ user }) => { need(user); return { orders: S.orders(user) }; });
on('GET', '/api/orders/:id', ({ user, params }) => { need(user); return S.orderDetail(user, Number(params.id)); });
on('POST', '/api/orders/:id/confirm', ({ user, params }) => { need(user); return S.confirmOrder(user, Number(params.id)); });
on('POST', '/api/orders/:id/cancel', ({ user, params, body }) => { need(user); return S.cancelOrder(user, Number(params.id), body.reason); });
on('POST', '/api/orders/:id/return', ({ user, params, body }) => { need(user); return S.partialReturn(user, Number(params.id), Number(body.orderItemId), Number(body.quantity || 1), body.reason); });
on('GET', '/api/rewards', ({ user }) => { need(user); return S.rewardsDashboard(user); });
on('GET', '/api/quests', ({ user }) => { need(user); return { quests: S.quests(user) }; });
on('POST', '/api/quests/:id/complete', ({ user, params, body }) => { need(user); return S.completeQuest(user, Number(params.id), body); });
on('GET', '/api/achievements', ({ user }) => { need(user); return S.achievements(user); });
on('POST', '/api/achievements/title', ({ user, body }) => { need(user); S.setFeaturedTitle(user, body.code); return { ok: true }; });
on('POST', '/api/notifications/read', ({ user }) => { need(user); q.run('UPDATE notifications SET readAt=? WHERE userId=? AND readAt IS NULL', nowIso(), user.id); return { ok: true }; });

// ---- creator / opportunities / seller
on('GET', '/api/creator', ({ user }) => { need(user); return S.creatorWorkspace(user); });
on('POST', '/api/creator/profile', ({ user, body }) => { need(user); S.saveProfile(user, body); return S.creatorWorkspace(user); });
on('POST', '/api/creator/social', ({ user, body }) => { need(user); S.saveSocial(user, body); return S.creatorWorkspace(user); });
on('POST', '/api/creator/rate-card', ({ user, body }) => { need(user); S.saveRateCard(user, body); return S.creatorWorkspace(user); });
on('POST', '/api/creator/rate-card/delete', ({ user, body }) => { need(user); S.deleteRateCard(user, body.id); return S.creatorWorkspace(user); });
on('GET', '/api/opportunities', ({ user }) => { need(user); return { list: S.listOpportunities(user) }; });
on('GET', '/api/opportunities/:id', ({ user, params }) => { need(user); return S.opportunityDetail(user, Number(params.id)); });
on('POST', '/api/opportunities/:id/respond', ({ user, params, body }) => { need(user); S.respondOpportunity(user, Number(params.id), body.action); return S.opportunityDetail(user, Number(params.id)); });
on('POST', '/api/opportunities/:id/ask', ({ user, params, body }) => { need(user); S.askQuestion(user, Number(params.id), body.body); return S.opportunityDetail(user, Number(params.id)); });
on('POST', '/api/opportunities/:id/submit', ({ user, params, body }) => { need(user); S.submitDeliverable(user, Number(params.id), body); return S.opportunityDetail(user, Number(params.id)); });
on('GET', '/api/seller', ({ user }) => { need(user); return S.sellerHome(user); });

// ---- admin
on('GET', '/api/admin/overview', ({ user }) => { needAdmin(user); return S.adminOverview(); });
on('GET', '/api/admin/members', ({ user, query }) => { needAdmin(user); return { members: S.adminMembers(query) }; });
on('GET', '/api/admin/members/:id', ({ user, params }) => { needAdmin(user); return S.adminMemberDetail(Number(params.id)); });
on('POST', '/api/admin/members/:id/roles', ({ user, params, body, ip }) => { needAdmin(user); S.adminUpdateRoles(user, Number(params.id), body.roles || [], body.reason, ip); return S.adminMemberDetail(Number(params.id)); });
on('POST', '/api/admin/members/:id/override', ({ user, params, body, ip }) => { needAdmin(user); S.adminSetOverride(user, Number(params.id), body, ip); return S.adminMemberDetail(Number(params.id)); });
on('POST', '/api/admin/members/:id/points', ({ user, params, body, ip }) => { needAdmin(user); S.adminPointAdjust(user, Number(params.id), body, ip); return S.adminMemberDetail(Number(params.id)); });
on('GET', '/api/admin/policies', ({ user }) => { needAdmin(user); return { policies: S.adminPolicies(), flags: flags() }; });
on('POST', '/api/admin/policies', ({ user, body, ip }) => { needAdmin(user); return { id: S.adminCreatePolicy(user, body, ip) }; });
on('POST', '/api/admin/policies/:id/activate', ({ user, params, body, ip }) => { needAdmin(user); S.adminActivatePolicy(user, Number(params.id), body.reason, ip); return { ok: true }; });
on('POST', '/api/admin/flags', ({ user, body, ip }) => { needAdmin(user); S.adminSetFlag(user, body.key, !!body.enabled, body.reason, ip); return { flags: flags() }; });
on('GET', '/api/admin/commerce', ({ user }) => { needAdmin(user); return S.adminCommerce(); });
on('POST', '/api/admin/orders/:id/refund', ({ user, params, body, ip }) => { needAdmin(user); return S.adminRefund(user, Number(params.id), body, ip); });
on('GET', '/api/admin/creators', ({ user }) => { needAdmin(user); return { creators: S.adminCreators() }; });
on('POST', '/api/admin/social/:id/review', ({ user, params, body, ip }) => { needAdmin(user); S.adminReviewSocial(user, Number(params.id), body.status, body.reason, ip); return { ok: true }; });
on('GET', '/api/admin/opportunities', ({ user }) => { needAdmin(user); return { list: S.adminOpportunities() }; });
on('POST', '/api/admin/opportunities/:id/invite', ({ user, params, body, ip }) => { needAdmin(user); S.adminInvite(user, Number(params.id), Number(body.userId), body.rewardAmount, ip); return { ok: true }; });
on('POST', '/api/admin/submissions/:id/review', ({ user, params, body, ip }) => { needAdmin(user); S.adminApproveSubmission(user, Number(params.id), !!body.approve, body.feedback, ip); return { ok: true }; });
on('GET', '/api/admin/audit', ({ user }) => { needAdmin(user); return { logs: S.adminAudit() }; });
on('POST', '/api/admin/jobs/:job', ({ user, params, body, ip }) => { needAdmin(user); const r = S.runJob(params.job, body.periodKey); return { result: r }; });
// scheduled endpoint (system auth)
on('POST', '/api/jobs/:job', ({ params, headers }) => { if (!JOB_TOKEN || headers['x-job-token'] !== JOB_TOKEN) throw new HttpError(403, 'JOB_AUTH'); return { result: S.runJob(params.job) }; });
on('GET', '/api/health', () => ({ ok: true, env: ENV, policy: S.activePolicy().version, time: nowIso() }));


export async function handleApi(method, pathname, query, body, token, headers = {}, ip = '') {
  const route = routes.find(r => r.method === method && r.re.test(pathname));
  if (!route) throw new HttpError(404, 'NOT_FOUND');
  
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; } };
  const ctx = { res, user: userFromToken(token), token, params: pathname.match(route.re).groups || {}, query, body, headers, ip };
  const out = await route.handler(ctx);
  return { out: out ?? { ok: true }, headers: res.headers };
}
