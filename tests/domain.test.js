import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateBenefit, resolveTarget, referralRewards, proportionalClawback, planDeduction, questEligible, BP } from '../server/domain.js';

const policy = { version: 'v2.4' };
const tier = (displayPriceRate, maxPointRate, cashEarnRate) => ({ displayPriceRate, maxPointRate, cashEarnRate });
const base = (o = {}) => ({ user: { tierCode: 'GOLD', roles: ['GENERAL'], walletAvailable: 1e9 }, product: { id: 1, basePrice: 100000, memberPriceAllowed: 1, maxPointRate: null }, brand: { id: 1, pricePolicy: 'MEMBER', maxPointRate: null }, policy, tierRule: tier(9000, 7000, 1000), ...o });

test('member price vs brand fixed price', () => {
  assert.equal(calculateBenefit(base()).unitPrice, 90000);
  assert.equal(calculateBenefit(base({ brand: { id: 1, pricePolicy: 'FIXED' } })).unitPrice, 100000);
});
test('actual max point rate = MIN of four caps (member 90%, product 30% → 30%)', () => {
  const c = calculateBenefit(base({ tierRule: tier(10000, 9000, 500), product: { id: 1, basePrice: 100000, memberPriceAllowed: 1, maxPointRate: 3000 } }));
  assert.equal(c.maxPointRate, 3000); assert.equal(c.maxPointAmount, 30000);
});
test('70,000 cash + 30,000 P → earn only on 70,000 cash', () => {
  const c = calculateBenefit(base({ tierRule: tier(10000, 3000, 500), requestedPoint: 30000 }));
  assert.equal(c.pointUsed, 30000); assert.equal(c.cashPaid, 70000); assert.equal(c.cashNetSales, 70000); assert.equal(c.expectedEarn, 3500);
});
test('requested points clamped by wallet and cap', () => {
  const c = calculateBenefit(base({ user: { tierCode: 'GOLD', roles: [], walletAvailable: 5000 }, requestedPoint: 999999 }));
  assert.equal(c.pointUsed, 5000);
});
test('percent coupon respects max discount; voucher after coupon', () => {
  const c = calculateBenefit(base({ coupon: { code: 'X', discountType: 'PERCENT', value: 1000, maxDiscount: 5000 }, voucher: { value: 30000 } }));
  assert.equal(c.couponDiscount, 5000); assert.equal(c.voucherDiscount, 30000); assert.equal(c.payable, 55000);
});
test('role target specificity: INFLUENCER+SELLER beats SELLER', () => {
  const t = [{ targetType: 'GLOBAL', requiredRole: 'SELLER', priceRate: 9200 }, { targetType: 'GLOBAL', requiredRole: 'INFLUENCER+SELLER', priceRate: 8200 }];
  assert.equal(resolveTarget(t, { roles: ['GENERAL', 'INFLUENCER', 'SELLER'] }, { id: 1 }, { id: 1 }).priceRate, 8200);
  assert.equal(resolveTarget(t, { roles: ['GENERAL', 'SELLER'] }, { id: 1 }, { id: 1 }).priceRate, 9200);
  assert.equal(resolveTarget(t, { roles: ['GENERAL'] }, { id: 1 }, { id: 1 }), null);
});
test('referral: L2 volume tracked but spendable reward gated by flag', () => {
  const p = { l1VolumeRate: BP, l2VolumeRate: 5000, l1RewardRate: 700, l2RewardRate: 300 };
  const off = referralRewards({ cashNetSales: 100000, policy: p, flags: { ENABLE_L2_NETWORK_VOLUME: true, ENABLE_L2_SPENDABLE_REWARD: false } });
  assert.equal(off[0].rewardPoint, 7000); assert.equal(off[1].volumeAmount, 50000); assert.equal(off[1].rewardPoint, 0);
  const on = referralRewards({ cashNetSales: 100000, policy: p, flags: { ENABLE_L2_NETWORK_VOLUME: true, ENABLE_L2_SPENDABLE_REWARD: true } });
  assert.equal(on[1].rewardPoint, 3000);
});
test('proportional clawback', () => { assert.equal(proportionalClawback(20000, 2500), -5000); });
test('deduction uses earliest expiry first', () => {
  const plan = planDeduction([{ id: 1, remainingAmount: 100, expiresAt: '2026-12-01', createdAt: '2026-01-01' }, { id: 2, remainingAmount: 100, expiresAt: '2026-09-01', createdAt: '2026-02-01' }], 150);
  assert.deepEqual(plan, [{ id: 2, take: 100 }, { id: 1, take: 50 }]);
  assert.throws(() => planDeduction([{ id: 1, remainingAmount: 10, createdAt: 'a' }], 20), /INSUFFICIENT/);
});
test('quest eligibility: capacity, role, period', () => {
  assert.equal(questEligible({ capacity: 20, completedCount: 20 }, { roles: [], tierCode: 'GOLD' }).reason, 'FULL');
  assert.equal(questEligible({ eligibility: { roles: ['INFLUENCER'] } }, { roles: ['GENERAL'], tierCode: 'GOLD' }).reason, 'ROLE');
  assert.equal(questEligible({ endsAt: '2020-01-01' }, { roles: [], tierCode: 'GOLD' }).reason, 'ENDED');
});
