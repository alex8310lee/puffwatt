import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.PUFFWATT_DB || path.join(__dirname, '..', 'data', 'puffwatt.sqlite');
mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');

const BASE = 'id INTEGER PRIMARY KEY AUTOINCREMENT, createdAt TEXT NOT NULL DEFAULT (strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\')), updatedAt TEXT NOT NULL DEFAULT (strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\'))';

db.exec(`
CREATE TABLE IF NOT EXISTS users (${BASE}, email TEXT UNIQUE, passwordHash TEXT, name TEXT NOT NULL, memberCode TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE', tierCode TEXT NOT NULL DEFAULT 'STANDARD', creatorTier TEXT, sellerStatus TEXT NOT NULL DEFAULT 'NONE',
  featuredTitle TEXT, referralCode TEXT UNIQUE, isDemo INTEGER NOT NULL DEFAULT 0, lastSignedIn TEXT);
CREATE TABLE IF NOT EXISTS user_roles (${BASE}, userId INTEGER NOT NULL, role TEXT NOT NULL, isActive INTEGER NOT NULL DEFAULT 1, source TEXT, UNIQUE(userId, role));
CREATE TABLE IF NOT EXISTS invitations (${BASE}, code TEXT UNIQUE NOT NULL, inviterUserId INTEGER, allowedRole TEXT NOT NULL DEFAULT 'GENERAL', tierCode TEXT,
  maxUses INTEGER NOT NULL DEFAULT 1, usedCount INTEGER NOT NULL DEFAULT 0, expiresAt TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE');
CREATE TABLE IF NOT EXISTS manual_overrides (${BASE}, userId INTEGER NOT NULL, overrideType TEXT NOT NULL, beforeValue TEXT, afterValue TEXT, reason TEXT NOT NULL,
  startsAt TEXT NOT NULL, endsAt TEXT, activatedAt TEXT, revertedAt TEXT, adminId INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS feature_flags (key TEXT PRIMARY KEY, enabled INTEGER NOT NULL, environment TEXT NOT NULL DEFAULT 'all', description TEXT);

CREATE TABLE IF NOT EXISTS policy_versions (${BASE}, version TEXT UNIQUE NOT NULL, name TEXT, startsAt TEXT NOT NULL, endsAt TEXT, isActive INTEGER NOT NULL DEFAULT 0,
  purchaseConfirmDays INTEGER NOT NULL DEFAULT 7, l1VolumeRate INTEGER NOT NULL, l2VolumeRate INTEGER NOT NULL, l1RewardRate INTEGER NOT NULL, l2RewardRate INTEGER NOT NULL,
  monthlyVolumeCap INTEGER, monthlyRewardCap INTEGER, createdBy TEXT);
CREATE TABLE IF NOT EXISTS policy_tier_rules (${BASE}, policyVersionId INTEGER NOT NULL, tierCode TEXT NOT NULL, displayPriceRate INTEGER, maxPointRate INTEGER NOT NULL,
  cashEarnRate INTEGER NOT NULL, monthlyCredit INTEGER NOT NULL DEFAULT 0, UNIQUE(policyVersionId, tierCode));
CREATE TABLE IF NOT EXISTS policy_targets (${BASE}, policyVersionId INTEGER NOT NULL, targetType TEXT NOT NULL, targetId INTEGER, requiredRole TEXT, requiredTierRank INTEGER,
  maxPointRate INTEGER, priceRate INTEGER, earnRate INTEGER, label TEXT);

CREATE TABLE IF NOT EXISTS brands (${BASE}, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE', pricePolicy TEXT NOT NULL DEFAULT 'MEMBER', maxPointRate INTEGER);
CREATE TABLE IF NOT EXISTS products (${BASE}, brandId INTEGER NOT NULL, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, category TEXT NOT NULL, itemType TEXT NOT NULL DEFAULT 'PRODUCT',
  basePrice INTEGER NOT NULL, memberPriceAllowed INTEGER NOT NULL DEFAULT 1, maxPointRate INTEGER, visibility TEXT NOT NULL DEFAULT 'PUBLIC_MEMBER', requiredTierRank INTEGER,
  stock INTEGER NOT NULL DEFAULT 100, purchaseLimit INTEGER, imageKey TEXT, description TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE', durationMinutes INTEGER, capacity INTEGER);
CREATE TABLE IF NOT EXISTS coupons (${BASE}, name TEXT, code TEXT UNIQUE NOT NULL, discountType TEXT NOT NULL, value INTEGER NOT NULL, maxDiscount INTEGER, minSpend INTEGER DEFAULT 0, minTierRank INTEGER, status TEXT DEFAULT 'ACTIVE');
CREATE TABLE IF NOT EXISTS vouchers (${BASE}, name TEXT, value INTEGER NOT NULL, productId INTEGER, brandId INTEGER, status TEXT DEFAULT 'ACTIVE');
CREATE TABLE IF NOT EXISTS user_entitlements (${BASE}, userId INTEGER NOT NULL, type TEXT NOT NULL, couponId INTEGER, voucherId INTEGER, status TEXT NOT NULL DEFAULT 'AVAILABLE',
  usedAt TEXT, expiresAt TEXT, sourceType TEXT, sourceId INTEGER);

CREATE TABLE IF NOT EXISTS carts (${BASE}, userId INTEGER UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS cart_items (${BASE}, cartId INTEGER NOT NULL, productId INTEGER NOT NULL, quantity INTEGER NOT NULL DEFAULT 1, UNIQUE(cartId, productId));
CREATE TABLE IF NOT EXISTS orders (${BASE}, orderNo TEXT UNIQUE NOT NULL, userId INTEGER NOT NULL, status TEXT NOT NULL, cashSubtotal INTEGER NOT NULL, pointUsed INTEGER NOT NULL,
  couponDiscount INTEGER NOT NULL DEFAULT 0, voucherDiscount INTEGER NOT NULL DEFAULT 0, shippingFee INTEGER NOT NULL DEFAULT 0, cashPaid INTEGER NOT NULL, cashRefunded INTEGER NOT NULL DEFAULT 0,
  earnedPointPending INTEGER NOT NULL DEFAULT 0, policyVersion TEXT NOT NULL, benefitSnapshotJson TEXT NOT NULL, confirmDeadline TEXT, confirmedAt TEXT, cancelledAt TEXT);
CREATE TABLE IF NOT EXISTS order_items (${BASE}, orderId INTEGER NOT NULL, productId INTEGER NOT NULL, itemType TEXT NOT NULL, nameSnapshot TEXT NOT NULL, unitPrice INTEGER NOT NULL,
  quantity INTEGER NOT NULL, returnedQuantity INTEGER NOT NULL DEFAULT 0, cashAllocated INTEGER NOT NULL, pointAllocated INTEGER NOT NULL, benefitSnapshotJson TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS refunds (${BASE}, orderId INTEGER NOT NULL, type TEXT NOT NULL, cashAmount INTEGER NOT NULL, pointAmount INTEGER NOT NULL, reason TEXT, status TEXT NOT NULL DEFAULT 'DONE',
  requestedBy INTEGER, processedBy INTEGER, processedAt TEXT);

CREATE TABLE IF NOT EXISTS point_ledger (${BASE}, userId INTEGER NOT NULL, pointType TEXT NOT NULL DEFAULT 'EARNED_POINT', entryType TEXT NOT NULL, status TEXT NOT NULL,
  amount INTEGER NOT NULL, remainingAmount INTEGER NOT NULL DEFAULT 0, sourceType TEXT NOT NULL, sourceId INTEGER, idempotencyKey TEXT UNIQUE NOT NULL, availableAt TEXT, expiresAt TEXT,
  reversalOfId INTEGER, reason TEXT);
CREATE TABLE IF NOT EXISTS xp_ledger (${BASE}, userId INTEGER NOT NULL, entryType TEXT NOT NULL, status TEXT NOT NULL, amount INTEGER NOT NULL, sourceType TEXT NOT NULL, sourceId INTEGER,
  idempotencyKey TEXT UNIQUE NOT NULL, reversalOfId INTEGER);
CREATE TABLE IF NOT EXISTS referral_relations (${BASE}, referredUserId INTEGER NOT NULL, referrerUserId INTEGER NOT NULL, level INTEGER NOT NULL, sourceCode TEXT, endsAt TEXT, UNIQUE(referredUserId, level));
CREATE TABLE IF NOT EXISTS referral_reward_ledger (${BASE}, beneficiaryUserId INTEGER NOT NULL, sourceUserId INTEGER NOT NULL, orderId INTEGER NOT NULL, level INTEGER NOT NULL,
  cashNetSales INTEGER NOT NULL, volumeRate INTEGER NOT NULL, volumeAmount INTEGER NOT NULL, rewardRate INTEGER NOT NULL, rewardPoint INTEGER NOT NULL, status TEXT NOT NULL,
  idempotencyKey TEXT UNIQUE NOT NULL, reversalOfId INTEGER);
CREATE TABLE IF NOT EXISTS monthly_credit_runs (${BASE}, ruleKey TEXT NOT NULL, periodKey TEXT NOT NULL, userId INTEGER NOT NULL, ledgerId INTEGER, idempotencyKey TEXT UNIQUE NOT NULL, status TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS quests (${BASE}, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, productId INTEGER, description TEXT, capacity INTEGER, startsAt TEXT, endsAt TEXT,
  eligibilityJson TEXT NOT NULL DEFAULT '{}', conditionsJson TEXT NOT NULL DEFAULT '[]', rewardType TEXT NOT NULL, rewardAmount INTEGER, rewardBadge TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE');
CREATE TABLE IF NOT EXISTS quest_participations (${BASE}, questId INTEGER NOT NULL, userId INTEGER NOT NULL, status TEXT NOT NULL, completedAt TEXT, rewardedAt TEXT, evidenceJson TEXT, UNIQUE(questId, userId));
CREATE TABLE IF NOT EXISTS achievements (${BASE}, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, description TEXT, category TEXT, conditionType TEXT NOT NULL, threshold INTEGER NOT NULL, badgeCode TEXT, titleCode TEXT);
CREATE TABLE IF NOT EXISTS user_achievements (${BASE}, userId INTEGER NOT NULL, achievementId INTEGER NOT NULL, earnedAt TEXT NOT NULL, sourceType TEXT, sourceId INTEGER, UNIQUE(userId, achievementId));
CREATE TABLE IF NOT EXISTS titles (code TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT);
CREATE TABLE IF NOT EXISTS user_titles (${BASE}, userId INTEGER NOT NULL, titleCode TEXT NOT NULL, earnedAt TEXT NOT NULL, UNIQUE(userId, titleCode));

CREATE TABLE IF NOT EXISTS creator_profiles (${BASE}, userId INTEGER UNIQUE NOT NULL, displayName TEXT, bio TEXT, category TEXT, location TEXT, profileCompletion INTEGER DEFAULT 0,
  verificationStatus TEXT DEFAULT 'UNVERIFIED', visibility TEXT DEFAULT 'MEMBER_ONLY');
CREATE TABLE IF NOT EXISTS social_accounts (${BASE}, creatorProfileId INTEGER NOT NULL, provider TEXT NOT NULL, handle TEXT NOT NULL, followers INTEGER DEFAULT 0, reach30d INTEGER DEFAULT 0,
  engagementRateBp INTEGER DEFAULT 0, verificationSource TEXT DEFAULT 'SELF_REPORTED', verificationStatus TEXT DEFAULT 'PENDING', lastVerifiedAt TEXT, isPublic INTEGER DEFAULT 1, UNIQUE(creatorProfileId, provider));
CREATE TABLE IF NOT EXISTS rate_cards (${BASE}, creatorProfileId INTEGER NOT NULL, contentType TEXT NOT NULL, description TEXT, amount INTEGER NOT NULL, vatIncluded INTEGER DEFAULT 0, visibility TEXT DEFAULT 'OPERATOR_ONLY', isActive INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS portfolios (${BASE}, creatorProfileId INTEGER NOT NULL, title TEXT NOT NULL, brandName TEXT, visibility TEXT DEFAULT 'PUBLIC', sortOrder INTEGER DEFAULT 0);

CREATE TABLE IF NOT EXISTS opportunities (${BASE}, type TEXT NOT NULL, title TEXT NOT NULL, subtitle TEXT, brandId INTEGER, description TEXT, requirementsJson TEXT NOT NULL DEFAULT '{}',
  rewardType TEXT NOT NULL, rewardMin INTEGER, rewardMax INTEGER, commissionRateBp INTEGER, minSales INTEGER, startsAt TEXT, deadline TEXT, status TEXT NOT NULL DEFAULT 'OPEN',
  visibility TEXT NOT NULL DEFAULT 'ASSIGNED', requiredRole TEXT, requiredTierRank INTEGER, createdBy INTEGER);
CREATE TABLE IF NOT EXISTS opportunity_assignments (${BASE}, opportunityId INTEGER NOT NULL, userId INTEGER NOT NULL, status TEXT NOT NULL, invitedAt TEXT NOT NULL, viewedAt TEXT, respondedAt TEXT,
  rewardAmount INTEGER, assignedBy INTEGER, UNIQUE(opportunityId, userId));
CREATE TABLE IF NOT EXISTS campaign_submissions (${BASE}, assignmentId INTEGER NOT NULL, url TEXT NOT NULL, note TEXT, status TEXT NOT NULL DEFAULT 'SUBMITTED', submittedAt TEXT NOT NULL, reviewedAt TEXT, reviewedBy INTEGER, feedback TEXT);
CREATE TABLE IF NOT EXISTS assignment_messages (${BASE}, assignmentId INTEGER NOT NULL, fromUserId INTEGER NOT NULL, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settlement_ledger (${BASE}, userId INTEGER NOT NULL, opportunityId INTEGER, grossCashSales INTEGER NOT NULL, returns INTEGER NOT NULL DEFAULT 0, fee INTEGER NOT NULL DEFAULT 0,
  netSettlement INTEGER NOT NULL, status TEXT NOT NULL, periodStart TEXT, periodEnd TEXT, paidAt TEXT);

CREATE TABLE IF NOT EXISTS notifications (${BASE}, userId INTEGER NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT, link TEXT, readAt TEXT);
CREATE TABLE IF NOT EXISTS admin_audit_logs (${BASE}, adminId INTEGER NOT NULL, action TEXT NOT NULL, objectType TEXT NOT NULL, objectId TEXT, beforeJson TEXT, afterJson TEXT, reason TEXT, ipHash TEXT);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, userId INTEGER NOT NULL, kind TEXT NOT NULL, createdAt TEXT NOT NULL, expiresAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS scheduled_job_runs (${BASE}, jobKey TEXT NOT NULL, periodKey TEXT NOT NULL, result TEXT, UNIQUE(jobKey, periodKey));

CREATE INDEX IF NOT EXISTS ix_ledger_user ON point_ledger(userId, status, expiresAt);
CREATE INDEX IF NOT EXISTS ix_orders_user ON orders(userId, createdAt);
CREATE INDEX IF NOT EXISTS ix_assign_user ON opportunity_assignments(userId);
CREATE INDEX IF NOT EXISTS ix_audit_time ON admin_audit_logs(createdAt);
`);

export const q = {
  get: (sql, ...p) => db.prepare(sql).get(...p),
  all: (sql, ...p) => db.prepare(sql).all(...p),
  run: (sql, ...p) => db.prepare(sql).run(...p),
};
export const nowIso = () => new Date().toISOString();
export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
