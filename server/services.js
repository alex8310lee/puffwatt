import { q, tx, nowIso } from './db.js';
import { BP, TIER_RANK, calculateBenefit, resolveTarget, referralRewards, proportionalClawback, planDeduction, xpForCash, questEligible } from './domain.js';
import { HttpError, flags, audit, hasRole, isAdmin, loadUser } from './auth.js';

const daysFrom = (d) => new Date(Date.now() + d * 864e5).toISOString();
const J = (s, d = {}) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

// ---------- policy ----------
export function activePolicy(at = nowIso()) {
  const p = q.get('SELECT * FROM policy_versions WHERE isActive=1 AND startsAt<=? AND (endsAt IS NULL OR endsAt>?) ORDER BY startsAt DESC LIMIT 1', at, at);
  if (!p) throw new HttpError(500, 'NO_ACTIVE_POLICY');
  return p;
}
export function policyContext(user) {
  const policy = activePolicy();
  const tierRule = q.get('SELECT * FROM policy_tier_rules WHERE policyVersionId=? AND tierCode=?', policy.id, user.tierCode);
  if (!tierRule) throw new HttpError(500, 'NO_TIER_RULE');
  const targets = q.all('SELECT * FROM policy_targets WHERE policyVersionId=?', policy.id);
  return { policy, tierRule, targets };
}
export function wallet(userId) {
  const r = q.get(`SELECT COALESCE(SUM(CASE WHEN status='AVAILABLE' THEN remainingAmount END),0) available,
    COALESCE(SUM(CASE WHEN status='PENDING' THEN amount END),0) pending,
    COALESCE(SUM(CASE WHEN status='AVAILABLE' AND expiresAt IS NOT NULL AND expiresAt<? THEN remainingAmount END),0) expiringSoon FROM point_ledger WHERE userId=?`, daysFrom(30), userId);
  const xp = q.get(`SELECT COALESCE(SUM(CASE WHEN status='AVAILABLE' THEN amount END),0) xp FROM xp_ledger WHERE userId=?`, userId).xp;
  return { ...r, xp };
}

// ---------- catalog / access ----------
export function canSeeProduct(user, p) {
  if (p.status !== 'ACTIVE') return false;
  if (isAdmin(user)) return true;
  switch (p.visibility) {
    case 'PUBLIC_MEMBER': return true;
    case 'CREATOR_ONLY': return hasRole(user, 'INFLUENCER');
    case 'SELLER_ONLY': return hasRole(user, 'SELLER') && user.sellerStatus === 'APPROVED';
    case 'TIER_RESTRICTED': return (TIER_RANK[user.tierCode] || 0) >= (p.requiredTierRank || 0);
    case 'INVITE_ONLY': return false;
    default: return false;
  }
}
export function catalog(user, { type, search } = {}) {
  const rows = q.all(`SELECT p.*, b.name brandName, b.pricePolicy, b.maxPointRate brandMaxPointRate FROM products p JOIN brands b ON b.id=p.brandId WHERE p.status='ACTIVE' ORDER BY p.id`);
  const ctx = policyContext(user);
  const w = wallet(user.id);
  return rows.filter(p => !type || p.itemType === type).filter(p => !search || (p.name + p.category + p.brandName).toLowerCase().includes(search.toLowerCase())).map(p => {
    const brand = { id: p.brandId, pricePolicy: p.pricePolicy, maxPointRate: p.brandMaxPointRate };
    const locked = !canSeeProduct(user, p);
    const target = resolveTarget(ctx.targets, user, p, brand);
    const calc = calculateBenefit({ user: { ...user, walletAvailable: w.available }, product: p, brand, policy: ctx.policy, tierRule: ctx.tierRule, target });
    return { id: p.id, slug: p.slug, name: p.name, category: p.category, itemType: p.itemType, brandName: p.brandName, imageKey: p.imageKey, basePrice: p.basePrice,
      displayPrice: locked ? null : calc.unitPrice, maxPointRate: calc.maxPointRate, cashEarnRate: calc.cashEarnRate, priceFixed: p.pricePolicy === 'FIXED' || !p.memberPriceAllowed,
      locked, lockReason: locked ? lockReason(p) : null, visibility: p.visibility, snapshot: calc.snapshot };
  });
}
function lockReason(p) { return { CREATOR_ONLY: 'CREATOR ACCESS', SELLER_ONLY: 'APPROVED SELLER ONLY', TIER_RESTRICTED: `${Object.keys(TIER_RANK).find(k => TIER_RANK[k] === p.requiredTierRank)} 이상`, INVITE_ONLY: 'INVITE ONLY' }[p.visibility] || 'LOCKED'; }

export function loadProduct(id) {
  const p = q.get('SELECT * FROM products WHERE id=? OR slug=?', id, id);
  if (!p) throw new HttpError(404, 'PRODUCT_NOT_FOUND');
  const brand = q.get('SELECT * FROM brands WHERE id=?', p.brandId);
  return { p, brand };
}
export function entitlements(user) {
  const rows = q.all(`SELECT e.*, c.code couponCode, c.name couponName, c.discountType, c.value couponValue, c.maxDiscount, c.minSpend, c.minTierRank,
    v.name voucherName, v.value voucherValue, v.productId vProductId, v.brandId vBrandId FROM user_entitlements e LEFT JOIN coupons c ON c.id=e.couponId LEFT JOIN vouchers v ON v.id=e.voucherId
    WHERE e.userId=? AND e.status='AVAILABLE'`, user.id);
  const coupons = rows.filter(r => r.type === 'COUPON' && (!r.minTierRank || TIER_RANK[user.tierCode] >= r.minTierRank)).map(r => ({ entitlementId: r.id, id: r.couponId, code: r.couponCode, name: r.couponName, discountType: r.discountType, value: r.couponValue, maxDiscount: r.maxDiscount, minSpend: r.minSpend }));
  const vouchers = rows.filter(r => r.type === 'VOUCHER').map(r => ({ entitlementId: r.id, id: r.voucherId, name: r.voucherName, value: r.voucherValue, productId: r.vProductId, brandId: r.vBrandId }));
  return { coupons, vouchers };
}
export function productDetail(user, id, opts = {}) {
  const { p, brand } = loadProduct(id);
  if (!canSeeProduct(user, p)) throw new HttpError(403, 'PRODUCT_LOCKED', lockReason(p));
  const ctx = policyContext(user);
  const w = wallet(user.id);
  const ent = entitlements(user);
  const coupon = opts.couponId === null ? null : (opts.couponId ? ent.coupons.find(c => c.id === opts.couponId) : ent.coupons[0]) || null;
  const voucher = opts.voucherId === null ? null : (opts.voucherId ? ent.vouchers.find(v => v.id === opts.voucherId) : ent.vouchers.find(v => (!v.productId || v.productId === p.id) && (!v.brandId || v.brandId === brand.id))) || null;
  const target = resolveTarget(ctx.targets, user, p, brand);
  const calc = calculateBenefit({ user: { ...user, walletAvailable: w.available }, product: p, brand, policy: ctx.policy, tierRule: ctx.tierRule, target, coupon, voucher, requestedPoint: opts.requestedPoint, quantity: opts.quantity || 1 });
  const quest = q.get(`SELECT q.*, (SELECT COUNT(*) FROM quest_participations qp WHERE qp.questId=q.id AND qp.status='COMPLETED') completedCount FROM quests q WHERE q.productId=? AND q.status='ACTIVE'`, p.id);
  return { product: { ...p, brandName: brand.name, pricePolicy: brand.pricePolicy }, calc, wallet: w, coupon, voucher, entitlements: ent,
    quest: quest ? { id: quest.id, code: quest.code, name: quest.name, capacity: quest.capacity, remaining: quest.capacity == null ? null : quest.capacity - quest.completedCount, rewardAmount: quest.rewardAmount } : null };
}

// ---------- cart & checkout ----------
function cartId(userId) { q.run('INSERT OR IGNORE INTO carts (userId) VALUES (?)', userId); return q.get('SELECT id FROM carts WHERE userId=?', userId).id; }
export function cart(user, opts = {}) {
  const cid = cartId(user.id);
  const items = q.all('SELECT ci.*, p.name, p.imageKey, p.itemType FROM cart_items ci JOIN products p ON p.id=ci.productId WHERE cartId=?', cid);
  const w = wallet(user.id);
  let available = w.available;
  const ent = entitlements(user);
  const ctx = policyContext(user);
  let couponLeft = opts.couponId === null ? null : (opts.couponId ? ent.coupons.find(c => c.id === opts.couponId) : ent.coupons[0]) || null;
  let voucherLeft = opts.voucherId === null ? null : (opts.voucherId ? ent.vouchers.find(v => v.id === opts.voucherId) : ent.vouchers[0]) || null;
  let requestLeft = opts.requestedPoint;
  const lines = [];
  for (const it of items) {
    const { p, brand } = loadProduct(it.productId);
    const target = resolveTarget(ctx.targets, user, p, brand);
    const c = calculateBenefit({ user: { ...user, walletAvailable: available }, product: p, brand, policy: ctx.policy, tierRule: ctx.tierRule, target, coupon: couponLeft, voucher: voucherLeft, quantity: it.quantity, requestedPoint: requestLeft == null ? undefined : requestLeft });
    if (c.couponDiscount) couponLeft = null; if (c.voucherDiscount) voucherLeft = null;
    available -= c.pointUsed; if (requestLeft != null) requestLeft = Math.max(0, requestLeft - c.pointUsed);
    lines.push({ cartItemId: it.id, productId: p.id, name: p.name, imageKey: p.imageKey, itemType: p.itemType, quantity: it.quantity, calc: c });
  }
  const totals = lines.reduce((a, l) => ({ displayPrice: a.displayPrice + l.calc.displayPrice, couponDiscount: a.couponDiscount + l.calc.couponDiscount, voucherDiscount: a.voucherDiscount + l.calc.voucherDiscount,
    payable: a.payable + l.calc.payable, pointUsed: a.pointUsed + l.calc.pointUsed, maxPointAmount: a.maxPointAmount + l.calc.maxPointAmount, cashPaid: a.cashPaid + l.calc.cashPaid, expectedEarn: a.expectedEarn + l.calc.expectedEarn }),
    { displayPrice: 0, couponDiscount: 0, voucherDiscount: 0, payable: 0, pointUsed: 0, maxPointAmount: 0, cashPaid: 0, expectedEarn: 0 });
  return { lines, totals, wallet: w, entitlements: ent, policyVersion: ctx.policy.version, coupon: opts.couponId === null ? null : (ent.coupons[0] || null), voucher: opts.voucherId === null ? null : (ent.vouchers[0] || null), snapshot: lines[0]?.calc.snapshot || `POLICY ${ctx.policy.version} · ${user.tierCode}` };
}
export function addToCart(user, productId, quantity = 1) {
  const { p } = loadProduct(productId);
  if (!canSeeProduct(user, p)) throw new HttpError(403, 'PRODUCT_LOCKED');
  const cid = cartId(user.id);
  q.run('INSERT INTO cart_items (cartId,productId,quantity) VALUES (?,?,?) ON CONFLICT(cartId,productId) DO UPDATE SET quantity=MIN(quantity+excluded.quantity, 10)', cid, p.id, Math.max(1, Math.min(10, quantity)));
}
export function removeCartItem(user, cartItemId) { q.run('DELETE FROM cart_items WHERE id=? AND cartId=?', cartItemId, cartId(user.id)); }

function ledgerAdd(e) {
  const r = q.run(`INSERT OR IGNORE INTO point_ledger (userId,pointType,entryType,status,amount,remainingAmount,sourceType,sourceId,idempotencyKey,availableAt,expiresAt,reversalOfId,reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    e.userId, e.pointType || 'EARNED_POINT', e.entryType, e.status, e.amount, e.status === 'AVAILABLE' && e.amount > 0 ? e.amount : 0, e.sourceType, e.sourceId ?? null, e.key, e.availableAt ?? null, e.expiresAt ?? null, e.reversalOfId ?? null, e.reason ?? null);
  return Number(r.lastInsertRowid);
}
function xpAdd(e) { q.run('INSERT OR IGNORE INTO xp_ledger (userId,entryType,status,amount,sourceType,sourceId,idempotencyKey,reversalOfId) VALUES (?,?,?,?,?,?,?,?)', e.userId, e.entryType, e.status, e.amount, e.sourceType, e.sourceId ?? null, e.key, e.reversalOfId ?? null); }

export function checkout(user, opts = {}) {
  return tx(() => {
    const c = cart(user, opts);
    if (!c.lines.length) throw new HttpError(400, 'CART_EMPTY', '장바구니가 비어 있습니다.');
    const policy = activePolicy();
    const orderNo = `PW${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${String(Date.now()).slice(-6)}`;
    const t = c.totals;
    const confirmDeadline = daysFrom(policy.purchaseConfirmDays);
    const r = q.run(`INSERT INTO orders (orderNo,userId,status,cashSubtotal,pointUsed,couponDiscount,voucherDiscount,shippingFee,cashPaid,earnedPointPending,policyVersion,benefitSnapshotJson,confirmDeadline) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      orderNo, user.id, 'PAID', t.displayPrice, t.pointUsed, t.couponDiscount, t.voucherDiscount, 0, t.cashPaid, t.expectedEarn, policy.version,
      JSON.stringify({ policy: policy.version, tier: user.tierCode, roles: user.roles, totals: t, lines: c.lines.map(l => ({ productId: l.productId, calc: l.calc })) }), confirmDeadline);
    const orderId = Number(r.lastInsertRowid);
    for (const l of c.lines) {
      q.run('INSERT INTO order_items (orderId,productId,itemType,nameSnapshot,unitPrice,quantity,cashAllocated,pointAllocated,benefitSnapshotJson) VALUES (?,?,?,?,?,?,?,?,?)',
        orderId, l.productId, l.itemType, l.name, l.calc.unitPrice, l.quantity, l.calc.cashPaid, l.calc.pointUsed, JSON.stringify(l.calc));
      q.run('UPDATE products SET stock=stock-? WHERE id=?', l.quantity, l.productId);
    }
    // consume points (earliest expiry first)
    if (t.pointUsed > 0) {
      const entries = q.all(`SELECT * FROM point_ledger WHERE userId=? AND status='AVAILABLE' AND remainingAmount>0`, user.id);
      for (const step of planDeduction(entries, t.pointUsed)) q.run('UPDATE point_ledger SET remainingAmount=remainingAmount-? WHERE id=?', step.take, step.id);
      ledgerAdd({ userId: user.id, entryType: 'USE', status: 'USED', amount: -t.pointUsed, sourceType: 'ORDER', sourceId: orderId, key: `use:${orderId}`, reason: `주문 사용 (${orderNo})` });
    }
    // mark coupon / voucher used
    if (t.couponDiscount && c.entitlements.coupons[0]) q.run('UPDATE user_entitlements SET status=?, usedAt=? WHERE id=?', 'USED', nowIso(), c.entitlements.coupons[0].entitlementId);
    if (t.voucherDiscount && c.entitlements.vouchers[0]) q.run('UPDATE user_entitlements SET status=?, usedAt=? WHERE id=?', 'USED', nowIso(), c.entitlements.vouchers[0].entitlementId);
    // pending earn + xp + referral
    const cashNet = t.cashPaid;
    if (t.expectedEarn > 0) ledgerAdd({ userId: user.id, entryType: 'EARN', status: 'PENDING', amount: t.expectedEarn, sourceType: 'ORDER', sourceId: orderId, key: `earn:${orderId}`, availableAt: confirmDeadline, expiresAt: daysFrom(365), reason: `PURCHASE EARN · 현금 순매출 (${orderNo})` });
    xpAdd({ userId: user.id, entryType: 'EARN', status: 'PENDING', amount: xpForCash(cashNet), sourceType: 'ORDER', sourceId: orderId, key: `xp:${orderId}` });
    const rels = q.all('SELECT * FROM referral_relations WHERE referredUserId=? AND (endsAt IS NULL OR endsAt>?)', user.id, nowIso());
    for (const rw of referralRewards({ cashNetSales: cashNet, policy, flags: flags() })) {
      const rel = rels.find(x => x.level === rw.level); if (!rel) continue;
      q.run(`INSERT OR IGNORE INTO referral_reward_ledger (beneficiaryUserId,sourceUserId,orderId,level,cashNetSales,volumeRate,volumeAmount,rewardRate,rewardPoint,status,idempotencyKey) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        rel.referrerUserId, user.id, orderId, rw.level, cashNet, rw.volumeRate, rw.volumeAmount, rw.rewardRate, rw.rewardPoint, 'PENDING', `ref:${orderId}:L${rw.level}`);
      if (rw.rewardPoint > 0) ledgerAdd({ userId: rel.referrerUserId, entryType: 'REFERRAL', status: 'PENDING', amount: rw.rewardPoint, sourceType: 'REFERRAL', sourceId: orderId, key: `refpt:${orderId}:L${rw.level}`, availableAt: confirmDeadline, expiresAt: daysFrom(365), reason: `L${rw.level} 추천 보상 (${orderNo})` });
    }
    q.run('DELETE FROM cart_items WHERE cartId=?', cartId(user.id));
    q.run('INSERT INTO notifications (userId,type,title,body,link) VALUES (?,?,?,?,?)', user.id, 'ORDER', '결제가 완료되었습니다.', `${orderNo} · 정책 스냅샷이 보존되었습니다.`, '#/orders');
    return orderDetail(user, orderId);
  });
}
export function orders(user) {
  return q.all('SELECT * FROM orders WHERE userId=? ORDER BY id DESC', user.id).map(o => ({ ...o, items: q.all('SELECT * FROM order_items WHERE orderId=?', o.id).map(i => ({ ...i, imageKey: q.get('SELECT imageKey FROM products WHERE id=?', i.productId)?.imageKey })), snapshot: J(o.benefitSnapshotJson) }));
}
export function orderDetail(user, id) {
  const o = q.get('SELECT * FROM orders WHERE id=?', id);
  if (!o) throw new HttpError(404, 'ORDER_NOT_FOUND');
  if (o.userId !== user.id && !isAdmin(user)) throw new HttpError(403, 'NOT_OWNER');
  return { ...o, items: q.all('SELECT * FROM order_items WHERE orderId=?', o.id), snapshot: J(o.benefitSnapshotJson), refunds: q.all('SELECT * FROM refunds WHERE orderId=?', o.id) };
}
function evaluateAchievements(userId) {
  const counts = {
    CONFIRMED_ORDERS: q.get(`SELECT COUNT(*) n FROM orders WHERE userId=? AND status IN ('CONFIRMED','PARTIALLY_RETURNED')`, userId).n,
    QUESTS_COMPLETED: q.get(`SELECT COUNT(*) n FROM quest_participations WHERE userId=? AND status='COMPLETED'`, userId).n,
    REFERRALS: q.get('SELECT COUNT(*) n FROM referral_relations WHERE referrerUserId=? AND level=1', userId).n,
    SOCIAL_VERIFIED: q.get(`SELECT COUNT(*) n FROM social_accounts s JOIN creator_profiles c ON c.id=s.creatorProfileId WHERE c.userId=? AND s.verificationStatus='VERIFIED'`, userId).n,
    SELLER_SALES: q.get(`SELECT COUNT(*) n FROM settlement_ledger WHERE userId=?`, userId).n,
  };
  const granted = [];
  for (const a of q.all('SELECT * FROM achievements')) {
    if ((counts[a.conditionType] || 0) >= a.threshold) {
      const r = q.run('INSERT OR IGNORE INTO user_achievements (userId,achievementId,earnedAt,sourceType) VALUES (?,?,?,?)', userId, a.id, nowIso(), a.conditionType);
      if (r.changes) { granted.push(a.code); if (a.titleCode) q.run('INSERT OR IGNORE INTO user_titles (userId,titleCode,earnedAt) VALUES (?,?,?)', userId, a.titleCode, nowIso()); }
    }
  }
  return { counts, granted };
}
export function confirmOrder(user, id) {
  return tx(() => {
    const o = orderDetail(user, id);
    if (o.status !== 'PAID') throw new HttpError(409, 'INVALID_STATE', '결제 완료 상태에서만 구매 확정할 수 있습니다.');
    q.run('UPDATE orders SET status=?, confirmedAt=?, updatedAt=? WHERE id=?', 'CONFIRMED', nowIso(), nowIso(), id);
    q.run(`UPDATE point_ledger SET status='AVAILABLE', remainingAmount=amount, availableAt=? WHERE status='PENDING' AND sourceId=? AND sourceType IN ('ORDER','REFERRAL')`, nowIso(), id);
    q.run(`UPDATE xp_ledger SET status='AVAILABLE' WHERE status='PENDING' AND sourceId=? AND sourceType='ORDER'`, id);
    q.run(`UPDATE referral_reward_ledger SET status='AVAILABLE' WHERE status='PENDING' AND orderId=?`, id);
    const ach = evaluateAchievements(o.userId);
    return { ...orderDetail(user, id), achievements: ach };
  });
}
function clawback(order, ratioBp, refundType, reason, actor) {
  const earn = q.get(`SELECT * FROM point_ledger WHERE idempotencyKey=?`, `earn:${order.id}`);
  const pointBack = Math.floor(order.pointUsed * ratioBp / BP);
  const cashBack = Math.floor((order.cashPaid - order.cashRefunded) * (refundType === 'FULL' ? BP : ratioBp) / BP);
  // restore used points (proportional)
  if (pointBack > 0) ledgerAdd({ userId: order.userId, entryType: 'RESTORE', status: 'AVAILABLE', amount: pointBack, sourceType: 'REFUND', sourceId: order.id, key: `restore:${order.id}:${refundType}:${ratioBp}`, expiresAt: daysFrom(365), reason: `${refundType === 'FULL' ? '전체 취소' : '부분 반품'} 포인트 복원 (${order.orderNo})` });
  // claw back own earn
  if (earn) {
    const amt = proportionalClawback(earn.amount, ratioBp);
    if (amt) { ledgerAdd({ userId: order.userId, entryType: 'REVOKE', status: 'REVOKED', amount: amt, sourceType: 'REFUND', sourceId: order.id, key: `revoke:${order.id}:${ratioBp}`, reversalOfId: earn.id, reason: `${refundType === 'FULL' ? '전체 취소' : '부분 반품'} 회수 (${order.orderNo})` });
      if (earn.status === 'AVAILABLE') q.run('UPDATE point_ledger SET remainingAmount=MAX(0, remainingAmount+?) WHERE id=?', amt, earn.id);
      else q.run('UPDATE point_ledger SET amount=amount+? WHERE id=?', amt, earn.id); }
  }
  // XP
  const xp = q.get('SELECT * FROM xp_ledger WHERE idempotencyKey=?', `xp:${order.id}`);
  if (xp) xpAdd({ userId: order.userId, entryType: 'REVOKE', status: 'AVAILABLE', amount: proportionalClawback(xp.amount, ratioBp), sourceType: 'REFUND', sourceId: order.id, key: `xprevoke:${order.id}:${ratioBp}`, reversalOfId: xp.id });
  // referral L1/L2
  for (const rr of q.all('SELECT * FROM referral_reward_ledger WHERE orderId=? AND reversalOfId IS NULL', order.id)) {
    const amt = proportionalClawback(rr.rewardPoint, ratioBp);
    q.run(`INSERT OR IGNORE INTO referral_reward_ledger (beneficiaryUserId,sourceUserId,orderId,level,cashNetSales,volumeRate,volumeAmount,rewardRate,rewardPoint,status,idempotencyKey,reversalOfId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      rr.beneficiaryUserId, rr.sourceUserId, order.id, rr.level, -Math.floor(rr.cashNetSales * ratioBp / BP), rr.volumeRate, -Math.floor(rr.volumeAmount * ratioBp / BP), rr.rewardRate, amt, 'REVOKED', `refrev:${order.id}:L${rr.level}:${ratioBp}`, rr.id);
    const pt = q.get('SELECT * FROM point_ledger WHERE idempotencyKey=?', `refpt:${order.id}:L${rr.level}`);
    if (pt && amt) { ledgerAdd({ userId: rr.beneficiaryUserId, entryType: 'REVOKE', status: 'REVOKED', amount: amt, sourceType: 'REFUND', sourceId: order.id, key: `refptrev:${order.id}:L${rr.level}:${ratioBp}`, reversalOfId: pt.id, reason: `L${rr.level} 추천 보상 회수 (${order.orderNo})` });
      if (pt.status === 'AVAILABLE') q.run('UPDATE point_ledger SET remainingAmount=MAX(0, remainingAmount+?) WHERE id=?', amt, pt.id); else q.run('UPDATE point_ledger SET amount=amount+? WHERE id=?', amt, pt.id); }
  }
  q.run('INSERT INTO refunds (orderId,type,cashAmount,pointAmount,reason,requestedBy,processedBy,processedAt) VALUES (?,?,?,?,?,?,?,?)', order.id, refundType, cashBack, pointBack, reason, actor, actor, nowIso());
  q.run('UPDATE orders SET cashRefunded=cashRefunded+?, updatedAt=? WHERE id=?', cashBack, nowIso(), order.id);
  return { cashBack, pointBack };
}
export function cancelOrder(user, id, reason = '단순 변심', actor = user.id) {
  return tx(() => {
    const o = orderDetail(user, id);
    if (!['PAID', 'CONFIRMED'].includes(o.status)) throw new HttpError(409, 'INVALID_STATE');
    const r = clawback(o, BP, 'FULL', reason, actor);
    for (const it of o.items) q.run('UPDATE products SET stock=stock+? WHERE id=?', it.quantity - it.returnedQuantity, it.productId);
    q.run('UPDATE orders SET status=?, cancelledAt=? WHERE id=?', 'CANCELLED', nowIso(), id);
    return { ...orderDetail(user, id), refund: r };
  });
}
export function partialReturn(user, id, orderItemId, quantity, reason = '부분 반품', actor = user.id) {
  return tx(() => {
    const o = orderDetail(user, id);
    if (!['PAID', 'CONFIRMED', 'PARTIALLY_RETURNED'].includes(o.status)) throw new HttpError(409, 'INVALID_STATE');
    const it = o.items.find(i => i.id === orderItemId); if (!it) throw new HttpError(404, 'ITEM_NOT_FOUND');
    const qty = Math.min(quantity, it.quantity - it.returnedQuantity); if (qty <= 0) throw new HttpError(400, 'NOTHING_TO_RETURN');
    const totalCash = o.items.reduce((a, i) => a + i.cashAllocated, 0) || 1;
    const ratioBp = Math.floor((it.cashAllocated * qty / it.quantity) / totalCash * BP);
    const r = clawback(o, ratioBp, 'PARTIAL', reason, actor);
    q.run('UPDATE order_items SET returnedQuantity=returnedQuantity+? WHERE id=?', qty, it.id);
    q.run('UPDATE products SET stock=stock+? WHERE id=?', qty, it.productId);
    q.run('UPDATE orders SET status=? WHERE id=?', 'PARTIALLY_RETURNED', id);
    return { ...orderDetail(user, id), refund: { ...r, ratioBp } };
  });
}

// ---------- rewards ----------
export function rewardsDashboard(user) {
  const w = wallet(user.id);
  const ledger = q.all('SELECT * FROM point_ledger WHERE userId=? ORDER BY id DESC LIMIT 40', user.id);
  const rels = q.all(`SELECT r.level, u.name, u.memberCode, r.referredUserId FROM referral_relations r JOIN users u ON u.id=r.referredUserId WHERE r.referrerUserId=? ORDER BY r.level, r.id`, user.id);
  const contrib = rels.map(r => ({ level: r.level, maskedName: r.name.slice(0, 1) + '○' + r.name.slice(-1), memberCode: r.memberCode.replace(/\d{3}$/, '***'),
    earned: q.get(`SELECT COALESCE(SUM(rewardPoint),0) s FROM referral_reward_ledger WHERE beneficiaryUserId=? AND sourceUserId=? AND status='AVAILABLE'`, user.id, r.referredUserId).s,
    pending: q.get(`SELECT COALESCE(SUM(rewardPoint),0) s FROM referral_reward_ledger WHERE beneficiaryUserId=? AND sourceUserId=? AND status='PENDING'`, user.id, r.referredUserId).s }));
  const ranks = Object.keys(TIER_RANK); const next = ranks[(TIER_RANK[user.tierCode] || 1)] || null;
  const xpGoal = { STANDARD: 2000, SILVER: 5000, GOLD: 10000, BLACK: 25000, ICON: null }[user.tierCode];
  return { wallet: w, ledger, referralCode: user.referralCode, l1: contrib.filter(c => c.level === 1).length, l2: contrib.filter(c => c.level === 2).length, contributions: contrib, nextTier: next, xpGoal, flags: flags(),
    upline: q.get('SELECT u.name, u.memberCode FROM referral_relations r JOIN users u ON u.id=r.referrerUserId WHERE r.referredUserId=? AND r.level=1', user.id) };
}
export function quests(user) {
  return q.all(`SELECT q.*, (SELECT COUNT(*) FROM quest_participations qp WHERE qp.questId=q.id AND qp.status='COMPLETED') completedCount FROM quests q WHERE q.status='ACTIVE'`).map(qu => {
    const mine = q.get('SELECT * FROM quest_participations WHERE questId=? AND userId=?', qu.id, user.id);
    const elig = questEligible({ ...qu, eligibility: J(qu.eligibilityJson) }, { roles: user.roles, tierCode: user.tierCode });
    const conds = J(qu.conditionsJson, []).map(c => ({ ...c, met: condMet(user, c) }));
    const product = qu.productId ? q.get('SELECT name, imageKey, slug FROM products WHERE id=?', qu.productId) : null;
    return { ...qu, product, conditions: conds, eligible: elig, mine, remaining: qu.capacity == null ? null : qu.capacity - qu.completedCount, progress: progressFor(user, conds) };
  });
}
function cashNetIn30d(userId) { return q.get(`SELECT COALESCE(SUM(cashPaid - cashRefunded),0) s FROM orders WHERE userId=? AND status IN ('PAID','CONFIRMED','PARTIALLY_RETURNED') AND createdAt>?`, userId, daysFrom(-30)).s; }
function condMet(user, c) {
  if (c.type === 'PURCHASED_PRODUCT') return !!q.get(`SELECT 1 FROM orders o JOIN order_items i ON i.orderId=o.id WHERE o.userId=? AND i.productId=? AND o.status IN ('PAID','CONFIRMED')`, user.id, c.productId);
  if (c.type === 'CASH_NET_SALES_GTE') return cashNetIn30d(user.id) >= c.value;
  return null; // evidence supplied at completion
}
function progressFor(user, conds) { const c = conds.find(x => x.type === 'CASH_NET_SALES_GTE'); return c ? { current: cashNetIn30d(user.id), target: c.value } : null; }
export function completeQuest(user, questId, evidence = {}) {
  return tx(() => {
    const qu = q.get(`SELECT q.*, (SELECT COUNT(*) FROM quest_participations qp WHERE qp.questId=q.id AND qp.status='COMPLETED') completedCount FROM quests q WHERE q.id=?`, questId);
    if (!qu || qu.status !== 'ACTIVE') throw new HttpError(404, 'QUEST_NOT_FOUND');
    const elig = questEligible({ ...qu, eligibility: J(qu.eligibilityJson) }, { roles: user.roles, tierCode: user.tierCode });
    if (!elig.ok) throw new HttpError(403, 'NOT_ELIGIBLE', `참여 조건 미충족: ${elig.reason}`);
    if (q.get('SELECT 1 FROM quest_participations WHERE questId=? AND userId=? AND status=?', qu.id, user.id, 'COMPLETED')) throw new HttpError(409, 'ALREADY_COMPLETED', '이미 완료한 퀘스트입니다.');
    for (const c of J(qu.conditionsJson, [])) {
      if (c.type === 'EVIDENCE_URL' && !/^https?:\/\//.test(evidence.url || '')) throw new HttpError(400, 'EVIDENCE_REQUIRED', '게시물 URL을 등록하세요.');
      if (c.type !== 'EVIDENCE_URL' && condMet(user, c) === false) throw new HttpError(409, 'CONDITION_NOT_MET', '참여 조건이 아직 충족되지 않았습니다.');
    }
    // atomic capacity check (BEGIN IMMEDIATE serializes writers)
    if (qu.capacity != null && qu.completedCount >= qu.capacity) throw new HttpError(409, 'QUEST_FULL', '선착순 정원이 마감되었습니다.');
    q.run('INSERT INTO quest_participations (questId,userId,status,completedAt,rewardedAt,evidenceJson) VALUES (?,?,?,?,?,?) ON CONFLICT(questId,userId) DO UPDATE SET status=excluded.status, completedAt=excluded.completedAt, rewardedAt=excluded.rewardedAt, evidenceJson=excluded.evidenceJson',
      qu.id, user.id, 'COMPLETED', nowIso(), nowIso(), JSON.stringify(evidence));
    let reward = null;
    if (qu.rewardType === 'POINT') { ledgerAdd({ userId: user.id, entryType: 'EARN', status: 'AVAILABLE', amount: qu.rewardAmount, sourceType: 'QUEST', sourceId: qu.id, key: `quest:${qu.id}:${user.id}`, expiresAt: daysFrom(180), reason: `QUEST REWARD · ${qu.name}` }); reward = `+${qu.rewardAmount.toLocaleString()} P`; }
    if (qu.rewardType === 'VOUCHER') { q.run('INSERT OR IGNORE INTO user_entitlements (id,userId,type,voucherId,sourceType,sourceId) VALUES (?,?,?,?,?,?)', 9000000 + qu.id * 1000 + user.id, user.id, 'VOUCHER', qu.rewardAmount, 'QUEST', qu.id); reward = '₩30,000 VOUCHER'; }
    if (qu.rewardType === 'BADGE') reward = `EXCLUSIVE BADGE · ${qu.rewardBadge}`;
    const ach = evaluateAchievements(user.id);
    return { reward, achievements: ach.granted, wallet: wallet(user.id) };
  });
}
export function achievements(user) {
  const counts = evaluateAchievements(user.id).counts;
  const list = q.all('SELECT a.*, ua.earnedAt FROM achievements a LEFT JOIN user_achievements ua ON ua.achievementId=a.id AND ua.userId=? ORDER BY a.id', user.id).map(a => ({ ...a, unlocked: !!a.earnedAt, current: counts[a.conditionType] || 0 }));
  const titles = q.all('SELECT t.*, ut.earnedAt FROM titles t LEFT JOIN user_titles ut ON ut.titleCode=t.code AND ut.userId=?', user.id).map(t => ({ ...t, owned: !!t.earnedAt, featured: user.featuredTitle === t.code }));
  return { list, titles, unlocked: list.filter(a => a.unlocked).length, total: list.length };
}
export function setFeaturedTitle(user, code) {
  if (!q.get('SELECT 1 FROM user_titles WHERE userId=? AND titleCode=?', user.id, code)) throw new HttpError(403, 'TITLE_NOT_OWNED', '보유한 칭호만 대표로 설정할 수 있습니다.');
  q.run('UPDATE users SET featuredTitle=? WHERE id=?', code, user.id);
}

// ---------- club home ----------
export function clubHome(user) {
  const w = wallet(user.id);
  const monthEarn = q.get(`SELECT COALESCE(SUM(amount),0) s FROM point_ledger WHERE userId=? AND amount>0 AND entryType IN ('EARN','REFERRAL') AND createdAt>?`, user.id, daysFrom(-30)).s;
  const rd = rewardsDashboard(user);
  return { user: publicUser(user), wallet: w, monthEarn, xpGoal: rd.xpGoal, nextTier: rd.nextTier,
    ordersInProgress: q.get(`SELECT COUNT(*) n FROM orders WHERE userId=? AND status='PAID'`, user.id).n,
    bookings: q.get(`SELECT COUNT(*) n FROM orders o JOIN order_items i ON i.orderId=o.id WHERE o.userId=? AND i.itemType='SERVICE' AND o.status IN ('PAID','CONFIRMED')`, user.id).n,
    invitedOpportunities: q.get(`SELECT COUNT(*) n FROM opportunity_assignments WHERE userId=? AND status IN ('INVITED','VIEWED','APPLIED','ACCEPTED','IN_PROGRESS')`, user.id).n,
    l1: rd.l1, l2: rd.l2, featuredTitle: q.get('SELECT * FROM titles WHERE code=?', user.featuredTitle),
    notifications: q.all('SELECT * FROM notifications WHERE userId=? AND readAt IS NULL ORDER BY id DESC LIMIT 5', user.id),
    featured: q.get(`SELECT id, slug, name, imageKey FROM products WHERE slug='private-wellness-retreat'`) };
}
export function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, memberCode: u.memberCode, tierCode: u.tierCode, autoTierCode: u.autoTierCode, tierOverride: u.tierOverride ? { endsAt: u.tierOverride.endsAt, reason: u.tierOverride.reason } : null,
    roles: u.roles, creatorTier: u.creatorTier, sellerStatus: u.sellerStatus, featuredTitle: u.featuredTitle, referralCode: u.referralCode, isDemo: !!u.isDemo, isAdmin: isAdmin(u) };
}

// ---------- creator ----------
export function creatorWorkspace(user) {
  if (!hasRole(user, 'INFLUENCER') && !isAdmin(user)) throw new HttpError(403, 'ROLE_REQUIRED', '크리에이터 역할이 필요합니다.');
  let p = q.get('SELECT * FROM creator_profiles WHERE userId=?', user.id);
  if (!p) { q.run('INSERT INTO creator_profiles (userId, displayName) VALUES (?,?)', user.id, user.name); p = q.get('SELECT * FROM creator_profiles WHERE userId=?', user.id); }
  const socials = q.all('SELECT * FROM social_accounts WHERE creatorProfileId=?', p.id);
  const reach = socials.reduce((a, s) => a + s.reach30d, 0);
  const eng = socials.length ? Math.round(socials.reduce((a, s) => a + s.engagementRateBp, 0) / socials.length) : 0;
  return { profile: p, socials, rateCards: q.all('SELECT * FROM rate_cards WHERE creatorProfileId=? AND isActive=1', p.id), portfolios: q.all('SELECT * FROM portfolios WHERE creatorProfileId=? ORDER BY sortOrder', p.id),
    snapshot: { totalReach: reach, totalEngagement: Math.round(reach * eng / BP), avgEngBp: eng } };
}
export function saveProfile(user, body) {
  const ws = creatorWorkspace(user);
  q.run('UPDATE creator_profiles SET displayName=?, bio=?, category=?, location=?, visibility=?, profileCompletion=?, updatedAt=? WHERE id=?', body.displayName || ws.profile.displayName, body.bio ?? ws.profile.bio, body.category ?? ws.profile.category, body.location ?? ws.profile.location, body.visibility ?? ws.profile.visibility,
    Math.min(100, 40 + (body.bio ? 20 : 0) + (ws.socials.length ? 20 : 0) + (ws.rateCards.length ? 20 : 0)), nowIso(), ws.profile.id);
}
export function saveSocial(user, body) {
  const ws = creatorWorkspace(user);
  q.run(`INSERT INTO social_accounts (creatorProfileId,provider,handle,followers,reach30d,engagementRateBp,verificationSource,verificationStatus) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(creatorProfileId,provider) DO UPDATE SET handle=excluded.handle, followers=excluded.followers, reach30d=excluded.reach30d, engagementRateBp=excluded.engagementRateBp, verificationSource='SELF_REPORTED', verificationStatus='PENDING'`,
    ws.profile.id, body.provider, body.handle, body.followers | 0, body.reach30d | 0, body.engagementRateBp | 0, 'SELF_REPORTED', 'PENDING');
}
export function saveRateCard(user, body) { const ws = creatorWorkspace(user); q.run('INSERT INTO rate_cards (creatorProfileId,contentType,description,amount,visibility) VALUES (?,?,?,?,?)', ws.profile.id, body.contentType, body.description || '', body.amount | 0, body.visibility || 'OPERATOR_ONLY'); }
export function deleteRateCard(user, id) { const ws = creatorWorkspace(user); q.run('UPDATE rate_cards SET isActive=0 WHERE id=? AND creatorProfileId=?', id, ws.profile.id); }

// ---------- opportunities ----------
const OPP_STATES = ['INVITED', 'VIEWED', 'APPLIED', 'ACCEPTED', 'DECLINED', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'SETTLED', 'CANCELLED'];
export function listOpportunities(user) {
  const rows = q.all(`SELECT o.*, a.id assignmentId, a.status assignmentStatus, a.rewardAmount, b.name brandName FROM opportunity_assignments a JOIN opportunities o ON o.id=a.opportunityId LEFT JOIN brands b ON b.id=o.brandId WHERE a.userId=? ORDER BY a.id DESC`, user.id);
  return rows.map(r => ({ ...r, requirements: J(r.requirementsJson), tierName: r.requiredTierRank ? Object.keys(TIER_RANK).find(k => TIER_RANK[k] === r.requiredTierRank) : null }));
}
export function opportunityDetail(user, id) {
  const o = q.get('SELECT o.*, b.name brandName FROM opportunities o LEFT JOIN brands b ON b.id=o.brandId WHERE o.id=?', id);
  if (!o) throw new HttpError(404, 'OPPORTUNITY_NOT_FOUND');
  const a = q.get('SELECT * FROM opportunity_assignments WHERE opportunityId=? AND userId=?', id, user.id);
  if (!a && !isAdmin(user)) throw new HttpError(403, 'NOT_ASSIGNED', '배정되지 않은 기회입니다.');
  if (a && o.requiredRole === 'SELLER' && user.sellerStatus !== 'APPROVED' && !isAdmin(user)) throw new HttpError(403, 'SELLER_NOT_APPROVED', '승인 셀러만 조건을 열람할 수 있습니다.');
  if (a && a.status === 'INVITED') q.run('UPDATE opportunity_assignments SET status=?, viewedAt=? WHERE id=?', 'VIEWED', nowIso(), a.id);
  const assignment = a ? q.get('SELECT * FROM opportunity_assignments WHERE id=?', a.id) : null;
  return { opportunity: { ...o, requirements: J(o.requirementsJson) }, assignment,
    submissions: assignment ? q.all('SELECT * FROM campaign_submissions WHERE assignmentId=? ORDER BY id DESC', assignment.id) : [],
    messages: assignment ? q.all('SELECT m.*, u.name fromName FROM assignment_messages m JOIN users u ON u.id=m.fromUserId WHERE assignmentId=? ORDER BY m.id', assignment.id) : [], states: OPP_STATES };
}
export function respondOpportunity(user, id, action) {
  const d = opportunityDetail(user, id); const a = d.assignment; if (!a) throw new HttpError(403, 'NOT_ASSIGNED');
  const next = { ACCEPT: 'ACCEPTED', DECLINE: 'DECLINED', APPLY: 'APPLIED', START: 'IN_PROGRESS' }[action]; if (!next) throw new HttpError(400, 'BAD_ACTION');
  const allowed = { ACCEPTED: ['INVITED', 'VIEWED', 'APPLIED'], DECLINED: ['INVITED', 'VIEWED', 'APPLIED', 'ACCEPTED'], APPLIED: ['INVITED', 'VIEWED'], IN_PROGRESS: ['ACCEPTED'] }[next];
  if (!allowed.includes(a.status)) throw new HttpError(409, 'INVALID_TRANSITION', `${a.status} → ${next} 전이가 허용되지 않습니다.`);
  q.run('UPDATE opportunity_assignments SET status=?, respondedAt=?, updatedAt=? WHERE id=?', next, nowIso(), nowIso(), a.id);
}
export function askQuestion(user, id, body) { const d = opportunityDetail(user, id); if (!d.assignment) throw new HttpError(403, 'NOT_ASSIGNED'); q.run('INSERT INTO assignment_messages (assignmentId,fromUserId,body) VALUES (?,?,?)', d.assignment.id, user.id, String(body).slice(0, 1000)); }
export function submitDeliverable(user, id, { url, note }) {
  const d = opportunityDetail(user, id); const a = d.assignment; if (!a) throw new HttpError(403, 'NOT_ASSIGNED');
  if (!['ACCEPTED', 'IN_PROGRESS'].includes(a.status)) throw new HttpError(409, 'INVALID_STATE', '수락 또는 진행 상태에서만 제출할 수 있습니다.');
  if (!/^https?:\/\//.test(url || '')) throw new HttpError(400, 'URL_REQUIRED', '결과물 URL을 입력하세요.');
  q.run('INSERT INTO campaign_submissions (assignmentId,url,note,submittedAt) VALUES (?,?,?,?)', a.id, url, note || '', nowIso());
  q.run('UPDATE opportunity_assignments SET status=?, updatedAt=? WHERE id=?', 'SUBMITTED', nowIso(), a.id);
}
export function sellerHome(user) {
  if (!hasRole(user, 'SELLER') || user.sellerStatus !== 'APPROVED') throw new HttpError(403, 'SELLER_NOT_APPROVED', '승인 셀러만 접근할 수 있습니다.');
  const opps = listOpportunities(user).filter(o => ['GROUP_BUY', 'LIVE'].includes(o.type));
  const settle = q.all('SELECT s.*, o.title FROM settlement_ledger s LEFT JOIN opportunities o ON o.id=s.opportunityId WHERE s.userId=? ORDER BY s.id DESC', user.id);
  const sum = settle.reduce((a, s) => ({ gross: a.gross + s.grossCashSales, returns: a.returns + s.returns, fee: a.fee + s.fee, net: a.net + s.netSettlement }), { gross: 0, returns: 0, fee: 0, net: 0 });
  return { opportunities: opps, settlements: settle, summary: { ...sum, active: opps.filter(o => ['ACCEPTED', 'IN_PROGRESS'].includes(o.assignmentStatus)).length } };
}

// ---------- admin ----------
export function adminOverview() {
  return { activeMembers: q.get(`SELECT COUNT(*) n FROM users WHERE status='ACTIVE'`).n, ordersToday: q.get(`SELECT COUNT(*) n FROM orders WHERE createdAt>?`, daysFrom(-1)).n,
    pointLiability: q.get(`SELECT COALESCE(SUM(remainingAmount),0) s FROM point_ledger WHERE status='AVAILABLE'`).s, pendingPoints: q.get(`SELECT COALESCE(SUM(amount),0) s FROM point_ledger WHERE status='PENDING'`).s,
    creatorReview: q.get(`SELECT COUNT(*) n FROM social_accounts WHERE verificationStatus='PENDING'`).n, submissionsPending: q.get(`SELECT COUNT(*) n FROM campaign_submissions WHERE status='SUBMITTED'`).n,
    policy: activePolicy(), scheduled: q.get('SELECT * FROM policy_versions WHERE isActive=0 AND startsAt>? ORDER BY startsAt LIMIT 1', nowIso()),
    audit: q.all('SELECT a.*, u.name adminName FROM admin_audit_logs a JOIN users u ON u.id=a.adminId ORDER BY a.id DESC LIMIT 12'), flags: flags(),
    orderTrend: q.all(`SELECT substr(createdAt,1,10) d, COUNT(*) n, SUM(cashPaid) cash FROM orders WHERE createdAt>? GROUP BY d ORDER BY d`, daysFrom(-7)) };
}
export function adminMembers({ search, tier, role } = {}) {
  let rows = q.all('SELECT * FROM users ORDER BY id');
  rows = rows.map(u => ({ ...u, roles: q.all('SELECT role FROM user_roles WHERE userId=? AND isActive=1', u.id).map(r => r.role), wallet: wallet(u.id).available, passwordHash: undefined,
    override: q.get(`SELECT afterValue, endsAt FROM manual_overrides WHERE userId=? AND overrideType='TIER' AND revertedAt IS NULL AND (endsAt IS NULL OR endsAt>?) ORDER BY id DESC LIMIT 1`, u.id, nowIso()) }));
  if (search) rows = rows.filter(u => (u.name + u.email + u.memberCode).toLowerCase().includes(search.toLowerCase()));
  if (tier) rows = rows.filter(u => u.tierCode === tier); if (role) rows = rows.filter(u => u.roles.includes(role));
  return rows;
}
export function adminMemberDetail(id) {
  const u = loadUser(id); if (!u) throw new HttpError(404, 'USER_NOT_FOUND');
  return { user: publicUser(u), wallet: wallet(id), orders: orders(u).slice(0, 10), ledger: q.all('SELECT * FROM point_ledger WHERE userId=? ORDER BY id DESC LIMIT 20', id),
    network: { l1: q.all('SELECT u.name,u.memberCode FROM referral_relations r JOIN users u ON u.id=r.referredUserId WHERE r.referrerUserId=? AND level=1', id), l2: q.all('SELECT u.name,u.memberCode FROM referral_relations r JOIN users u ON u.id=r.referredUserId WHERE r.referrerUserId=? AND level=2', id),
      upline: q.get('SELECT u.name,u.memberCode FROM referral_relations r JOIN users u ON u.id=r.referrerUserId WHERE r.referredUserId=? AND level=1', id) },
    overrides: q.all('SELECT * FROM manual_overrides WHERE userId=? ORDER BY id DESC', id), assignments: listOpportunities(u), audit: q.all('SELECT * FROM admin_audit_logs WHERE objectType=? AND objectId=? ORDER BY id DESC LIMIT 10', 'user', String(id)) };
}
export function adminUpdateRoles(admin, id, roles, reason, ip) {
  if (!reason) throw new HttpError(400, 'REASON_REQUIRED', '변경 사유는 필수입니다.');
  if (roles.includes('SUPER_ADMIN') && !hasRole(admin, 'SUPER_ADMIN')) throw new HttpError(403, 'SUPER_ADMIN_REQUIRED');
  return tx(() => {
    const before = q.all('SELECT role FROM user_roles WHERE userId=? AND isActive=1', id).map(r => r.role);
    q.run('DELETE FROM user_roles WHERE userId=?', id);
    for (const r of roles) q.run('INSERT INTO user_roles (userId,role,source) VALUES (?,?,?)', id, r, 'admin');
    if (roles.includes('SELLER')) q.run(`UPDATE users SET sellerStatus=CASE WHEN sellerStatus='NONE' THEN 'APPROVED' ELSE sellerStatus END WHERE id=?`, id);
    audit(admin.id, 'MEMBER.ROLES.UPDATE', 'user', id, before, roles, reason, ip);
  });
}
export function adminSetOverride(admin, id, { tierCode, days, reason }, ip) {
  if (!reason) throw new HttpError(400, 'REASON_REQUIRED', '변경 사유는 필수입니다.');
  if (!TIER_RANK[tierCode]) throw new HttpError(400, 'BAD_TIER');
  return tx(() => {
    const u = q.get('SELECT tierCode FROM users WHERE id=?', id);
    q.run(`UPDATE manual_overrides SET revertedAt=? WHERE userId=? AND overrideType='TIER' AND revertedAt IS NULL`, nowIso(), id);
    q.run('INSERT INTO manual_overrides (userId,overrideType,beforeValue,afterValue,reason,startsAt,endsAt,activatedAt,adminId) VALUES (?,?,?,?,?,?,?,?,?)', id, 'TIER', u.tierCode, tierCode, reason, nowIso(), days ? daysFrom(days) : null, nowIso(), admin.id);
    audit(admin.id, 'MEMBER.TIER.OVERRIDE', 'user', id, { tier: u.tierCode }, { tier: tierCode, days }, reason, ip);
  });
}
export function adminPointAdjust(admin, id, { amount, reason, expiresInDays }, ip) {
  if (!reason) throw new HttpError(400, 'REASON_REQUIRED'); amount = amount | 0; if (!amount) throw new HttpError(400, 'AMOUNT_REQUIRED');
  return tx(() => {
    if (amount < 0) { const entries = q.all(`SELECT * FROM point_ledger WHERE userId=? AND status='AVAILABLE' AND remainingAmount>0`, id); for (const s of planDeduction(entries, -amount)) q.run('UPDATE point_ledger SET remainingAmount=remainingAmount-? WHERE id=?', s.take, s.id); }
    const key = `adj:${id}:${Date.now()}`;
    ledgerAdd({ userId: id, pointType: 'PROMO_POINT', entryType: 'ADJUST', status: amount > 0 ? 'AVAILABLE' : 'USED', amount, sourceType: 'ADMIN', sourceId: admin.id, key, expiresAt: amount > 0 ? daysFrom(expiresInDays || 180) : null, reason: `수동 조정 · ${reason}` });
    audit(admin.id, 'POINT.ADJUST', 'user', id, null, { amount, key }, reason, ip);
  });
}
export function adminPolicies() {
  const list = q.all('SELECT * FROM policy_versions ORDER BY startsAt');
  return list.map(p => ({ ...p, tiers: q.all('SELECT * FROM policy_tier_rules WHERE policyVersionId=? ORDER BY id', p.id), targets: q.all('SELECT * FROM policy_targets WHERE policyVersionId=?', p.id) }));
}
export function adminCreatePolicy(admin, body, ip) {
  if (!body.version || !body.startsAt) throw new HttpError(400, 'VERSION_AND_DATE_REQUIRED');
  return tx(() => {
    const base = activePolicy();
    const r = q.run('INSERT INTO policy_versions (version,name,startsAt,isActive,purchaseConfirmDays,l1VolumeRate,l2VolumeRate,l1RewardRate,l2RewardRate,monthlyVolumeCap,monthlyRewardCap,createdBy) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      body.version, body.name || base.name, body.startsAt, 0, body.purchaseConfirmDays ?? base.purchaseConfirmDays, base.l1VolumeRate, base.l2VolumeRate, body.l1RewardRate ?? base.l1RewardRate, body.l2RewardRate ?? base.l2RewardRate, body.monthlyVolumeCap ?? base.monthlyVolumeCap, body.monthlyRewardCap ?? base.monthlyRewardCap, admin.email);
    const id = Number(r.lastInsertRowid);
    for (const t of q.all('SELECT * FROM policy_tier_rules WHERE policyVersionId=?', base.id)) { const o = (body.tiers || {})[t.tierCode] || {}; q.run('INSERT INTO policy_tier_rules (policyVersionId,tierCode,displayPriceRate,maxPointRate,cashEarnRate,monthlyCredit) VALUES (?,?,?,?,?,?)', id, t.tierCode, o.displayPriceRate ?? t.displayPriceRate, o.maxPointRate ?? t.maxPointRate, o.cashEarnRate ?? t.cashEarnRate, o.monthlyCredit ?? t.monthlyCredit); }
    for (const t of q.all('SELECT * FROM policy_targets WHERE policyVersionId=?', base.id)) q.run('INSERT INTO policy_targets (policyVersionId,targetType,targetId,requiredRole,requiredTierRank,maxPointRate,priceRate,earnRate,label) VALUES (?,?,?,?,?,?,?,?,?)', id, t.targetType, t.targetId, t.requiredRole, t.requiredTierRank, t.maxPointRate, t.priceRate, t.earnRate, t.label);
    audit(admin.id, 'POLICY.CREATE', 'policy_version', body.version, null, body, body.reason || 'scheduled policy', ip);
    return id;
  });
}
export function adminActivatePolicy(admin, id, reason, ip) {
  return tx(() => { const p = q.get('SELECT * FROM policy_versions WHERE id=?', id); if (!p) throw new HttpError(404);
    const cur = activePolicy(); q.run('UPDATE policy_versions SET isActive=0, endsAt=? WHERE id=?', nowIso(), cur.id); q.run('UPDATE policy_versions SET isActive=1, startsAt=MIN(startsAt,?) , endsAt=NULL WHERE id=?', nowIso(), id);
    audit(admin.id, 'POLICY.ACTIVATE', 'policy_version', p.version, { active: cur.version }, { active: p.version }, reason || 'manual activation', ip); });
}
export function adminCommerce() {
  return { brands: q.all('SELECT b.*, (SELECT COUNT(*) FROM products p WHERE p.brandId=b.id) productCount FROM brands b'), products: q.all('SELECT p.*, b.name brandName FROM products p JOIN brands b ON b.id=p.brandId ORDER BY p.id'),
    orders: q.all('SELECT o.*, u.name userName, u.memberCode FROM orders o JOIN users u ON u.id=o.userId ORDER BY o.id DESC LIMIT 50').map(o => ({ ...o, items: q.all('SELECT * FROM order_items WHERE orderId=?', o.id) })),
    ledger: q.all('SELECT l.*, u.name userName, u.memberCode FROM point_ledger l JOIN users u ON u.id=l.userId ORDER BY l.id DESC LIMIT 60') };
}
export function adminRefund(admin, orderId, { type, orderItemId, quantity, reason }, ip) {
  const o = q.get('SELECT * FROM orders WHERE id=?', orderId); if (!o) throw new HttpError(404, 'ORDER_NOT_FOUND');
  const owner = loadUser(o.userId);
  const res = type === 'FULL' ? cancelOrder(owner, orderId, reason, admin.id) : partialReturn(owner, orderId, orderItemId, quantity | 0, reason, admin.id);
  audit(admin.id, type === 'FULL' ? 'ORDER.REFUND' : 'ORDER.PARTIAL_RETURN', 'order', o.orderNo, { status: o.status }, { status: res.status, refund: res.refund }, reason, ip);
  return res;
}
export function adminCreators() {
  return q.all('SELECT c.*, u.name userName, u.memberCode, u.creatorTier FROM creator_profiles c JOIN users u ON u.id=c.userId').map(c => ({ ...c, socials: q.all('SELECT * FROM social_accounts WHERE creatorProfileId=?', c.id), rateCards: q.all('SELECT * FROM rate_cards WHERE creatorProfileId=? AND isActive=1', c.id) }));
}
export function adminReviewSocial(admin, socialId, status, reason, ip) {
  const s = q.get('SELECT * FROM social_accounts WHERE id=?', socialId); if (!s) throw new HttpError(404);
  q.run('UPDATE social_accounts SET verificationStatus=?, verificationSource=?, lastVerifiedAt=? WHERE id=?', status, status === 'VERIFIED' ? 'OPERATOR_VERIFIED' : s.verificationSource, status === 'VERIFIED' ? nowIso() : s.lastVerifiedAt, socialId);
  if (status === 'VERIFIED') { q.run(`UPDATE creator_profiles SET verificationStatus='VERIFIED' WHERE id=?`, s.creatorProfileId); const uid = q.get('SELECT userId FROM creator_profiles WHERE id=?', s.creatorProfileId).userId; evaluateAchievements(uid); }
  audit(admin.id, 'CREATOR.SOCIAL.REVIEW', 'social_account', socialId, { status: s.verificationStatus }, { status }, reason, ip);
}
export function adminOpportunities() {
  return q.all('SELECT o.*, b.name brandName FROM opportunities o LEFT JOIN brands b ON b.id=o.brandId ORDER BY o.id DESC').map(o => ({ ...o, assignments: q.all('SELECT a.*, u.name userName, u.memberCode FROM opportunity_assignments a JOIN users u ON u.id=a.userId WHERE a.opportunityId=?', o.id).map(a => ({ ...a, submissions: q.all('SELECT * FROM campaign_submissions WHERE assignmentId=? ORDER BY id DESC', a.id) })) }));
}
export function adminInvite(admin, opportunityId, userId, rewardAmount, ip) {
  const u = loadUser(userId); const o = q.get('SELECT * FROM opportunities WHERE id=?', opportunityId); if (!u || !o) throw new HttpError(404);
  if (o.requiredRole && !hasRole(u, o.requiredRole)) throw new HttpError(409, 'ROLE_MISMATCH', `${o.requiredRole} 역할이 필요합니다.`);
  q.run('INSERT INTO opportunity_assignments (opportunityId,userId,status,invitedAt,rewardAmount,assignedBy) VALUES (?,?,?,?,?,?) ON CONFLICT(opportunityId,userId) DO UPDATE SET rewardAmount=excluded.rewardAmount', opportunityId, userId, 'INVITED', nowIso(), rewardAmount | 0, admin.id);
  q.run('INSERT INTO notifications (userId,type,title,body,link) VALUES (?,?,?,?,?)', userId, 'OPPORTUNITY', '새로운 기회에 초대되었습니다.', o.title, `#/opportunity/${o.id}`);
  audit(admin.id, 'OPPORTUNITY.INVITE', 'opportunity', opportunityId, null, { userId, rewardAmount }, 'invite', ip);
}
export function adminApproveSubmission(admin, submissionId, approve, feedback, ip) {
  return tx(() => {
    const s = q.get('SELECT * FROM campaign_submissions WHERE id=?', submissionId); if (!s) throw new HttpError(404);
    q.run('UPDATE campaign_submissions SET status=?, reviewedAt=?, reviewedBy=?, feedback=? WHERE id=?', approve ? 'APPROVED' : 'REJECTED', nowIso(), admin.id, feedback || null, submissionId);
    const a = q.get('SELECT * FROM opportunity_assignments WHERE id=?', s.assignmentId);
    q.run('UPDATE opportunity_assignments SET status=? WHERE id=?', approve ? 'APPROVED' : 'IN_PROGRESS', a.id);
    if (approve && a.rewardAmount) { const o = q.get('SELECT * FROM opportunities WHERE id=?', a.opportunityId); const fee = Math.floor(a.rewardAmount * 33 / 1000);
      q.run('INSERT INTO settlement_ledger (userId,opportunityId,grossCashSales,returns,fee,netSettlement,status,periodStart,periodEnd) VALUES (?,?,?,?,?,?,?,?,?)', a.userId, a.opportunityId, a.rewardAmount, 0, fee, a.rewardAmount - fee, 'PENDING', nowIso(), daysFrom(5)); }
    audit(admin.id, approve ? 'SUBMISSION.APPROVE' : 'SUBMISSION.REJECT', 'campaign_submission', submissionId, { status: s.status }, { status: approve ? 'APPROVED' : 'REJECTED' }, feedback, ip);
  });
}
export function adminAudit() { return q.all('SELECT a.*, u.name adminName FROM admin_audit_logs a JOIN users u ON u.id=a.adminId ORDER BY a.id DESC LIMIT 200'); }
export function adminSetFlag(admin, key, enabled, reason, ip) {
  if (!hasRole(admin, 'SUPER_ADMIN')) throw new HttpError(403, 'SUPER_ADMIN_REQUIRED');
  const before = q.get('SELECT enabled FROM feature_flags WHERE key=?', key); q.run('UPDATE feature_flags SET enabled=? WHERE key=?', enabled ? 1 : 0, key);
  audit(admin.id, 'FLAG.UPDATE', 'feature_flag', key, before, { enabled }, reason, ip);
}

// ---------- scheduled jobs (idempotent, request-scoped) ----------
export function runJob(jobKey, periodKey = nowIso().slice(0, 7)) {
  return tx(() => {
    let result;
    if (jobKey === 'monthly-credit') {
      const policy = activePolicy(); let n = 0;
      for (const u of q.all(`SELECT id, tierCode FROM users WHERE status='ACTIVE'`)) {
        const rule = q.get('SELECT monthlyCredit FROM policy_tier_rules WHERE policyVersionId=? AND tierCode=?', policy.id, u.tierCode); if (!rule || !rule.monthlyCredit) continue;
        const key = `credit:${u.id}:${periodKey}`;
        const id = ledgerAdd({ userId: u.id, pointType: 'MONTHLY_CREDIT', entryType: 'CREDIT', status: 'AVAILABLE', amount: rule.monthlyCredit, sourceType: 'MONTHLY_CREDIT', key, expiresAt: daysFrom(60), reason: `월 베네핏 ${periodKey}` });
        const r = q.run('INSERT OR IGNORE INTO monthly_credit_runs (ruleKey,periodKey,userId,ledgerId,idempotencyKey,status) VALUES (?,?,?,?,?,?)', 'tier-credit', periodKey, u.id, id || null, key, 'DONE'); n += r.changes;
      }
      result = { credited: n };
    } else if (jobKey === 'expire-points') {
      const rows = q.all(`SELECT * FROM point_ledger WHERE status='AVAILABLE' AND remainingAmount>0 AND expiresAt IS NOT NULL AND expiresAt<?`, nowIso()); let n = 0;
      for (const r of rows) { ledgerAdd({ userId: r.userId, entryType: 'EXPIRE', status: 'EXPIRED', amount: -r.remainingAmount, sourceType: 'EXPIRY', sourceId: r.id, key: `expire:${r.id}`, reversalOfId: r.id, reason: '30일 경과 소멸' }); q.run('UPDATE point_ledger SET remainingAmount=0 WHERE id=?', r.id); n++; }
      result = { expired: n };
    } else if (jobKey === 'release-pending') {
      const rows = q.all(`SELECT id FROM orders WHERE status='PAID' AND confirmDeadline<?`, nowIso()); let n = 0;
      for (const o of rows) { const u = loadUser(q.get('SELECT userId FROM orders WHERE id=?', o.id).userId); confirmOrder(u, o.id); n++; }
      result = { autoConfirmed: n };
    } else if (jobKey === 'revert-overrides') {
      const r = q.run(`UPDATE manual_overrides SET revertedAt=? WHERE revertedAt IS NULL AND endsAt IS NOT NULL AND endsAt<?`, nowIso(), nowIso()); result = { reverted: r.changes };
    } else if (jobKey === 'activate-scheduled-policy') {
      const p = q.get('SELECT * FROM policy_versions WHERE isActive=0 AND startsAt<=? AND endsAt IS NULL ORDER BY startsAt DESC LIMIT 1', nowIso());
      if (p) { const cur = activePolicy(); q.run('UPDATE policy_versions SET isActive=0, endsAt=? WHERE id=?', nowIso(), cur.id); q.run('UPDATE policy_versions SET isActive=1 WHERE id=?', p.id); result = { activated: p.version }; } else result = { activated: null };
    } else throw new HttpError(404, 'UNKNOWN_JOB');
    q.run('INSERT INTO scheduled_job_runs (jobKey,periodKey,result) VALUES (?,?,?) ON CONFLICT(jobKey,periodKey) DO UPDATE SET result=excluded.result, updatedAt=?', jobKey, periodKey + ':' + Date.now(), JSON.stringify(result), nowIso());
    return result;
  });
}
