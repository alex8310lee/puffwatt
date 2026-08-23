// Idempotent seed: safe to run repeatedly. No real people, no fabricated reviews.
import { db, q, tx, nowIso } from './db.js';
import { hashPassword } from './auth.js';

const DEMO_PW = 'Puffwatt!2026';
const daysFrom = (d) => new Date(Date.now() + d * 864e5).toISOString();

function upsert(table, where, values) {
  const row = q.get(`SELECT id FROM ${table} WHERE ${Object.keys(where).map(k => `${k}=?`).join(' AND ')}`, ...Object.values(where));
  const all = { ...where, ...values };
  if (row) { q.run(`UPDATE ${table} SET ${Object.keys(values).map(k => `${k}=?`).join(',')}, updatedAt=? WHERE id=?`, ...Object.values(values), nowIso(), row.id); return row.id; }
  const r = q.run(`INSERT INTO ${table} (${Object.keys(all).join(',')}) VALUES (${Object.keys(all).map(() => '?').join(',')})`, ...Object.values(all));
  return Number(r.lastInsertRowid);
}

export function seed() {
  return tx(() => {
    // ---- feature flags
    for (const [key, enabled, desc] of [
      ['ENABLE_L2_NETWORK_VOLUME', 1, 'L2 volume is tracked for performance'],
      ['ENABLE_L2_SPENDABLE_REWARD', 0, 'L2 spendable points — OFF until legal review'],
      ['ENABLE_DEMO_LOGIN', 1, 'One-click demo sessions (dev only)'],
      ['ENABLE_REAL_PAYMENT', 0, 'PG adapter — demo simulation only'],
    ]) q.run('INSERT INTO feature_flags (key,enabled,description) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET enabled=excluded.enabled', key, enabled, desc);

    // ---- policies v2.4 (active) and v2.5 (scheduled)
    const p24 = upsert('policy_versions', { version: 'v2.4' }, { name: 'Membership benefit policy', startsAt: '2026-05-01T00:00:00Z', isActive: 1, purchaseConfirmDays: 7,
      l1VolumeRate: 10000, l2VolumeRate: 5000, l1RewardRate: 700, l2RewardRate: 300, monthlyVolumeCap: 1000000, monthlyRewardCap: 500000, createdBy: 'seed' });
    const p25 = upsert('policy_versions', { version: 'v2.5' }, { name: 'Membership benefit policy', startsAt: daysFrom(30), isActive: 0, purchaseConfirmDays: 7,
      l1VolumeRate: 10000, l2VolumeRate: 5000, l1RewardRate: 800, l2RewardRate: 350, monthlyVolumeCap: 1500000, monthlyRewardCap: 700000, createdBy: 'seed' });
    // tier rules: [tier, priceRate, maxPoint, earn, monthlyCredit]
    const tiers = [['STANDARD', 10000, 3000, 500, 50000], ['SILVER', 9800, 4000, 600, 80000], ['GOLD', 9000, 7000, 1000, 150000], ['BLACK', 8500, 9000, 1200, 300000], ['ICON', 8000, 10000, 1500, 500000]];
    for (const [t, pr, mp, er, mc] of tiers) {
      upsert('policy_tier_rules', { policyVersionId: p24, tierCode: t }, { displayPriceRate: pr, maxPointRate: mp, cashEarnRate: er, monthlyCredit: mc });
      upsert('policy_tier_rules', { policyVersionId: p25, tierCode: t }, { displayPriceRate: pr, maxPointRate: mp, cashEarnRate: er + 100, monthlyCredit: mc });
    }
    // role targets (Approved Seller / Hybrid differentials)
    q.run('DELETE FROM policy_targets WHERE policyVersionId=?', p24);
    q.run('INSERT INTO policy_targets (policyVersionId,targetType,requiredRole,priceRate,maxPointRate,earnRate,label) VALUES (?,?,?,?,?,?,?)', p24, 'GLOBAL', 'SELLER', 9200, 4000, 600, 'Approved seller terms');
    q.run('INSERT INTO policy_targets (policyVersionId,targetType,requiredRole,priceRate,maxPointRate,earnRate,label) VALUES (?,?,?,?,?,?,?)', p24, 'GLOBAL', 'INFLUENCER+SELLER', 8200, 8500, 1400, 'Hybrid member terms');

    // ---- brands
    const brands = {};
    for (const [name, slug, pp, mpr] of [['PUFFWATT', 'puffwatt', 'MEMBER', null], ['ATELIER NOIR', 'atelier-noir', 'MEMBER', 4000], ["MAISON D'ÉLIXIR", 'maison-delixir', 'FIXED', 3000],
      ['NOCTURNE', 'nocturne', 'MEMBER', null], ['SOLACE RESIDENCES', 'solace', 'MEMBER', 3000]])
      brands[slug] = upsert('brands', { slug }, { name, pricePolicy: pp, maxPointRate: mpr });

    // ---- products (12) + services (4)
    const P = (slug, brand, name, category, basePrice, o = {}) => upsert('products', { slug }, { brandId: brands[brand], name, category, basePrice,
      memberPriceAllowed: o.mp ?? 1, maxPointRate: o.cap ?? null, visibility: o.vis ?? 'PUBLIC_MEMBER', requiredTierRank: o.rank ?? null, imageKey: o.img ?? slug,
      description: o.desc ?? '', itemType: o.type ?? 'PRODUCT', durationMinutes: o.dur ?? null, capacity: o.capacity ?? null, stock: o.stock ?? 100 });
    const prod = {};
    prod.weekender = P('no-07-weekender', 'atelier-noir', 'No. 07 Weekender', 'FASHION', 460000, { img: 'bag', desc: '풀그레인 레더 위켄더. 이니셜 각인 포함.' });
    prod.jacket = P('premium-leather-jacket', 'atelier-noir', 'Premium Leather Jacket', 'FASHION', 460000, { img: 'jacket', desc: '시즌 프리미엄 셀렉션.' });
    prod.watch = P('high-end-watch', 'puffwatt', 'High-end Watch', 'WATCH', 9800000, { img: 'watch', cap: 3500, desc: '하이엔드 워치 셀렉션. 상품 한도 35%.' });
    prod.fragrance = P('eclat-noir-fragrance', 'maison-delixir', 'Éclat Noir Fragrance', 'FRAGRANCE', 320000, { img: 'fragrance', desc: '브랜드 가격 고정 상품 — 모든 계정 동일 가격, 포인트·적립만 차등.' });
    prod.candle = P('signature-candle', 'nocturne', 'Signature Candle', 'HOME', 85000, { img: 'candle' });
    prod.wellness = P('private-wellness-kit', 'solace', 'Private Wellness Kit', 'WELLNESS', 380000, { img: 'wellness' });
    prod.serum = P('botanical-serum', 'maison-delixir', 'Botanical Serum', 'WELLNESS', 120000, { img: 'serum' });
    prod.diffuser = P('signature-diffuser', 'nocturne', 'Signature Diffuser 500ml', 'HOME', 126000, { img: 'diffuser' });
    prod.tea = P('artisan-tea-set', 'solace', 'Artisan Tea Set', 'HOME', 98000, { img: 'tea' });
    prod.travelcase = P('travel-case', 'atelier-noir', 'Leather Travel Case', 'FASHION', 60000, { img: 'case' });
    prod.scarf = P('limited-scarf', 'atelier-noir', 'Limited Scarf', 'FASHION', 210000, { img: 'scarf', vis: 'CREATOR_ONLY', desc: '크리에이터 전용 시딩 상품.' });
    prod.book = P('collector-edition-book', 'puffwatt', 'Collector Edition Book', 'EDITORIAL', 65000, { img: 'book', vis: 'SELLER_ONLY', desc: '승인 셀러 전용 공동구매 샘플.' });
    prod.demo100 = P('brand-fixed-100k', 'maison-delixir', 'Fixed-price Reference Item', 'HOME', 100000, { img: 'candle', desc: '차등 검증용 100,000원 브랜드 고정가 상품.' });
    prod.tier100 = P('member-price-100k', 'puffwatt', 'Member-price Reference Item', 'HOME', 100000, { img: 'tea', desc: '차등 검증용 100,000원 등급별 가격 상품.' });
    prod.retreat = P('private-wellness-retreat', 'solace', 'Private Wellness Retreat', 'RETREAT', 2400000, { img: 'retreat', type: 'SERVICE', dur: 180, capacity: 2, rank: 3, vis: 'TIER_RESTRICTED', desc: 'GOLD 이상. 180분 프라이빗 리트릿.' });
    prod.dining = P('private-dining', 'solace', 'Private Dining', 'DINING', 450000, { img: 'dining', type: 'SERVICE', dur: 120, capacity: 6, desc: '셰프 테이블 2시간.' });
    prod.concierge = P('personal-concierge', 'puffwatt', 'Personal Concierge Service', 'CONCIERGE', 1200000, { img: 'concierge', type: 'SERVICE', dur: 60, rank: 5, vis: 'TIER_RESTRICTED', desc: 'ICON 전용 1:1 컨시어지.' });
    prod.studio = P('creator-studio-session', 'puffwatt', 'Creator Studio Session', 'STUDIO', 350000, { img: 'studio', type: 'SERVICE', dur: 240, vis: 'CREATOR_ONLY', desc: '크리에이터 전용 스튜디오 4시간.' });

    // ---- coupons / vouchers
    const cStd = upsert('coupons', { code: 'WELCOME-5' }, { name: '기본 쿠폰 5%', discountType: 'PERCENT', value: 500, maxDiscount: 20000, minSpend: 50000 });
    const cSilver = upsert('coupons', { code: 'SILVER-7' }, { name: 'Silver 쿠폰 7%', discountType: 'PERCENT', value: 700, maxDiscount: 30000, minSpend: 50000, minTierRank: 2 });
    const cGold = upsert('coupons', { code: 'GOLD-10' }, { name: 'Gold 쿠폰 10%', discountType: 'PERCENT', value: 1000, maxDiscount: 50000, minSpend: 100000, minTierRank: 3 });
    const vAtelier = upsert('vouchers', { name: 'ATELIER NOIR ₩30,000 바우처' }, { value: 30000, brandId: brands['atelier-noir'] });
    const vIcon = upsert('vouchers', { name: 'ICON 무료 바우처 ₩100,000' }, { value: 100000 });

    // ---- demo accounts
    const accounts = [
      ['standard', 'Standard Member', 'STANDARD', ['GENERAL'], null, 'NONE', 50000, [cStd], []],
      ['silver', 'Silver Member', 'SILVER', ['GENERAL'], null, 'NONE', 80000, [cSilver], []],
      ['gold', 'Gold Creator', 'GOLD', ['GENERAL', 'INFLUENCER'], 'VERIFIED', 'NONE', 150000, [cGold], [vAtelier]],
      ['black', 'Black Creator', 'BLACK', ['GENERAL', 'INFLUENCER'], 'MEGA', 'NONE', 300000, [cGold], []],
      ['icon', 'Icon VIP', 'ICON', ['GENERAL', 'INFLUENCER'], 'CELEBRITY', 'NONE', 500000, [cGold], [vIcon]],
      ['seller', 'Approved Seller', 'STANDARD', ['GENERAL', 'SELLER'], null, 'APPROVED', 80000, [cStd], []],
      ['hybrid', 'Hybrid Member', 'BLACK', ['GENERAL', 'INFLUENCER', 'SELLER'], 'PRO', 'APPROVED', 150000, [cGold], []],
      ['admin', 'Super Admin', 'STANDARD', ['GENERAL', 'SUPER_ADMIN', 'ADMIN'], null, 'NONE', 0, [], []],
    ];
    const uid = {};
    accounts.forEach(([key, name, tier, roles, ctier, seller, credit, coupons, vouchers], i) => {
      const email = `${key}@demo.puffwatt.local`;
      const id = upsert('users', { email }, { name, memberCode: `PW-0000${i + 1}`, tierCode: tier, creatorTier: ctier, sellerStatus: seller,
        referralCode: `PW-${tier}-${1000 + i}`, isDemo: 1, passwordHash: hashPassword(DEMO_PW), featuredTitle: 'FIRST_LIGHT' });
      uid[key] = id;
      q.run('DELETE FROM user_roles WHERE userId=?', id);
      for (const r of roles) q.run('INSERT INTO user_roles (userId,role,source) VALUES (?,?,?)', id, r, 'seed');
      // monthly credit (idempotent by key)
      if (credit) q.run(`INSERT OR IGNORE INTO point_ledger (userId,pointType,entryType,status,amount,remainingAmount,sourceType,sourceId,idempotencyKey,availableAt,expiresAt,reason)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, id, 'MONTHLY_CREDIT', 'CREDIT', 'AVAILABLE', credit, credit, 'MONTHLY_CREDIT', null, `seed:credit:${id}:2026-08`, nowIso(), daysFrom(60), '월 베네핏');
      for (const c of coupons) q.run('INSERT OR IGNORE INTO user_entitlements (id,userId,type,couponId,sourceType) VALUES (?,?,?,?,?)', id * 100 + c, id, 'COUPON', c, 'seed');
      for (const v of vouchers) q.run('INSERT OR IGNORE INTO user_entitlements (id,userId,type,voucherId,sourceType) VALUES (?,?,?,?,?)', id * 100 + 50 + v, id, 'VOUCHER', v, 'seed');
      q.run('INSERT OR IGNORE INTO user_titles (userId,titleCode,earnedAt) VALUES (?,?,?)', id, 'FIRST_LIGHT', nowIso());
    });
    // invitation codes
    upsert('invitations', { code: 'PUFF-GOLD-26' }, { inviterUserId: uid.gold, allowedRole: 'GENERAL', tierCode: 'SILVER', maxUses: 50, expiresAt: daysFrom(365) });
    upsert('invitations', { code: 'PUFF-OPEN-26' }, { inviterUserId: null, allowedRole: 'GENERAL', tierCode: 'STANDARD', maxUses: 999, expiresAt: daysFrom(365) });

    // referral lineage: Standard A -> Silver B -> Gold Creator C  (A is L1 of B, L2 of C)
    q.run('DELETE FROM referral_relations');
    q.run('INSERT INTO referral_relations (referredUserId,referrerUserId,level,sourceCode) VALUES (?,?,1,?)', uid.silver, uid.standard, 'PW-STANDARD-1000');
    q.run('INSERT INTO referral_relations (referredUserId,referrerUserId,level,sourceCode) VALUES (?,?,1,?)', uid.gold, uid.silver, 'PW-SILVER-1001');
    q.run('INSERT INTO referral_relations (referredUserId,referrerUserId,level,sourceCode) VALUES (?,?,2,?)', uid.gold, uid.standard, 'PW-SILVER-1001');

    // ---- titles & achievements
    for (const [code, name, desc] of [['FIRST_LIGHT', 'FIRST LIGHT', '퍼프왓의 여정을 시작한 자'], ['PRIVATE_CURATOR', 'PRIVATE CURATOR', '엄선된 안목을 가진 큐레이터'], ['LINEAGE_MAKER', 'LINEAGE MAKER', '브랜드의 유산을 함께 만든 자']])
      q.run('INSERT OR REPLACE INTO titles (code,name,description) VALUES (?,?,?)', code, name, desc);
    for (const [code, name, desc, cat, ct, th, badge, title] of [
      ['FIRST_PURCHASE', 'FIRST PURCHASE', '첫 구매를 완료했습니다.', 'PURCHASE', 'CONFIRMED_ORDERS', 1, 'bag', null],
      ['QUEST_INITIATE', 'QUEST INITIATE', '첫 퀘스트를 완료했습니다.', 'QUEST', 'QUESTS_COMPLETED', 1, 'compass', null],
      ['REFERRAL_CIRCLE', 'REFERRAL CIRCLE', '친구를 퍼프왓으로 초대했습니다.', 'REFERRAL', 'REFERRALS', 1, 'circle', null],
      ['CREATOR_VERIFIED', 'CREATOR VERIFIED', '크리에이터 인증을 완료하세요.', 'CREATOR', 'SOCIAL_VERIFIED', 1, 'p', 'PRIVATE_CURATOR'],
      ['SELLER_MOMENTUM', 'SELLER MOMENTUM', '누적 판매 5회를 달성하세요.', 'SELLER', 'SELLER_SALES', 5, 'chart', null],
      ['BLACK_ASCENT', 'BLACK ASCENT', '누적 구매 10회를 달성하세요.', 'PURCHASE', 'CONFIRMED_ORDERS', 10, 'tower', 'LINEAGE_MAKER']])
      upsert('achievements', { code }, { name, description: desc, category: cat, conditionType: ct, threshold: th, badgeCode: badge, titleCode: title });

    // ---- quests
    upsert('quests', { code: 'FIRST20-WEEKENDER' }, { name: 'No. 07 Weekender 리뷰', type: 'FIRST_COME', productId: prod.weekender, capacity: 20, startsAt: daysFrom(-30), endsAt: daysFrom(30),
      description: '선착순 20명. 구매 확정 후 리뷰(사진 3장 이상 + 텍스트)를 등록하면 3,000P.', conditionsJson: JSON.stringify([{ type: 'PURCHASED_PRODUCT', productId: prod.weekender }, { type: 'EVIDENCE_URL' }]),
      rewardType: 'POINT', rewardAmount: 3000, rewardBadge: null });
    upsert('quests', { code: 'NET300K' }, { name: '현금 순매출 ₩300,000 달성', type: 'CONDITIONAL', startsAt: daysFrom(-30), endsAt: daysFrom(30),
      description: '기간 내 현금 순매출 30만 원(취소·환불 제외) 달성 시 ₩30,000 바우처.', conditionsJson: JSON.stringify([{ type: 'CASH_NET_SALES_GTE', value: 300000 }]),
      rewardType: 'VOUCHER', rewardAmount: vAtelier });
    upsert('quests', { code: 'SNS-VERIFY' }, { name: 'SNS 인증 완료', type: 'CREATOR', startsAt: null, endsAt: null, eligibilityJson: JSON.stringify({ roles: ['INFLUENCER'] }),
      description: 'PUFFWATT 제품 콘텐츠에 @puffwatt.official 태그 후 게시물 URL 등록. 상시 진행.', conditionsJson: JSON.stringify([{ type: 'EVIDENCE_URL' }]),
      rewardType: 'BADGE', rewardAmount: null, rewardBadge: 'CREATOR' });

    // ---- creator profiles
    const cp = {};
    for (const [key, dn, cat, st] of [['gold', 'Gold Creator', 'Beauty & Lifestyle', 'VERIFIED'], ['black', 'Black Creator', 'Fashion', 'VERIFIED'], ['icon', 'Icon VIP', 'Luxury', 'VERIFIED'], ['hybrid', 'Hybrid Member', 'Home & Living', 'PENDING']]) {
      cp[key] = upsert('creator_profiles', { userId: uid[key] }, { displayName: dn, bio: '팩트 기반의 신뢰로, 더 높은 가치를 만듭니다.', category: cat, location: 'Seoul, Korea', profileCompletion: st === 'VERIFIED' ? 86 : 40, verificationStatus: st });
      for (const [prov, handle, f, r, e, vs] of [['instagram', `@${key}.demo`, 126000, 1200000, 380, 'PLATFORM_VERIFIED'], ['youtube', `${key}-demo`, 89300, 69500, 460, 'SELF_REPORTED'], ['tiktok', `@${key}.demo`, 237000, 2100000, 520, 'PLATFORM_VERIFIED']])
        upsert('social_accounts', { creatorProfileId: cp[key], provider: prov }, { handle, followers: f, reach30d: r, engagementRateBp: e, verificationSource: vs, verificationStatus: st === 'VERIFIED' ? 'VERIFIED' : 'PENDING', lastVerifiedAt: st === 'VERIFIED' ? daysFrom(-3) : null });
      q.run('DELETE FROM rate_cards WHERE creatorProfileId=?', cp[key]);
      for (const [ct, d, a] of [['Instagram Reel', '브랜드 협업 릴 콘텐츠 (60초 이내)', 3500000], ['Story Set', '인스타그램 스토리 3~5장', 1200000], ['Live Session', '인스타그램 라이브 (30분)', 2500000], ['Event Attendance', '브랜드 행사 참석 (4시간 기준)', 2000000]])
        q.run('INSERT INTO rate_cards (creatorProfileId,contentType,description,amount) VALUES (?,?,?,?)', cp[key], ct, d, a);
      q.run('DELETE FROM portfolios WHERE creatorProfileId=?', cp[key]);
      for (const [t, b, v, s] of [['PUFFWATT FRAGRANCE 2026 S/S CAMPAIGN', 'PUFFWATT', 'PUBLIC', 0], ['LUXURY HOTEL BRAND COLLABORATION', 'SOLACE', 'MEMBER_ONLY', 1], ['PRIVATE EVENT EXCLUSIVE COVERAGE', 'ATELIER NOIR', 'OPERATOR_ONLY', 2]])
        q.run('INSERT INTO portfolios (creatorProfileId,title,brandName,visibility,sortOrder) VALUES (?,?,?,?,?)', cp[key], t, b, v, s);
    }

    // ---- opportunities + assignments
    const O = (title, o) => upsert('opportunities', { title }, o);
    const op = {};
    op.atelier = O('ATELIER NOIR', { type: 'CAMPAIGN', subtitle: 'FW CREATOR CAMPAIGN', brandId: brands['atelier-noir'], rewardType: 'CASH', rewardMin: 1500000, rewardMax: 2500000, deadline: daysFrom(20), requiredRole: 'INFLUENCER', requiredTierRank: 3,
      description: "PUFFWATT의 26FW 컬렉션 'ATELIER NOIR'의 감도를 당신만의 시선으로 담아주세요.", requirementsJson: JSON.stringify({ deliverables: ['Instagram Reel 1편', 'Story 3컷'], timeline: '브랜드 승인 후 14일 공개', usageRights: '2차 활용 3개월', eligibility: '고급스러운 콘텐츠 제작이 가능한 크리에이터' }), createdBy: uid.admin });
    op.wellness = O('PRIVATE WELLNESS', { type: 'EVENT', subtitle: 'RETREAT HOST', brandId: brands['solace'], rewardType: 'CASH', rewardMin: 1200000, rewardMax: 2000000, deadline: daysFrom(23), requiredRole: 'INFLUENCER', requiredTierRank: 3,
      description: '프라이빗 리트릿 호스트 1일.', requirementsJson: JSON.stringify({ deliverables: ['행사 호스팅 4시간', 'Story 5컷'], timeline: '행사 당일', usageRights: '2차 활용 6개월' }), createdBy: uid.admin });
    op.nocturne = O('NOCTURNE', { type: 'LIVE', subtitle: 'LIVE COMMERCE', brandId: brands['nocturne'], rewardType: 'COMMISSION', commissionRateBp: 1500, minSales: 5000000, rewardMin: 800000, rewardMax: 1500000, deadline: daysFrom(25), requiredRole: 'SELLER',
      description: '럭셔리 홈 프래그런스 컬렉션 90분 라이브.', requirementsJson: JSON.stringify({ deliverables: ['라이브 90분', '연출 계획서'], timeline: '지정일 20:00~21:30' }), createdBy: uid.admin });
    op.editorial = O('PUFFWATT EDITORIAL', { type: 'OUTSOURCE', subtitle: 'EDITORIAL COMMISSION', brandId: brands['puffwatt'], rewardType: 'CASH', rewardMin: 900000, rewardMax: 1800000, deadline: daysFrom(17), requiredRole: 'INFLUENCER', requiredTierRank: 3,
      description: '에디토리얼 원고 1편 (2,000자).', requirementsJson: JSON.stringify({ deliverables: ['원고 1편'], timeline: '마감 후 7일 검수' }), createdBy: uid.admin });
    op.groupbuy = O('WELLNESS EDITION', { type: 'GROUP_BUY', subtitle: '웰니스 에디션 공동구매', brandId: brands['solace'], rewardType: 'COMMISSION', commissionRateBp: 1000, minSales: 15000000, startsAt: daysFrom(-3), deadline: daysFrom(18), requiredRole: 'SELLER',
      description: '프리미엄 헬스 & 웰니스 컬렉션 공동구매.', requirementsJson: JSON.stringify({ deliverables: ['콘텐츠 가이드 준수', '판매 리포트'], timeline: '3주' }), createdBy: uid.admin });
    op.live2 = O('SIGNATURE CANDLE LIVE', { type: 'LIVE', subtitle: 'PRIVATE LIVE', brandId: brands['nocturne'], rewardType: 'COMMISSION', commissionRateBp: 1200, minSales: 3000000, deadline: daysFrom(40), requiredRole: 'SELLER', createdBy: uid.admin, description: '시그니처 캔들 60분 라이브.' });
    op.seeding = O('SEEDING — LIMITED SCARF', { type: 'CAMPAIGN', subtitle: 'FREE SEEDING', brandId: brands['atelier-noir'], rewardType: 'PRODUCT', deadline: daysFrom(14), requiredRole: 'INFLUENCER', createdBy: uid.admin, description: '리미티드 스카프 무료 시딩. 콘텐츠 1건.' });

    const A = (opKey, userKey, status, extra = {}) => upsert('opportunity_assignments', { opportunityId: op[opKey], userId: uid[userKey] }, { status, invitedAt: daysFrom(-5), assignedBy: uid.admin, ...extra });
    A('atelier', 'gold', 'INVITED', { rewardAmount: 1800000 });
    A('wellness', 'gold', 'APPLIED', { rewardAmount: 1500000 });
    A('editorial', 'gold', 'SUBMITTED', { rewardAmount: 1200000 });
    A('seeding', 'gold', 'INVITED');
    A('atelier', 'black', 'ACCEPTED', { rewardAmount: 2500000 });
    A('atelier', 'icon', 'INVITED', { rewardAmount: 2500000 });
    A('wellness', 'icon', 'APPROVED', { rewardAmount: 2000000 });
    A('groupbuy', 'seller', 'IN_PROGRESS');
    A('nocturne', 'seller', 'APPROVED');
    A('groupbuy', 'hybrid', 'ACCEPTED');
    A('live2', 'hybrid', 'INVITED');
    A('atelier', 'hybrid', 'INVITED', { rewardAmount: 2000000 });
    // seller settlement sample
    q.run('DELETE FROM settlement_ledger');
    q.run('INSERT INTO settlement_ledger (userId,opportunityId,grossCashSales,returns,fee,netSettlement,status,periodStart,periodEnd) VALUES (?,?,?,?,?,?,?,?,?)', uid.seller, op.groupbuy, 8240000, 520000, 772000, 6948000, 'PENDING', daysFrom(-15), daysFrom(0));
    q.run('INSERT INTO settlement_ledger (userId,opportunityId,grossCashSales,returns,fee,netSettlement,status,periodStart,periodEnd,paidAt) VALUES (?,?,?,?,?,?,?,?,?,?)', uid.seller, op.nocturne, 4220000, 300000, 588000, 3332000, 'PAID', daysFrom(-30), daysFrom(-16), daysFrom(-10));
    q.run('INSERT INTO settlement_ledger (userId,opportunityId,grossCashSales,returns,fee,netSettlement,status,periodStart,periodEnd) VALUES (?,?,?,?,?,?,?,?,?)', uid.hybrid, op.groupbuy, 2100000, 0, 210000, 1890000, 'PENDING', daysFrom(-15), daysFrom(0));

    q.run('INSERT OR IGNORE INTO admin_audit_logs (adminId,action,objectType,objectId,beforeJson,afterJson,reason) VALUES (?,?,?,?,?,?,?)', uid.admin, 'POLICY.CREATE', 'policy_version', 'v2.5', null, JSON.stringify({ l1RewardRate: 800 }), 'seed: scheduled policy');
    return uid;
  });
}

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  const ids = seed();
  console.log('Seeded demo accounts:', ids);
  console.log(`Password (demo only): ${DEMO_PW}`);
}
export { DEMO_PW };
