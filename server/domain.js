// PUFFWATT domain engine — pure functions, no I/O.
// Money = integer KRW, points = integer P, rates = basis points (10000 = 100%).
export const BP = 10000;
export const TIER_RANK = { STANDARD: 1, SILVER: 2, GOLD: 3, BLACK: 4, ICON: 5 };

export function minRate(...rates) {
  return rates.reduce((a, r) => (r == null ? a : Math.min(a, r)), BP);
}

/** Most specific policy target for user/product/brand. */
export function resolveTarget(targets, user, product, brand) {
  const roles = new Set(user.roles || []);
  const cands = targets.filter(t => {
    if (t.requiredRole && !t.requiredRole.split('+').every(r => roles.has(r))) return false;
    if (t.requiredTierRank && (TIER_RANK[user.tierCode] || 0) < t.requiredTierRank) return false;
    if (t.targetType === 'PRODUCT' && t.targetId !== product.id) return false;
    if (t.targetType === 'BRAND' && t.targetId !== brand.id) return false;
    if (t.targetType === 'CATEGORY' && t.targetId !== product.category) return false;
    return true;
  });
  const spec = { PRODUCT: 4, BRAND: 3, CATEGORY: 2, GLOBAL: 1 };
  cands.sort((a, b) => (spec[b.targetType] - spec[a.targetType]) ||
    ((b.requiredRole || '').split('+').length - (a.requiredRole || '').split('+').length));
  return cands[0] || null;
}

/** Same function for product detail, cart preview and checkout. */
export function calculateBenefit(ctx) {
  const { user, product, brand, policy, tierRule } = ctx;
  const qty = Math.max(1, ctx.quantity || 1);
  const trace = [`POLICY ${policy.version} · ${user.tierCode}`];

  let priceRate = null;
  if (product.memberPriceAllowed && brand.pricePolicy !== 'FIXED') {
    priceRate = ctx.target?.priceRate ?? tierRule.displayPriceRate ?? BP;
    trace.push(`price rate ${priceRate / 100}% (${ctx.target ? ctx.target.targetType + ' target' : 'tier rule'})`);
  } else trace.push('brand price fixed');
  const unitPrice = priceRate == null ? product.basePrice : Math.round(product.basePrice * priceRate / BP);
  const displayPrice = unitPrice * qty;

  let couponDiscount = 0;
  if (ctx.coupon) {
    const c = ctx.coupon;
    if (displayPrice >= (c.minSpend || 0)) {
      couponDiscount = c.discountType === 'PERCENT'
        ? Math.min(Math.floor(displayPrice * c.value / BP), c.maxDiscount || Infinity)
        : Math.min(c.value, displayPrice);
      trace.push(`coupon ${c.code} -${couponDiscount}`);
    } else trace.push(`coupon ${c.code} skipped (min spend)`);
  }
  let voucherDiscount = 0;
  if (ctx.voucher) {
    const v = ctx.voucher;
    if ((!v.productId || v.productId === product.id) && (!v.brandId || v.brandId === brand.id)) {
      voucherDiscount = Math.min(v.value, displayPrice - couponDiscount); trace.push(`voucher -${voucherDiscount}`);
    }
  }
  const payable = Math.max(0, displayPrice - couponDiscount - voucherDiscount);

  const maxPointRate = minRate(ctx.target?.maxPointRate ?? tierRule.maxPointRate,
    product.maxPointRate, brand.maxPointRate, ctx.campaignMaxPointRate);
  const maxPointAmount = Math.floor(payable * maxPointRate / BP);
  trace.push(`point cap MIN(tier,product,brand,campaign)=${maxPointRate / 100}% → ${maxPointAmount}P`);

  const requested = ctx.requestedPoint == null ? maxPointAmount : Math.max(0, ctx.requestedPoint);
  const pointUsed = Math.min(user.walletAvailable ?? 0, requested, maxPointAmount);
  if (requested > pointUsed) trace.push(`requested ${requested}P clamped to ${pointUsed}P`);

  const shippingFee = ctx.shippingFee || 0;
  const cashPaid = payable - pointUsed + shippingFee;
  const cashNetSales = Math.max(0, cashPaid - shippingFee);
  const cashEarnRate = ctx.target?.earnRate ?? tierRule.cashEarnRate;
  const expectedEarn = Math.floor(cashNetSales * cashEarnRate / BP);
  trace.push(`earn ${cashEarnRate / 100}% × ${cashNetSales} → ${expectedEarn}P (points & shipping excluded)`);

  return {
    policyVersion: policy.version, tierCode: user.tierCode, roles: user.roles,
    unitPrice, basePrice: product.basePrice, quantity: qty, displayPrice,
    couponDiscount, voucherDiscount, payable, maxPointRate, maxPointAmount, pointUsed,
    cashPaid, shippingFee, cashNetSales, cashEarnRate, expectedEarn,
    snapshot: `POLICY ${policy.version} · ${user.tierCode} · CAP ${maxPointRate / 100}%`, trace
  };
}

export function referralRewards({ cashNetSales, policy, flags }) {
  const out = [{ level: 1, volumeRate: policy.l1VolumeRate, rewardRate: policy.l1RewardRate,
    volumeAmount: Math.floor(cashNetSales * policy.l1VolumeRate / BP),
    rewardPoint: Math.floor(cashNetSales * policy.l1RewardRate / BP) }];
  if (flags.ENABLE_L2_NETWORK_VOLUME) out.push({ level: 2, volumeRate: policy.l2VolumeRate, rewardRate: policy.l2RewardRate,
    volumeAmount: Math.floor(cashNetSales * policy.l2VolumeRate / BP),
    rewardPoint: flags.ENABLE_L2_SPENDABLE_REWARD ? Math.floor(cashNetSales * policy.l2RewardRate / BP) : 0 });
  return out;
}

export function proportionalClawback(originalAmount, returnedRatioBp) {
  return -Math.floor(originalAmount * returnedRatioBp / BP);
}

/** Earliest expiry first, then oldest createdAt. */
export function planDeduction(entries, amount) {
  const sorted = [...entries].filter(e => e.remainingAmount > 0).sort((a, b) => {
    const ea = a.expiresAt || '9999', eb = b.expiresAt || '9999';
    return ea < eb ? -1 : ea > eb ? 1 : a.createdAt < b.createdAt ? -1 : 1;
  });
  const plan = []; let left = amount;
  for (const e of sorted) { if (left <= 0) break; const take = Math.min(e.remainingAmount, left); plan.push({ id: e.id, take }); left -= take; }
  if (left > 0) throw new Error('INSUFFICIENT_POINTS');
  return plan;
}

export function xpForCash(cashNetSales) { return Math.floor(cashNetSales / 1000); }

export function questEligible(quest, u) {
  const e = quest.eligibility || {};
  if (e.roles && !e.roles.some(r => u.roles.includes(r))) return { ok: false, reason: 'ROLE' };
  if (e.minTierRank && (TIER_RANK[u.tierCode] || 0) < e.minTierRank) return { ok: false, reason: 'TIER' };
  const now = u.now || new Date().toISOString();
  if (quest.startsAt && now < quest.startsAt) return { ok: false, reason: 'NOT_STARTED' };
  if (quest.endsAt && now > quest.endsAt) return { ok: false, reason: 'ENDED' };
  if (quest.capacity != null && quest.completedCount >= quest.capacity) return { ok: false, reason: 'FULL' };
  return { ok: true };
}
