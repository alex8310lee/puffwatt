/* PUFFWATT client — renders server-computed values only. No pricing logic lives here. */
const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
const won = (n) => '₩' + Math.round(n || 0).toLocaleString('ko-KR');
const pt = (n) => Math.round(n || 0).toLocaleString('ko-KR') + ' P';
const pct = (bp) => (bp / 100).toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + '%';
const dt = (s) => s ? new Date(s).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '—';
const dtm = (s) => s ? new Date(s).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const st = (s) => `<span class="status s-${esc(s)}">${esc(s)}</span>`;
const TIER_LABEL = { STANDARD: 'Standard', SILVER: 'Silver', GOLD: 'Gold', BLACK: 'Black', ICON: 'Icon' };
let ME = null, ENVINFO = {};

async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const j = await r.json().catch(() => ({ error: 'BAD_JSON' }));
  if (!r.ok) { const e = new Error(j.message || j.error); e.code = j.error; e.status = r.status; throw e; }
  return j;
}
let toastT;
function toast(msg, type = 'ok') { const t = $('#toast'); t.className = `toast show ${type === 'err' ? 'err' : ''}`; t.innerHTML = `<span class="ck">${type === 'err' ? '!' : '✓'}</span><span>${esc(msg)}</span>`; clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3200); }
function openPanel(html) { $('#rpanel').innerHTML = html; $('#rpanel').classList.add('open'); $('#scrim').classList.add('open'); }
function closePanel() { $('#rpanel').classList.remove('open'); $('#scrim').classList.remove('open'); }
$('#scrim').onclick = closePanel;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });
const go = (h) => { location.hash = h; };
function busy(btn, fn) { return async (...a) => { if (btn) { btn.disabled = true; } try { return await fn(...a); } catch (e) { toast(e.message, 'err'); } finally { if (btn) btn.disabled = false; } }; }
function errorView(e) {
  if (e.status === 401) return `<div class="empty"><div class="display h3">로그인이 필요합니다.</div><p>초대 코드 또는 멤버 계정으로 입장하세요.</p><div style="margin-top:16px"><a class="btn primary" href="#/login">입장하기</a></div></div>`;
  if (e.status === 403) return `<div class="empty"><div class="display h3">접근 권한이 없습니다.</div><p>${esc(e.message)}</p><div style="margin-top:16px"><a class="btn" href="#/club">클럽 홈으로</a></div></div>`;
  return `<div class="empty"><div class="display h3">불러오지 못했습니다.</div><p>${esc(e.message)}</p><div style="margin-top:16px"><button class="btn" onclick="route()">다시 시도</button></div></div>`;
}

/* ---------- shells ---------- */
const memberNav = () => [
  ['#/club', 'club', 'CLUB'], ['#/catalog', 'shop', 'SHOP'], ['#/rewards', 'rewards', 'REWARDS'],
  ...(ME?.roles.includes('INFLUENCER') || ME?.roles.includes('SELLER') ? [['#/opportunities', 'opp', '기회']] : [['#/orders', 'orders', '주문']]),
  ['#/profile', 'profile', 'PROFILE']];
const sideNav = () => {
  const base = [['#/club', 'club', 'Club'], ['#/catalog', 'shop', 'Collection'], ['#/orders', 'orders', 'Orders'], ['#/rewards', 'rewards', 'Rewards'], ['#/quests', 'quest', 'Quests'], ['#/achievements', 'badge', 'Achievements']];
  if (ME?.roles.includes('INFLUENCER')) base.push(['#/creator', 'creator', 'Creator']);
  if (ME?.roles.includes('INFLUENCER') || ME?.roles.includes('SELLER')) base.push(['#/opportunities', 'opp', 'Opportunities']);
  if (ME?.sellerStatus === 'APPROVED') base.push(['#/seller', 'seller', 'Seller']);
  if (ME?.isAdmin) base.push(['#/admin', 'admin', 'Admin']);
  base.push(['#/profile', 'profile', 'Profile']);
  return base;
};
function shell(content, { title = '', back = null, nav = 'member' } = {}) {
  document.body.className = nav === 'admin' ? 'theme-admin' : '';
  const cur = location.hash.split('?')[0];
  const items = nav === 'admin' ? window.ADMIN_NAV() : sideNav();
  const side = `<aside class="sidenav"><div class="brand"><div class="wordmark">PUFFWATT</div><div class="xs muted" style="letter-spacing:.2em;margin-top:4px">${nav === 'admin' ? 'OPERATIONS' : 'PRIVATE ACCESS CLUB'}</div></div>
    ${items.map(([h, i, l]) => `<a href="${h}" class="${cur.startsWith(h) && (h !== '#/admin' || cur === '#/admin') ? 'active' : ''}">${I[i]}<span>${l}</span></a>`).join('')}
    <div class="foot">${nav === 'admin' ? `POLICY · ${esc(ENVINFO.policy || '')}<br>${esc(ME?.roles.includes('SUPER_ADMIN') ? 'SUPER ADMIN' : 'ADMIN')}` : 'By invitation only'}</div></aside>`;
  const top = `<header class="topbar"><div class="row">${back ? `<a href="${back}" class="btn ghost sm" aria-label="back" style="padding:0 6px;margin-left:-6px"><span style="width:20px;height:20px;display:block;stroke:currentColor;fill:none;stroke-width:1.5">${I.back}</span></a>` : ''}<span class="wordmark" style="font-size:13px">${nav === 'admin' ? esc(title || 'ADMIN') : (title ? esc(title) : 'PUFFWATT')}</span></div>
    <div class="right">${ME ? `<a href="#/rewards" class="pill">${I.rewards.replace('<svg', '<svg width="13" height="13" style="stroke:currentColor;fill:none;stroke-width:1.4"')} <span id="topbal">…</span></a>` : ''}<a href="#/profile" class="avatar" style="width:34px;height:34px;font-size:13px">${esc((ME?.name || '?').slice(0, 2).toUpperCase())}</a></div></header>`;
  const bottom = nav === 'admin' ? '' : `<nav class="bottomnav">${memberNav().map(([h, i, l]) => `<a href="${h}" class="${cur.startsWith(h) ? 'active' : ''}">${I[i]}<span>${l}</span></a>`).join('')}</nav>`;
  app.innerHTML = `<div class="shell">${side}<div>${top}<main class="main fade">${content}</main></div></div>${bottom}`;
  if (ME) api('/api/rewards').then(r => { const b = $('#topbal'); if (b) b.textContent = pt(r.wallet.available); }).catch(() => {});
}
const loading = () => `<div class="stack"><div class="skeleton" style="height:120px"></div><div class="skeleton" style="height:220px"></div><div class="skeleton" style="height:160px"></div></div>`;

/* ---------- public ---------- */
function landing() {
  document.body.className = '';
  app.innerHTML = `<div class="land fade"><div class="top"><span class="wordmark">PUFFWATT</span><nav><a href="#/login">CLUB</a><a href="#/login">COLLECTION</a><a href="#/login">REWARDS</a><a href="#/login">OPPORTUNITIES</a></nav></div>
  <div class="hero-grid"><div><h1 class="display" style="font-size:clamp(48px,9vw,96px);letter-spacing:.02em">PUFFWATT</h1><div class="rule" style="max-width:360px"><span>✧</span></div>
    <div class="display" style="font-size:clamp(18px,3.2vw,30px);letter-spacing:.22em">PRIVATE ACCESS CLUB</div><div class="eyebrow" style="margin-top:8px">BY INVITATION ONLY</div>
    <p style="margin:26px 0 22px;color:var(--fg-2);max-width:40ch">초대받은 멤버만을 위한 프라이빗 커머스와 기회. 가격, 포인트 한도, 적립, 쿠폰, 접근 권한이 계정마다 다르게 계산됩니다.</p>
    <div class="row wrap"><a class="btn primary" href="#/login">초대 코드로 입장 ${I.arrow}</a><a class="btn" href="#/membership">멤버십 미리보기 ${I.arrow}</a></div></div>
    <div class="facade"><svg viewBox="0 0 640 400" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#A88B5A" stop-opacity=".0"/><stop offset="1" stop-color="#A88B5A" stop-opacity=".35"/></linearGradient></defs>
      <g stroke="#A88B5A" stroke-width="1" fill="none" opacity=".9"><path d="M120 330V120l120-40v250"/><path d="M240 80l160 30v220"/><path d="M400 110l140-30v250"/><path d="M150 140v190M180 130v200M210 120v210M280 130v200M320 140v190M360 150v180M440 120v210M480 110v220"/><path d="M60 330h540"/></g>
      <rect x="240" y="80" width="160" height="250" fill="url(#g1)"/><rect x="120" y="250" width="420" height="80" fill="url(#g1)" opacity=".5"/>
      <text x="470" y="200" font-family="Cormorant Garamond,Georgia,serif" font-size="40" fill="#A88B5A" text-anchor="middle" letter-spacing="-4">P</text><text x="470" y="222" font-family="Cormorant Garamond,Georgia,serif" font-size="9" fill="#A88B5A" text-anchor="middle" letter-spacing="3">PUFFWATT</text>
      <path d="M0 340h640v60H0z" fill="#0A0B0A"/><path d="M120 330l-40 60M540 330l40 60" stroke="#A88B5A" stroke-width=".6" opacity=".5"/></svg></div></div>
  <div class="feats"><div>${I.shop}<h4>PRIVATE COMMERCE</h4><p>엄선된 브랜드와 한정 컬렉션을 가장 먼저.</p></div><div>${I.rewards}<h4>REWARDS &amp; STATUS</h4><p>멤버의 여정에 따라 특별한 리워드와 혜택.</p></div><div>${I.opp}<h4>CURATED OPPORTUNITIES</h4><p>라이프스타일을 확장하는 독점 기회와 경험.</p></div></div>
  <div class="notice">© 2026 PUFFWATT · 데모 환경 · 실결제·본인인증·SNS API는 어댑터 뒤에 있습니다.</div></div>`;
}
async function membershipPreview() {
  document.body.className = '';
  let accounts = [];
  try { accounts = await api('/api/auth/demo-accounts'); } catch {}
  const desc = { standard: ['STANDARD', 'BUYER', '기본 멤버십 혜택과 커뮤니티 접근 권한 제공'], silver: ['SILVER', 'BUYER', '전용 쿠폰 및 실버 등급 전용 이벤트 참여'], gold: ['GOLD CREATOR', 'CREATOR', '크리에이터 전용 수익화 도구 및 우선 노출 혜택'], black: ['BLACK CREATOR', 'CREATOR', '최상위 크리에이터 전용 기능 및 독점 콘텐츠 접근'], icon: ['ICON VIP', 'VIP', 'VIP 전용 라운지 및 1:1 프라이빗 컨시어지 서비스'], seller: ['APPROVED SELLER', 'SELLER', '공식 셀러 인증 및 판매 수수료 우대 혜택'], hybrid: ['HYBRID MEMBER', 'BUYER + CREATOR', '구매와 창작 활동을 모두 지원하는 하이브리드 멤버십'], admin: ['SUPER ADMIN', 'ADMIN', '플랫폼 전체 관리 권한 및 모든 기능 접근 가능'] };
  app.innerHTML = `<div class="main fade"><div class="row between"><a href="#/" class="wordmark">PUFFWATT</a><span class="eyebrow muted">MEMBERSHIP PREVIEW</span></div>
  <div class="hero" style="text-align:center"><h1 class="display h2">Eight memberships. Eight different terms.</h1><div class="rule" style="max-width:320px;margin:14px auto"><span>✧</span></div><p class="muted">계정별로 가격, 포인트, 적립, 쿠폰, 접근 권한이 모두 다르게 설정됩니다.</p></div>
  <div class="grid g4 m2">${accounts.map(a => { const k = a.email.split('@')[0]; const d = desc[k] || [a.name, '', '']; return `<div class="panel col" style="text-align:center;gap:10px;align-items:center">
    <div class="display h3" style="letter-spacing:.08em">${d[0]}</div><span class="pill gray">${d[1]}</span>
    <div class="kv" style="width:100%"><span class="k xs">TIER</span><span class="v sm">${esc(a.tierCode)}</span></div><div class="kv" style="width:100%;border-top:var(--line)"><span class="k xs">POINT BALANCE</span><span class="v" style="font-size:18px">${k === 'admin' ? '∞' : pt(a.wallet)}</span></div>
    <p class="small muted" style="min-height:40px">${d[2]}</p><button class="btn block" data-demo="${esc(a.email)}">이 멤버십으로 입장 ${I.arrow}</button></div>`; }).join('') || `<div class="empty">데모 로그인이 비활성화된 환경입니다.</div>`}</div>
  <div class="notice">${I.profile.replace('<svg', '<svg width="12" height="12" style="display:inline;stroke:currentColor;fill:none"')} ROLE · MEMBERSHIP · CREATOR TIER는 독립된 축입니다.</div></div>`;
  app.querySelectorAll('[data-demo]').forEach(b => b.onclick = busy(b, async () => { await api('/api/auth/demo-login', { email: b.dataset.demo }); await loadMe(); go(ME.isAdmin ? '#/admin' : '#/club'); }));
}
async function login() {
  document.body.className = '';
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  let tab = params.get('tab') || 'invite';
  const render = () => {
    app.innerHTML = `<div class="main fade" style="max-width:560px"><div style="text-align:center;padding-top:18px"><a href="#/" class="wordmark" style="font-size:18px">PUFFWATT</a><div class="eyebrow muted" style="margin-top:6px">PRIVATE ACCESS CLUB</div><div class="rule" style="max-width:280px;margin:18px auto"><span>✧</span></div>
      <h1 class="display h1">Your invitation<br>is the key.</h1><p class="muted" style="margin-top:10px">초대 코드를 확인하고 멤버십을 시작하세요.</p></div>
      <div class="tabs" style="margin-top:22px"><button class="${tab === 'invite' ? 'active' : ''}" data-t="invite" style="flex:1">초대 가입</button><button class="${tab === 'login' ? 'active' : ''}" data-t="login" style="flex:1">멤버 로그인</button></div>
      <div id="alert"></div>
      <form id="f" class="stack login-card">${tab === 'invite' ? `
        <div class="field"><label>Invitation code</label><div class="row"><input class="input" name="code" placeholder="PUFF-XXXX-XX" value="${esc(params.get('invite') || '')}" autocapitalize="characters" required><button type="button" class="btn sm" id="chk">확인</button></div></div>
        <div class="field"><label>Name</label><input class="input" name="name" placeholder="표시 이름"></div>
        <div class="field"><label>Email</label><input class="input" name="email" type="email" placeholder="이메일 주소를 입력하세요." required></div>
        <div class="field"><label>Password</label><input class="input" name="password" type="password" placeholder="8자 이상" minlength="8" required></div>
        <button class="btn primary block">멤버십 시작하기 ${I.arrow}</button>` : `
        <div class="field"><label>Email</label><input class="input" name="email" type="email" placeholder="이메일" required></div>
        <div class="field"><label>Password</label><input class="input" name="password" type="password" placeholder="비밀번호" required></div>
        <button class="btn primary block">로그인 ${I.arrow}</button>`}
        ${ENVINFO.demoEnabled ? `<a class="btn block" href="#/membership">데모 멤버십으로 둘러보기 ${I.arrow}</a><p class="xs muted" style="text-align:center">데모 계정 비밀번호 <code>Puffwatt!2026</code> · 초대 코드 <code>PUFF-GOLD-26</code> / <code>PUFF-OPEN-26</code></p>` : ''}
      </form></div>`;
    app.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; render(); });
    const f = $('#f');
    const chk = $('#chk'); if (chk) chk.onclick = busy(chk, async () => { const inv = await api('/api/auth/invitation/' + encodeURIComponent(f.code.value.trim())); $('#alert').innerHTML = `<div class="alert ok" style="margin-bottom:14px"><span class="check">✓</span><div><b>초대 코드가 확인되었습니다.</b><div class="small muted">${inv.inviter ? `초대자 ${esc(inv.inviter)} · ` : ''}가입 등급 ${inv.tierCode} · 남은 사용 ${inv.remaining}</div></div></div>`; });
    f.onsubmit = (e) => { e.preventDefault(); busy(f.querySelector('.primary'), async () => { const d = Object.fromEntries(new FormData(f)); await api(tab === 'invite' ? '/api/auth/signup' : '/api/auth/login', d); await loadMe(); toast(tab === 'invite' ? '멤버십이 시작되었습니다.' : '로그인했습니다.'); go(ME.isAdmin ? '#/admin' : '#/club'); })(); };
  };
  render();
}

/* ---------- member views ---------- */
async function club() {
  shell(loading()); const d = await api('/api/club'); const u = d.user;
  const hour = new Date().getHours(); const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const xpPct = d.xpGoal ? Math.min(100, Math.round(d.wallet.xp / d.xpGoal * 100)) : 100;
  shell(`<div class="hero"><h1 class="display h1">${greet},<br>${esc(u.name)}님.</h1><div class="eyebrow" style="margin-top:10px">${TIER_LABEL[u.tierCode]?.toUpperCase()} MEMBER${u.creatorTier ? ' · CREATOR ' + esc(u.creatorTier) : ''}${u.sellerStatus === 'APPROVED' ? ' · APPROVED SELLER' : ''}${u.tierOverride ? ` · <span class="muted">수동 지정 (${dt(u.tierOverride.endsAt)}까지)</span>` : ''}</div></div>
  ${d.notifications.length ? `<div class="alert ok" style="margin-bottom:14px"><span class="check">✓</span><div style="flex:1"><b>${esc(d.notifications[0].title)}</b><div class="small muted">${esc(d.notifications[0].body || '')}</div></div><button class="btn ghost sm" id="rd">닫기</button></div>` : ''}
  <div class="panel brass"><div class="grid g2"><div><div class="eyebrow muted">사용 가능</div><div class="num" style="font-size:40px;line-height:1.1;margin-top:4px">${pt(d.wallet.available)}</div></div><div style="border-left:var(--line);padding-left:16px"><div class="eyebrow muted">최근 30일 적립</div><div class="num brass" style="font-size:30px;line-height:1.2;margin-top:6px">+${pt(d.monthEarn)}</div><div class="xs muted">대기 ${pt(d.wallet.pending)}</div></div></div>
    <div class="row between" style="margin-top:18px;font-size:13px"><span>${d.nextTier ? `다음 등급까지 <b class="num">${(Math.max(0, d.xpGoal - d.wallet.xp)).toLocaleString()} XP</b>` : '최고 등급'}</span><span class="eyebrow">${d.nextTier || u.tierCode}</span></div><div class="progress" style="margin-top:8px"><i style="width:${xpPct}%"></i></div></div>
  <div class="panel" style="padding:0;overflow:hidden;margin-top:14px"><div class="grid" style="grid-template-columns:1fr;gap:0">${plate('retreat', 'wide', 'SOLACE RESIDENCES')}<div style="padding:18px"><div class="eyebrow">FEATURED COLLECTION</div><div class="display h3" style="margin:6px 0">SOLACE RESIDENCES</div><p class="small muted">도심 속 고요한 안식처, 삶의 균형을 찾아주는 컬렉션.</p><a class="btn" style="margin-top:12px" href="#/product/${d.featured?.slug || ''}">내 조건으로 보기 ${I.arrow}</a></div></div></div>
  <div class="grid g4 m2" style="margin-top:14px">${[['진행 중 주문', d.ordersInProgress, '#/orders', 'orders'], ['예약', d.bookings, '#/orders', 'quest'], ['초대받은 기회', d.invitedOpportunities, '#/opportunities', 'opp'], ['추천 네트워크', `L1 ${d.l1} · L2 ${d.l2}`, '#/rewards', 'members']].map(([l, n, h, i]) => `<a href="${h}" class="stat" style="text-align:center"><span style="display:block;width:22px;height:22px;margin:0 auto 8px;stroke:var(--brass);fill:none;stroke-width:1.3">${I[i]}</span><div class="l">${l}</div><div class="n" style="font-size:26px">${n}</div></a>`).join('')}</div>
  <a href="#/achievements" class="panel row" style="margin-top:14px;gap:16px;display:flex">${shield('sun')}<div style="flex:1"><div class="eyebrow">대표 칭호</div><div class="display h3" style="letter-spacing:.1em">${esc(d.featuredTitle?.name || '—')}</div><div class="small muted">${esc(d.featuredTitle?.description || '')}</div></div>${I.arrow}</a>`);
  const rd = $('#rd'); if (rd) rd.onclick = busy(rd, async () => { await api('/api/notifications/read', {}); club(); });
}
async function catalog() {
  shell(loading(), { title: 'COLLECTION' });
  const params = new URLSearchParams(location.hash.split('?')[1] || ''); let type = params.get('type') || ''; let search = '';
  const d = await api('/api/catalog');
  const render = () => {
    const items = d.items.filter(i => (!type || (type === 'ACCESS' ? !i.locked : i.itemType === type)) && (!search || (i.name + i.brandName + i.category).toLowerCase().includes(search.toLowerCase())));
    shell(`<div class="hero"><h1 class="display h2">The collection,<br>calculated for you.</h1><p class="sub">회원님의 등급·역할·활성 정책(${esc(d.policyVersion)})으로 계산한 가격과 한도입니다.</p></div>
    <div class="row between wrap" style="gap:10px"><div class="tabs" style="margin:0;border:0;flex:1">${[['', '전체'], ['PRODUCT', '상품'], ['SERVICE', '예약 서비스'], ['ACCESS', '접근 가능']].map(([v, l]) => `<button class="${type === v ? 'active' : ''}" data-type="${v}">${l}</button>`).join('')}</div><input class="input" id="q" placeholder="컬렉션 검색" value="${esc(search)}" style="max-width:220px;min-height:40px"></div>
    <div class="grid g4 m2" style="margin-top:14px">${items.map(i => `<a href="${i.locked ? '#' : '#/product/' + i.slug}" class="card ${i.locked ? 'locked' : ''}">${plate(i.imageKey, i.locked ? 'locked' : '', i.brandName)}${i.locked ? `<div style="position:absolute"></div>` : ''}
      <div class="body"><div class="eyebrow muted">${esc(i.category)}</div><div style="font-weight:500">${esc(i.name)}</div>
      ${i.locked ? `<div class="muted small" style="margin-top:4px">현재 등급에서는 열리지 않습니다.</div><span class="pill gray" style="margin-top:auto">${esc(i.lockReason)}</span>` :
        `<div class="price">${i.priceFixed ? '' : `<span class="base">${won(i.basePrice)}</span>`}<span class="now">${won(i.displayPrice)}</span></div>
        <div class="rates"><div>포인트 최대<b>${pct(i.maxPointRate)}</b></div><div>현금 적립<b>${pct(i.cashEarnRate)}</b></div></div>
        <span class="pill" style="margin-top:auto;justify-content:center">${i.priceFixed ? 'BRAND PRICE FIXED' : i.itemType === 'SERVICE' ? 'RESERVE' : 'MEMBER PRICE'}</span>`}</div></a>`).join('') || '<div class="empty" style="grid-column:1/-1"><div class="display h3">조건에 맞는 항목이 없습니다.</div></div>'}</div>
    <div class="notice">상품 및 서비스는 제휴사 사정에 따라 변경될 수 있습니다. 모든 가격은 서버 정책으로 계산됩니다.</div>`, { title: 'COLLECTION' });
    app.querySelectorAll('[data-type]').forEach(b => b.onclick = () => { type = b.dataset.type; render(); });
    const q = $('#q'); q.oninput = () => { search = q.value; const v = q.value; render(); $('#q').focus(); $('#q').setSelectionRange(v.length, v.length); };
  };
  render();
}
async function product(id) {
  shell(loading(), { back: '#/catalog', title: 'PRODUCT' });
  let reqPoint = null;
  let d;
  try { d = await api(`/api/product/${id}`); } catch (e) { return shell(errorView(e), { back: '#/catalog' }); }
  const render = async () => {
    const p = d.product, c = d.calc;
    shell(`<div class="grid g2 m1" style="gap:24px"><div>${plate(p.imageKey, 'tall', p.brandName)}</div><div>
      <div class="eyebrow">${esc(p.brandName)}</div><div class="rule" style="max-width:120px;margin:8px 0"><span>✧</span></div><h1 class="display h1">${esc(p.name)}</h1>
      <p class="muted small" style="margin-top:8px">${esc(p.description || '')}${p.itemType === 'SERVICE' ? ` · ${p.durationMinutes}분${p.capacity ? ` · 정원 ${p.capacity}` : ''}` : ''}</p>
      <div style="margin-top:18px">${c.unitPrice !== c.basePrice ? `<div class="base muted" style="text-decoration:line-through">${won(c.basePrice)}</div>` : ''}<div class="eyebrow muted">${p.pricePolicy === 'FIXED' || !p.memberPriceAllowed ? 'BRAND PRICE FIXED' : '회원가'}</div><div class="num brass" style="font-size:44px;line-height:1">${won(c.unitPrice)}</div></div>
      <div class="panel" style="margin-top:18px"><div class="eyebrow">YOUR TERMS</div>
        <div class="kv"><span class="k">최대 포인트 사용</span><span class="v">${pct(c.maxPointRate)}</span></div><div class="kv"><span class="k">현금 결제 적립</span><span class="v">${pct(c.cashEarnRate)}</span></div>
        ${d.coupon ? `<div class="kv"><span class="k">쿠폰 <span class="pill">${esc(d.coupon.code)}</span></span><span class="v">${d.coupon.discountType === 'PERCENT' ? pct(d.coupon.value) : won(d.coupon.value)}</span></div>` : ''}
        ${d.voucher ? `<div class="kv"><span class="k">바우처</span><span class="v">${won(d.voucher.value)}</span></div>` : ''}
        <div class="snap" style="margin-top:12px">${esc(c.snapshot)} · ${p.maxPointRate || d.product.brandMaxPointRate ? 'BRAND/PRODUCT CAP APPLIED' : 'TIER CAP'}</div>
        <div class="grid g2" style="margin-top:14px;text-align:center"><div><div class="eyebrow muted">포인트 최대</div><div class="num brass" style="font-size:30px">${pt(c.maxPointAmount)}</div></div><div style="border-left:var(--line)"><div class="eyebrow muted">현금 최소</div><div class="num brass" style="font-size:30px">${won(c.payable - c.maxPointAmount)}</div></div></div>
        <details style="margin-top:8px"><summary class="xs muted">계산 근거 보기 ${I.arrow}</summary><div class="trace">${c.trace.map(esc).join('<br>')}</div></details></div>
      ${d.quest ? `<div class="panel brass row" style="margin-top:14px;gap:14px"><div class="check" style="width:40px;height:40px">✧</div><div style="flex:1"><div class="eyebrow">CONNECTED QUEST</div><div style="font-size:13.5px;margin-top:4px">${esc(d.quest.code.split('-')[0])} · 이 상품 구매 후 리뷰 제출</div><div class="xs muted">남은 인원 <b class="brass">${d.quest.remaining ?? '∞'}</b></div></div><div style="text-align:right;border-left:var(--line);padding-left:14px"><div class="eyebrow muted">REWARD</div><div class="num brass" style="font-size:24px">+${pt(d.quest.rewardAmount)}</div></div></div>` : ''}
      <div class="row" style="margin-top:14px;gap:10px"><div class="row" style="border:var(--line);border-radius:var(--r);padding:0 6px;min-height:44px"><span class="small muted" style="padding:0 6px">수량</span><button class="btn ghost sm" id="qm">−</button><b class="num" id="qv">${c.quantity}</b><button class="btn ghost sm" id="qp">+</button></div><button class="btn primary" id="add" style="flex:1">${p.itemType === 'SERVICE' ? '예약 담기' : '장바구니에 담기'} ${I.shop.replace('<svg', '<svg width="16" height="16" style="stroke:currentColor;fill:none;stroke-width:1.4"')}</button></div>
      <p class="xs muted" style="margin-top:12px">${I.policy.replace('<svg', '<svg width="12" height="12" style="display:inline;vertical-align:-2px;stroke:currentColor;fill:none"')} 결제 직전 서버 정책으로 다시 계산됩니다.</p></div></div>`, { back: '#/catalog', title: 'PRODUCT' });
    let qty = c.quantity;
    const reload = async () => { d = await api(`/api/product/${id}?qty=${qty}`); render(); };
    $('#qm').onclick = () => { if (qty > 1) { qty--; reload(); } }; $('#qp').onclick = () => { if (qty < 10) { qty++; reload(); } };
    $('#add').onclick = busy($('#add'), async () => { await api('/api/cart/add', { productId: p.id, quantity: qty }); toast('장바구니에 담았습니다.'); go('#/cart'); });
  };
  render();
}
async function cart() {
  shell(loading(), { back: '#/catalog', title: 'CHECKOUT' });
  let point = null, useCoupon = true, useVoucher = true;
  const load = () => api(`/api/cart?${point != null ? 'point=' + point : ''}${!useCoupon ? '&coupon=none' : ''}${!useVoucher ? '&voucher=none' : ''}`);
  let d = await load();
  const render = () => {
    const t = d.totals;
    if (!d.lines.length) return shell(`<div class="empty"><div class="display h3">장바구니가 비어 있습니다.</div><p>컬렉션에서 회원님의 조건으로 계산된 상품을 담아보세요.</p><div style="margin-top:16px"><a class="btn primary" href="#/catalog">컬렉션 보기</a></div></div>`, { back: '#/catalog', title: 'CHECKOUT' });
    shell(`<div class="eyebrow" style="text-align:center">CHECKOUT / POLICY CALCULATION</div>
    <div class="panel" style="margin-top:14px"><div class="row between"><span class="eyebrow muted">01 장바구니</span><span class="small muted">${d.lines.length}개 상품</span></div>
      ${d.lines.map(l => `<div class="row" style="margin-top:12px;gap:12px"><div style="width:64px;flex:none">${plate(l.imageKey)}</div><div style="flex:1"><div>${esc(l.name)}</div><div class="xs muted">수량 ${l.quantity} · ${won(l.calc.unitPrice)}${l.calc.unitPrice !== l.calc.basePrice ? ` <s>${won(l.calc.basePrice)}</s>` : ''}</div></div><div class="num" style="font-size:18px">${won(l.calc.displayPrice)}</div><button class="btn ghost sm" data-rm="${l.cartItemId}" aria-label="remove">✕</button></div>`).join('')}</div>
    <div class="panel"><div class="eyebrow muted">02 혜택 요약</div><div class="grid g3" style="text-align:center;margin-top:10px"><div><div class="xs muted">멤버 가격</div><div class="num" style="font-size:20px">${won(t.displayPrice)}</div></div><div style="border-left:var(--line)"><div class="xs muted">쿠폰 할인</div><div class="num" style="font-size:20px">−${won(t.couponDiscount)}</div></div><div style="border-left:var(--line)"><div class="xs muted">바우처 할인</div><div class="num" style="font-size:20px">−${won(t.voucherDiscount)}</div></div></div>
      <div class="row wrap" style="margin-top:12px;gap:8px">${d.entitlements.coupons[0] ? `<button class="chip ${useCoupon ? 'on' : ''}" id="tc">쿠폰 ${esc(d.entitlements.coupons[0].code)} ${useCoupon ? '적용됨' : '미적용'}</button>` : '<span class="chip">사용 가능한 쿠폰 없음</span>'}${d.entitlements.vouchers[0] ? `<button class="chip ${useVoucher ? 'on' : ''}" id="tv">바우처 ${won(d.entitlements.vouchers[0].value)} ${useVoucher ? '적용됨' : '미적용'}</button>` : ''}</div></div>
    <div class="panel brass"><div class="eyebrow muted">03 분할 결제</div><div class="grid g3" style="text-align:center;margin-top:10px"><div><div class="xs muted">포인트 사용</div><div class="num brass" style="font-size:26px">${pt(t.pointUsed)}</div></div><div style="border-left:var(--line)"><div class="xs muted">현금 결제</div><div class="num" style="font-size:26px">${won(t.cashPaid)}</div></div><div style="border-left:var(--line)"><div class="xs muted">사용 한도</div><div class="num brass" style="font-size:26px">${pt(t.maxPointAmount)}</div></div></div>
      <input type="range" class="slider" id="sl" min="0" max="${Math.min(t.maxPointAmount, d.wallet.available)}" step="100" value="${t.pointUsed}" aria-label="포인트 사용"><div class="row between xs muted"><span>0 P</span><span>${pt(Math.min(t.maxPointAmount, d.wallet.available))}</span></div>
      <div class="row" style="margin-top:12px;gap:14px;border-top:var(--line);padding-top:12px"><div><div class="xs muted">보유 포인트</div><div class="num" style="font-size:20px">${pt(d.wallet.available)}</div></div>${d.wallet.available < t.maxPointAmount ? `<div class="small brass" style="border-left:var(--line);padding-left:14px">보유 포인트가 한도보다 적어 사용 가능한 만큼만 적용됩니다.</div>` : ''}</div></div>
    <div class="panel"><div class="kv"><span class="k"><span class="eyebrow muted">04</span> 적립 예정</span><span class="v sm">구매확정 후 <b class="num brass" style="font-size:20px">+${pt(t.expectedEarn)}</b> 예정</span></div>
      <div class="kv"><span class="k"><span class="eyebrow muted">05</span> 주문 스냅샷</span><span class="snap lock">${esc(d.snapshot)}</span></div>
      <label class="kv" style="cursor:pointer"><span class="k"><span class="eyebrow muted">06</span> 이용 동의</span><input type="checkbox" id="agree" style="width:20px;height:20px;accent-color:var(--brass)"></label></div>
    <button class="btn primary block" id="pay" style="margin-top:14px;min-height:52px;font-size:15px">데모 결제 완료하기 · ${won(t.cashPaid)}</button>
    <p class="xs muted" style="text-align:center;margin-top:10px">실결제 PG는 연동되어 있지 않습니다. 서버가 현금·포인트 분할과 정책 스냅샷을 검증한 뒤 주문을 생성합니다.</p>`, { back: '#/catalog', title: 'CHECKOUT' });
    const sl = $('#sl'); let tmr; sl.oninput = () => { clearTimeout(tmr); tmr = setTimeout(async () => { point = Number(sl.value); d = await load(); render(); }, 250); };
    app.querySelectorAll('[data-rm]').forEach(b => b.onclick = busy(b, async () => { await api('/api/cart/remove', { cartItemId: Number(b.dataset.rm) }); d = await load(); render(); }));
    const tc = $('#tc'); if (tc) tc.onclick = async () => { useCoupon = !useCoupon; d = await load(); render(); };
    const tv = $('#tv'); if (tv) tv.onclick = async () => { useVoucher = !useVoucher; d = await load(); render(); };
    $('#pay').onclick = busy($('#pay'), async () => { if (!$('#agree').checked) throw new Error('정책 계산 및 결제 조건에 동의해 주세요.'); const o = await api('/api/checkout', { requestedPoint: point, useCoupon, useVoucher }); toast(`정책 스냅샷이 저장되었습니다. ${o.orderNo}`); go('#/orders/' + o.id); });
  };
  render();
}
async function orders(id) {
  shell(loading(), { title: 'ORDERS' });
  const d = await api('/api/orders');
  const one = (o, open) => `<div class="panel" style="padding:0;overflow:hidden"><div class="row between" style="padding:14px 16px;gap:10px"><div><div class="xs muted">주문번호 <b class="w">${esc(o.orderNo)}</b></div><div class="xs muted">${dtm(o.createdAt)} · ${esc(o.policyVersion)}</div></div>${st(o.status)}</div>
    ${o.items.map(i => `<div class="row" style="padding:10px 16px;border-top:var(--line);gap:12px"><div style="width:56px;flex:none">${plate(i.imageKey)}</div><div style="flex:1"><div>${esc(i.nameSnapshot)}</div><div class="xs muted">${i.quantity}개${i.returnedQuantity ? ` · 반품 ${i.returnedQuantity}` : ''} · 현금 ${won(i.cashAllocated)} · 포인트 ${pt(i.pointAllocated)}</div></div>${(['PAID', 'CONFIRMED', 'PARTIALLY_RETURNED'].includes(o.status) && i.returnedQuantity < i.quantity) ? `<button class="btn sm" data-ret="${o.id}:${i.id}">부분 반품</button>` : ''}</div>`).join('')}
    <div style="padding:12px 16px;border-top:var(--line)" class="grid g3"><div><div class="xs muted">현금 결제</div><div class="num">${won(o.cashPaid)}</div></div><div><div class="xs muted">포인트 사용</div><div class="num">${pt(o.pointUsed)}</div></div><div><div class="xs muted">${o.status === 'CONFIRMED' || o.status === 'PARTIALLY_RETURNED' ? '적립 확정' : '적립 대기'}</div><div class="num brass">+${pt(o.earnedPointPending)}</div></div></div>
    ${open ? `<div style="padding:12px 16px;border-top:var(--line)"><div class="eyebrow muted">정책 및 안내 (해당 주문 기준)</div><div class="kv"><span class="k small">구매 확정 기한</span><span class="v sm">${dt(o.confirmDeadline)} 23:59</span></div><div class="kv"><span class="k small">정책 스냅샷</span><span class="snap lock">${esc(o.snapshot.lines?.[0]?.calc?.snapshot || o.policyVersion)}</span></div>${o.refunds?.length ? o.refunds.map(r => `<div class="kv"><span class="k small">${r.type === 'FULL' ? '전체 취소' : '부분 반품'} · ${dtm(r.processedAt)}</span><span class="v sm">현금 ${won(r.cashAmount)} · 포인트 복원 ${pt(r.pointAmount)}</span></div>`).join('') : ''}
      <div class="steps" style="margin-top:10px">${['주문 접수', '결제 완료', o.status === 'CANCELLED' ? '취소 완료' : '구매 확정', '적립 확정'].map((s, i) => { const n = o.status === 'CANCELLED' ? 2 : ['PAID'].includes(o.status) ? 1 : 3; return `<div class="st ${i < n ? 'done' : i === n ? 'cur' : ''}"><i>${i < n ? '✓' : i + 1}</i>${s}</div>${i < 3 ? '<span class="ar">→</span>' : ''}`; }).join('')}</div>
      <div class="row wrap" style="margin-top:12px;gap:8px">${o.status === 'PAID' ? `<button class="btn primary" data-cf="${o.id}">구매 확정</button>` : ''}${['PAID', 'CONFIRMED'].includes(o.status) ? `<button class="btn danger" data-cx="${o.id}">전체 취소</button>` : ''}</div></div>` : `<a href="#/orders/${o.id}" class="btn ghost block sm" style="border-top:var(--line);border-radius:0">상세 보기 ${I.arrow}</a>`}</div>`;
  shell(`<div class="hero"><h1 class="display h2">Orders, reservations,<br>and what comes next.</h1></div>
    <div class="stack">${d.orders.length ? d.orders.map(o => one(o, String(o.id) === String(id) || (!id && o === d.orders[0]))).join('') : `<div class="empty"><div class="display h3">아직 주문이 없습니다.</div><p>첫 구매를 완료하면 FIRST PURCHASE 엠블럼이 열립니다.</p><div style="margin-top:16px"><a class="btn primary" href="#/catalog">컬렉션 보기</a></div></div>`}</div>`, { title: 'ORDERS' });
  app.querySelectorAll('[data-cf]').forEach(b => b.onclick = busy(b, async () => { const r = await api(`/api/orders/${b.dataset.cf}/confirm`, {}); toast(`구매 확정 · 적립이 AVAILABLE로 전환되었습니다.${r.achievements.granted.length ? ' 엠블럼 획득: ' + r.achievements.granted.join(', ') : ''}`); orders(b.dataset.cf); }));
  app.querySelectorAll('[data-cx]').forEach(b => b.onclick = busy(b, async () => { if (!confirm('전체 취소하시겠습니까? 본인 적립·추천 보상·XP가 비례 회수되고 사용 포인트는 복원됩니다.')) return; await api(`/api/orders/${b.dataset.cx}/cancel`, { reason: '단순 변심' }); toast('전체 취소와 포인트 복원이 완료되었습니다.'); orders(b.dataset.cx); }));
  app.querySelectorAll('[data-ret]').forEach(b => b.onclick = busy(b, async () => { const [oid, iid] = b.dataset.ret.split(':'); const r = await api(`/api/orders/${oid}/return`, { orderItemId: Number(iid), quantity: 1 }); toast(`부분 반품 · 현금 ${won(r.refund.cashBack)} · 포인트 비례 복원 ${pt(r.refund.pointBack)} (${pct(r.refund.ratioBp)})`); orders(oid); }));
}
async function rewards() {
  shell(loading(), { title: 'REWARDS / LEDGER' });
  const d = await api('/api/rewards');
  const xpPct = d.xpGoal ? Math.min(100, Math.round(d.wallet.xp / d.xpGoal * 100)) : 100;
  shell(`<div class="hero"><h1 class="display h2" style="letter-spacing:.06em">REWARDS / LEDGER</h1></div>
  <div class="panel brass"><div class="eyebrow muted">사용 가능 포인트</div><div class="num" style="font-size:52px;line-height:1.05;margin:6px 0 12px">${pt(d.wallet.available)}</div><div class="grid g3" style="border-top:var(--line);padding-top:12px"><div><div class="xs muted">사용 가능</div><div class="num" style="font-size:20px">${d.wallet.available.toLocaleString()}</div></div><div style="border-left:var(--line);padding-left:12px"><div class="xs muted">대기</div><div class="num" style="font-size:20px">${d.wallet.pending.toLocaleString()}</div></div><div style="border-left:var(--line);padding-left:12px"><div class="xs muted">30일 내 소멸</div><div class="num" style="font-size:20px">${d.wallet.expiringSoon.toLocaleString()}</div></div></div></div>
  <div class="panel"><div class="row between"><span class="eyebrow">${ME.tierCode}</span><span class="eyebrow muted">${d.nextTier || 'TOP'}</span></div><div class="progress" style="margin:10px 0"><i style="width:${xpPct}%"></i></div><div class="row between num small"><span>${d.wallet.xp.toLocaleString()} XP</span><span class="muted">${d.xpGoal ? d.xpGoal.toLocaleString() + ' XP' : '—'}</span></div></div>
  <div class="panel"><div class="row between wrap"><div class="display h3">Invitation, with lineage.</div><span class="pill ${d.flags.ENABLE_L2_SPENDABLE_REWARD ? 'solid' : 'gray'}">L2 소비 가능 보상 · ${d.flags.ENABLE_L2_SPENDABLE_REWARD ? 'ON' : 'OFF'}</span></div>
    <div class="grid g2" style="margin-top:14px;align-items:end"><div class="field"><label>초대 코드</label><div class="row"><input class="input num" readonly value="${esc(d.referralCode)}" style="letter-spacing:.18em;font-size:17px"><button class="btn primary sm" id="cp">복사</button></div></div><div class="grid g2" style="text-align:center"><div><div class="xs muted">L1</div><div class="num" style="font-size:30px">${d.l1}<span class="small muted">명</span></div></div><div style="border-left:var(--line)"><div class="xs muted">L2</div><div class="num" style="font-size:30px">${d.l2}<span class="small muted">명</span></div></div></div></div>
    ${d.upline ? `<div class="xs muted" style="margin-top:10px">추천인 · ${esc(d.upline.name.slice(0, 1))}○${esc(d.upline.name.slice(-1))} (${esc(d.upline.memberCode.replace(/\d{3}$/, '***'))})</div>` : ''}
    <div class="tscroll"><table class="table" style="margin-top:10px"><thead><tr><th>레벨</th><th>초대 멤버</th><th>기준</th><th style="text-align:right">적립 포인트</th></tr></thead><tbody>${d.contributions.map(c => `<tr><td><span class="pill ${c.level === 1 ? '' : 'gray'}">L${c.level}</span></td><td>${esc(c.maskedName)} <span class="xs muted">${esc(c.memberCode)}</span></td><td class="muted small">현금 순매출 기준</td><td class="num brass" style="text-align:right">+ ${pt(c.earned)}${c.pending ? `<div class="xs muted">대기 ${pt(c.pending)}</div>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="muted small" style="text-align:center;padding:20px">아직 초대한 멤버가 없습니다. 코드를 공유해 보세요.</td></tr>'}</tbody></table></div></div>
  <div class="panel" style="padding:0"><div class="tscroll"><table class="table"><thead><tr><th>날짜</th><th>구분</th><th>내용</th><th style="text-align:right">포인트</th><th>상태</th></tr></thead><tbody>${d.ledger.map(l => `<tr><td class="xs muted">${dt(l.createdAt)}</td><td class="small">${{ EARN: '적립', USE: '사용', REFERRAL: '추천', CREDIT: '베네핏', RESTORE: '복원', REVOKE: '회수', EXPIRE: '소멸', ADJUST: '조정' }[l.entryType] || l.entryType}</td><td class="small">${esc(l.reason || l.sourceType)}${l.expiresAt && l.status === 'AVAILABLE' ? `<div class="xs muted">만료 ${dt(l.expiresAt)}${l.remainingAmount !== l.amount ? ` · 잔여 ${pt(l.remainingAmount)}` : ''}</div>` : ''}</td><td class="num" style="text-align:right;${l.amount > 0 ? 'color:var(--brass-2)' : ''}">${l.amount > 0 ? '+' : ''}${l.amount.toLocaleString()} P</td><td>${st(l.status)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted small" style="text-align:center;padding:20px">원장 내역이 없습니다.</td></tr>'}</tbody></table></div></div>
  <div class="grid g2"><a href="#/quests" class="btn" style="justify-content:space-between">${I.quest.replace('<svg', '<svg width="18" height="18" style="stroke:currentColor;fill:none;stroke-width:1.3"')} 퀘스트 ${I.arrow}</a><a href="#/achievements" class="btn" style="justify-content:space-between">${I.badge.replace('<svg', '<svg width="18" height="18" style="stroke:currentColor;fill:none;stroke-width:1.3"')} 업적과 칭호 ${I.arrow}</a></div>`, { title: 'REWARDS' });
  $('#cp').onclick = async () => { const link = `${location.origin}/#/login?invite=${d.referralCode}`; try { await navigator.clipboard.writeText(link); } catch {} toast('초대 링크를 복사했습니다.'); };
}
async function quests() {
  shell(loading(), { title: 'QUESTS' });
  const d = await api('/api/quests');
  shell(`<div class="hero" style="text-align:center"><h1 class="display h1">Quest editions.</h1><div class="rule" style="max-width:280px;margin:12px auto"><span>✧</span></div><p class="muted">구매 · 추천 · 크리에이터 활동으로 제한된 보상을 획득하세요.</p></div>
  <div class="stack">${d.quests.map(qu => { const done = qu.mine?.status === 'COMPLETED'; const needUrl = qu.conditions.some(c => c.type === 'EVIDENCE_URL'); return `<div class="panel ${qu.eligible.ok ? '' : 'locked'}"><div class="grid g2 m1" style="gap:18px"><div>
      <div class="row between"><span class="eyebrow">${{ FIRST_COME: `FIRST ${qu.capacity}`, CONDITIONAL: 'CONDITIONAL', CREATOR: 'CREATOR' }[qu.type] || qu.type}</span>${qu.type === 'FIRST_COME' ? `<span class="pill">${qu.remaining > 0 ? '선착순 진행 중' : '마감'}</span>` : ''}</div>
      <div class="display h3" style="margin:8px 0">${esc(qu.name)}</div>${qu.product ? plate(qu.product.imageKey, 'wide', qu.product.name) : ''}
      ${qu.capacity ? `<div class="row between small" style="margin-top:10px"><span class="muted">진행 현황</span><span class="num" style="font-size:20px">${qu.completedCount} <span class="muted">/ ${qu.capacity}</span></span></div><div class="progress"><i style="width:${qu.completedCount / qu.capacity * 100}%"></i></div>` : ''}
      ${qu.progress ? `<div class="row between small" style="margin-top:10px"><span class="muted">진행 현황</span><span class="num">${won(qu.progress.current)} <span class="muted">/ ${won(qu.progress.target)}</span></span></div><div class="progress"><i style="width:${Math.min(100, qu.progress.current / qu.progress.target * 100)}%"></i></div>` : ''}
      <div style="margin-top:12px"><div class="xs muted">보상</div><div class="num brass" style="font-size:24px">${qu.rewardType === 'POINT' ? '+ ' + pt(qu.rewardAmount) : qu.rewardType === 'VOUCHER' ? '₩30,000 VOUCHER' : 'EXCLUSIVE BADGE'}</div></div></div>
      <div style="border-left:var(--line);padding-left:18px" class="col"><div class="xs muted">참여 자격</div><div class="small">${qu.eligible.ok ? 'PUFFWATT 멤버 누구나' : `<span class="brass">${{ ROLE: '크리에이터 역할 필요', TIER: '등급 미충족', FULL: '정원 마감', ENDED: '종료', NOT_STARTED: '시작 전' }[qu.eligible.reason]}</span>`}${qu.type === 'CREATOR' ? ' (INFLUENCER)' : ''}</div>
        <div class="xs muted" style="margin-top:8px">참여 조건</div><p class="small muted">${esc(qu.description)}</p>
        <div class="col small" style="gap:4px">${qu.conditions.map(c => `<div class="row"><span class="check" style="width:18px;height:18px;font-size:10px;${c.met === true ? '' : 'border-color:var(--fg-3);color:transparent'}">✓</span>${{ PURCHASED_PRODUCT: '상품 구매 완료', EVIDENCE_URL: '리뷰/게시물 URL 등록', CASH_NET_SALES_GTE: `현금 순매출 ${won(c.value)} 달성` }[c.type]}</div>`).join('')}</div>
        <div class="xs muted" style="margin-top:8px">진행 기간</div><div class="small">${qu.startsAt ? `${dt(qu.startsAt)} ~ ${dt(qu.endsAt)}` : '상시 진행'}</div>
        ${done ? `<div class="alert ok" style="margin-top:auto"><span class="check">✓</span><div>완료 · ${dtm(qu.mine.completedAt)}</div></div>` : `${needUrl ? `<input class="input" id="ev${qu.id}" placeholder="게시물 URL (https://…)" style="margin-top:auto">` : ''}<button class="btn primary" data-q="${qu.id}" ${qu.eligible.ok ? '' : 'disabled'} style="margin-top:${needUrl ? '8px' : 'auto'}">${qu.type === 'CREATOR' ? '인증하기' : qu.type === 'CONDITIONAL' ? '달성 확인 후 보상 받기' : '퀘스트 완료하기'} ${I.arrow}</button>`}</div></div></div>`; }).join('')}</div>
  <div class="notice">* 퀘스트별 조건 및 보상은 사전 고지 없이 변경될 수 있습니다. 완료는 서버 트랜잭션에서 자격·정원·중복을 다시 검사합니다.</div>`, { title: 'QUESTS' });
  app.querySelectorAll('[data-q]').forEach(b => b.onclick = busy(b, async () => { const ev = $('#ev' + b.dataset.q); const r = await api(`/api/quests/${b.dataset.q}/complete`, { url: ev?.value }); toast(`보상 ${r.reward}가 지급되었습니다.${r.achievements.length ? ' 엠블럼: ' + r.achievements.join(', ') : ''}`); quests(); }));
}
async function achievements() {
  shell(loading(), { title: 'ACHIEVEMENTS' });
  const d = await api('/api/achievements');
  const feat = d.titles.find(t => t.featured);
  shell(`<div class="hero" style="text-align:center"><h1 class="display h1">Emblems of participation.</h1><div class="rule" style="max-width:280px;margin:12px auto"><span>✧</span></div><div class="eyebrow"><span class="brass">${d.unlocked} UNLOCKED</span> <span class="muted">/ ${d.total} TOTAL</span></div></div>
  <div class="panel brass row" style="gap:18px">${shield('sun')}<div><div class="eyebrow">대표 칭호</div><div class="display h2" style="letter-spacing:.1em">${esc(feat?.name || '—')}</div><div class="small muted">${esc(feat?.description || '대표 칭호를 설정하세요.')}</div></div></div>
  <div class="grid g2" style="margin-top:14px">${d.list.map(a => `<div class="panel ${a.unlocked ? '' : 'locked'}" style="text-align:center;position:relative"><span style="position:absolute;top:12px;right:12px" class="check ${a.unlocked ? '' : 'muted'}" ${a.unlocked ? '' : 'style="border-color:var(--fg-3);color:var(--fg-3);position:absolute;top:12px;right:12px"'}>${a.unlocked ? '✓' : '🔒'.replace('🔒', '<span style="width:10px;height:10px;display:block;stroke:currentColor;fill:none">' + I.lock + '</span>')}</span>${shield(a.badgeCode)}<div class="display h3" style="letter-spacing:.1em;margin-top:10px;${a.unlocked ? '' : 'color:var(--fg-3)'}">${esc(a.name)}</div><p class="small muted">${esc(a.description)}</p>${a.unlocked ? `<div class="progress" style="margin-top:10px"><i style="width:100%"></i></div>` : `<div class="row" style="margin-top:10px;gap:10px"><span class="num small">${a.current} / ${a.threshold}</span><div class="progress" style="flex:1"><i style="width:${Math.min(100, a.current / a.threshold * 100)}%"></i></div></div>`}</div>`).join('')}</div>
  <div class="row" style="margin-top:22px"><span class="display h3">칭호 컬렉션</span><span class="rule" style="flex:1"></span></div>
  <div class="grid g3">${d.titles.map(t => `<div class="panel ${t.owned ? '' : 'locked'} ${t.featured ? 'brass' : ''}" style="text-align:center">${shield(t.code === 'FIRST_LIGHT' ? 'sun' : t.code === 'PRIVATE_CURATOR' ? 'p' : 'laurel')}<div class="display" style="letter-spacing:.1em;font-size:18px;margin-top:8px;${t.owned ? '' : 'color:var(--fg-3)'}">${esc(t.name)}</div><div class="xs muted">${esc(t.description)}</div>${t.owned && !t.featured ? `<button class="btn sm" style="margin-top:10px" data-title="${t.code}">대표로 설정</button>` : t.featured ? '<div class="eyebrow" style="margin-top:10px">대표 칭호</div>' : ''}</div>`).join('')}</div>`, { title: 'ACHIEVEMENTS' });
  app.querySelectorAll('[data-title]').forEach(b => b.onclick = busy(b, async () => { await api('/api/achievements/title', { code: b.dataset.title }); toast('대표 칭호가 회원 프로필에 반영되었습니다.'); achievements(); }));
}
async function profile() {
  shell(loading(), { title: 'PROFILE' });
  const d = await api('/api/club'); const u = d.user;
  shell(`<div class="hero row" style="gap:18px"><div class="avatar" style="width:64px;height:64px;font-size:22px">${esc(u.name.slice(0, 2).toUpperCase())}</div><div><h1 class="display h2">${esc(u.name)}</h1><div class="xs muted">${esc(u.memberCode)} · ${esc(u.email || '')}</div><div class="row wrap" style="margin-top:8px;gap:6px">${u.roles.map(r => `<span class="pill ${r === 'SUPER_ADMIN' || r === 'ADMIN' ? 'dark' : ''}">${r}</span>`).join('')}<span class="pill solid">${u.tierCode}</span>${u.creatorTier ? `<span class="pill">CREATOR ${u.creatorTier}</span>` : ''}${u.sellerStatus !== 'NONE' ? `<span class="pill">SELLER ${u.sellerStatus}</span>` : ''}</div></div></div>
  ${u.tierOverride ? `<div class="alert warn"><span>!</span><div>수동 등급 지정 중 · ${esc(u.tierOverride.reason)} · ${u.tierOverride.endsAt ? dt(u.tierOverride.endsAt) + ' 이후 자동 등급 ' + u.autoTierCode + '로 복귀' : '기간 없음'}</div></div>` : ''}
  <div class="stack" style="margin-top:14px">${[['#/orders', 'orders', '주문 · 예약', '구매 확정 · 취소 · 부분 반품'], ['#/rewards', 'rewards', '멤버십 · 혜택', '포인트 원장 · 추천 · XP'], ['#/quests', 'quest', '퀘스트', '선착순 · 조건형 · 크리에이터'], ['#/achievements', 'badge', '업적과 칭호', '엠블럼 · 대표 칭호'],
    ...(u.roles.includes('INFLUENCER') ? [['#/creator', 'creator', '크리에이터 워크스페이스', 'SNS 인증 · 단가표 · 포트폴리오']] : []), ...(u.roles.includes('INFLUENCER') || u.roles.includes('SELLER') ? [['#/opportunities', 'opp', '기회', '초대 · 수락 · 제출']] : []), ...(u.sellerStatus === 'APPROVED' ? [['#/seller', 'seller', '셀러 센터', '공동구매 · 라이브 · 정산']] : []), ...(u.isAdmin ? [['#/admin', 'admin', '운영 어드민', '회원 · 정책 · 원장 · 감사']] : [])]
    .map(([h, i, t, s]) => `<a href="${h}" class="panel row" style="display:flex;gap:14px"><span style="width:22px;height:22px;stroke:var(--brass);fill:none;stroke-width:1.3">${I[i]}</span><div style="flex:1"><div>${t}</div><div class="xs muted">${s}</div></div>${I.arrow}</a>`).join('')}
    <button class="btn block" id="lo">${I.logout.replace('<svg', '<svg width="16" height="16" style="stroke:currentColor;fill:none;stroke-width:1.4"')} 로그아웃</button>
    ${u.isDemo ? '<p class="xs muted" style="text-align:center">데모 계정입니다. 모든 숫자는 서버 정책과 시드 데이터에서 계산됩니다.</p>' : ''}</div>`, { title: 'PROFILE' });
  $('#lo').onclick = async () => { await api('/api/auth/logout', {}); ME = null; go('#/'); };
}
async function creator() {
  shell(loading(), { title: 'CREATOR WORKSPACE' });
  let d; try { d = await api('/api/creator'); } catch (e) { return shell(errorView(e)); }
  const p = d.profile, s = d.snapshot;
  shell(`<div class="row between wrap hero" style="gap:12px"><div><h1 class="display h2">Creator profile, with evidence.</h1><p class="sub">팩트 기반의 신뢰로, 더 높은 가치를 만듭니다.</p></div><div style="min-width:180px"><div class="eyebrow muted">PROFILE COMPLETION</div><div class="row"><span class="num" style="font-size:28px">${p.profileCompletion}%</span><div class="progress" style="flex:1"><i style="width:${p.profileCompletion}%"></i></div></div></div></div>
  <div class="grid g3">
    <div class="panel"><div class="row" style="gap:14px"><div class="avatar" style="width:64px;height:64px">${esc(p.displayName.slice(0, 2).toUpperCase())}</div><div><div class="display h3">${esc(p.displayName)}</div><div class="row" style="margin-top:6px;gap:6px"><span class="pill">${esc(ME.tierCode)} CREATOR</span>${p.verificationStatus === 'VERIFIED' ? '<span class="pill solid">VERIFIED</span>' : '<span class="pill gray">PENDING</span>'}</div><div class="xs muted" style="margin-top:6px">${esc(p.category || '')} · ${esc(p.location || '')}</div></div></div>
      <form id="pf" class="stack" style="margin-top:14px"><div class="field"><label>About</label><textarea class="input" name="bio">${esc(p.bio || '')}</textarea></div><div class="grid g2"><div class="field"><label>Category</label><input class="input" name="category" value="${esc(p.category || '')}"></div><div class="field"><label>공개 범위</label><select class="input" name="visibility">${['PUBLIC', 'MEMBER_ONLY', 'OPERATOR_ONLY'].map(v => `<option ${p.visibility === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div><button class="btn sm">프로필과 공개 범위 저장</button></form></div>
    <div class="panel"><div class="row between"><span class="eyebrow">SNS &amp; VERIFY</span><span class="xs muted">인증 출처는 운영자가 검토합니다</span></div>
      ${d.socials.map(x => `<div class="kv" style="align-items:flex-start"><div><div style="text-transform:capitalize">${esc(x.provider)} <span class="xs muted">${esc(x.handle)}</span></div><div class="xs muted">${x.verificationSource.replace('_', ' ')} · ${x.lastVerifiedAt ? dt(x.lastVerifiedAt) : '미검증'}</div></div><div style="text-align:right"><div class="num small">${(x.followers / 1000).toFixed(1)}K · 도달 ${(x.reach30d / 1000).toFixed(0)}K · ${pct(x.engagementRateBp)}</div>${st(x.verificationStatus)}</div></div>`).join('') || '<div class="empty small">연결된 계정이 없습니다.</div>'}
      <form id="sf" class="grid g2" style="margin-top:12px;gap:8px"><select class="input" name="provider"><option>instagram</option><option>youtube</option><option>tiktok</option></select><input class="input" name="handle" placeholder="@handle" required><input class="input" name="followers" type="number" placeholder="팔로워"><input class="input" name="reach30d" type="number" placeholder="30일 도달"><button class="btn sm" style="grid-column:1/-1">계정 등록 (자기 기입 → 검토 대기)</button></form></div>
    <div class="panel"><div class="eyebrow">PERFORMANCE SNAPSHOT · 30D</div><div class="grid g3" style="margin-top:10px;text-align:center"><div><div class="xs muted">TOTAL REACH</div><div class="num" style="font-size:26px">${(s.totalReach / 1e6).toFixed(1)}M</div></div><div style="border-left:var(--line)"><div class="xs muted">ENGAGEMENT</div><div class="num" style="font-size:26px">${(s.totalEngagement / 1000).toFixed(0)}K</div></div><div style="border-left:var(--line)"><div class="xs muted">AVG. ENG.</div><div class="num" style="font-size:26px">${pct(s.avgEngBp)}</div></div></div>
      <div class="chart">${d.socials.map(x => `<div style="height:${Math.max(8, Math.min(100, x.reach30d / Math.max(1, s.totalReach) * 200))}%"><span>${esc(x.provider)}</span></div>`).join('')}</div><p class="xs muted" style="margin-top:26px">플랫폼 인증(PLATFORM VERIFIED)과 자기 기입(SELF REPORTED)을 구분해 표시합니다. 공식 SNS API는 어댑터 뒤에 있습니다.</p></div>
  </div>
  <div class="grid g2 m1" style="margin-top:14px"><div class="panel"><div class="row between"><span class="eyebrow">RATE CARD</span><span class="xs muted">VAT 별도 · 운영자 공개</span></div><div class="tscroll"><table class="table"><thead><tr><th>Item</th><th>Description</th><th style="text-align:right">Rate (KRW)</th><th></th></tr></thead><tbody>${d.rateCards.map(r => `<tr><td>${esc(r.contentType)}</td><td class="muted small">${esc(r.description || '')}</td><td class="num" style="text-align:right">${won(r.amount)}</td><td><button class="btn ghost sm" data-rc="${r.id}">✕</button></td></tr>`).join('')}</tbody></table></div>
      <form id="rf" class="grid g3" style="margin-top:10px;gap:8px"><input class="input" name="contentType" placeholder="Item" required><input class="input" name="description" placeholder="설명"><input class="input" name="amount" type="number" placeholder="KRW" required><button class="btn sm" style="grid-column:1/-1">단가 추가</button></form></div>
    <div class="panel"><div class="eyebrow">PORTFOLIO</div><div class="grid g2" style="margin-top:10px">${d.portfolios.map(x => `<div class="card"><div class="plate wide"><svg viewBox="0 0 100 100"><path d="M20 70l20-25 15 18 10-12 15 19z"/><circle cx="70" cy="35" r="6"/></svg><span class="tag pill gray">${x.visibility.replace('_', ' ')}</span></div><div class="body"><div class="small" style="font-weight:500">${esc(x.title)}</div><div class="xs muted">${esc(x.brandName || '')}</div></div></div>`).join('')}</div></div></div>`, { title: 'CREATOR' });
  $('#pf').onsubmit = e => { e.preventDefault(); busy(null, async () => { await api('/api/creator/profile', Object.fromEntries(new FormData(e.target))); toast('프로필과 공개 범위가 저장되었습니다.'); creator(); })(); };
  $('#sf').onsubmit = e => { e.preventDefault(); busy(null, async () => { await api('/api/creator/social', Object.fromEntries(new FormData(e.target))); toast('계정이 등록되었습니다. 운영자 검토 후 인증됩니다.'); creator(); })(); };
  $('#rf').onsubmit = e => { e.preventDefault(); busy(null, async () => { await api('/api/creator/rate-card', Object.fromEntries(new FormData(e.target))); toast('단가가 추가되었습니다.'); creator(); })(); };
  app.querySelectorAll('[data-rc]').forEach(b => b.onclick = busy(b, async () => { await api('/api/creator/rate-card/delete', { id: Number(b.dataset.rc) }); creator(); }));
}
async function opportunities() {
  shell(loading(), { title: 'PRIVATE OPPORTUNITIES' });
  const d = await api('/api/opportunities'); let type = '';
  const render = () => {
    const list = d.list.filter(o => !type || o.type === type);
    shell(`<div class="hero" style="text-align:center"><h1 class="display h1">Invitations,<br>not listings.</h1><div class="rule" style="max-width:260px;margin:12px auto"><span>✧</span></div><div class="row" style="justify-content:center;gap:8px">${ME.roles.includes('INFLUENCER') ? '<span class="pill">CREATOR</span>' : ''}${ME.sellerStatus === 'APPROVED' ? '<span class="pill">APPROVED SELLER</span>' : ''}</div></div>
    <div class="tabs">${[['', '전체'], ['CAMPAIGN', '캠페인'], ['EVENT', '행사'], ['OUTSOURCE', '외주'], ['GROUP_BUY', '공동구매'], ['LIVE', '라이브']].map(([v, l]) => `<button class="${type === v ? 'active' : ''}" data-type="${v}">${l}</button>`).join('')}</div>
    <div class="row between small"><span>배정된 기회 <b>${list.length}</b></span><span class="muted">최신순</span></div>
    <div class="grid g2" style="margin-top:12px">${list.map(o => `<a href="#/opportunity/${o.id}" class="card"><div class="plate wide"><svg viewBox="0 0 100 100">${{ CAMPAIGN: '<path d="M30 70V40l20-10 20 10v30z"/><path d="M50 30v40"/>', EVENT: '<path d="M20 65h60M26 65V45l24-15 24 15v20"/>', LIVE: '<circle cx="50" cy="50" r="8"/><circle cx="50" cy="50" r="18"/><circle cx="50" cy="50" r="28"/>', GROUP_BUY: '<circle cx="35" cy="45" r="8"/><circle cx="65" cy="45" r="8"/><path d="M20 75c3-10 9-14 15-14s12 4 15 14M50 75c3-10 9-14 15-14s12 4 15 14"/>', OUTSOURCE: '<path d="M30 25h40v50H30z"/><path d="M38 40h24M38 50h24M38 60h14"/>' }[o.type] || ''}</svg><span class="tag pill">${{ INVITED: '초대됨', VIEWED: '확인함', APPLIED: '신청', ACCEPTED: '수락', IN_PROGRESS: '진행 중', SUBMITTED: '결과물 제출', APPROVED: '승인', DECLINED: '거절', SETTLED: '정산 완료' }[o.assignmentStatus] || o.assignmentStatus}</span><span class="lbl">${esc(o.brandName || '')}</span></div>
      <div class="body"><div class="display h3" style="letter-spacing:.06em">${esc(o.title)}</div><div class="eyebrow muted" style="margin-top:-4px">${esc(o.subtitle || o.type)}</div>
      <div class="col small" style="margin-top:6px;gap:4px"><div class="row"><span class="muted" style="width:64px">마감</span>${dt(o.deadline)}</div><div class="row"><span class="muted" style="width:64px">보상</span>${o.rewardType === 'COMMISSION' ? `커미션 ${pct(o.commissionRateBp)} · 최소 ${won(o.minSales)}` : o.rewardType === 'PRODUCT' ? '제품 시딩' : `${won(o.rewardMin)} ~ ${won(o.rewardMax)}`}</div><div class="row"><span class="muted" style="width:64px">요구 등급</span>${o.tierName ? o.tierName + ' 이상' : o.requiredRole || '—'}</div></div>
      <span class="btn sm" style="margin-top:auto">조건 확인</span></div></a>`).join('') || `<div class="empty" style="grid-column:1/-1"><div class="display h3">배정된 기회가 없습니다.</div><p>운영팀이 회원님의 역할과 등급에 맞는 기회를 초대합니다.</p></div>`}</div>
    ${ME.sellerStatus !== 'APPROVED' ? `<div class="panel row" style="margin-top:14px;gap:14px"><span style="width:24px;height:24px;stroke:var(--brass);fill:none;stroke-width:1.3">${I.lock}</span><div><div class="brass">승인 셀러에게만 공개됩니다.</div><div class="xs muted">APPROVED SELLER 전용 공동구매·라이브 기회</div></div></div>` : ''}`, { title: 'OPPORTUNITIES' });
    app.querySelectorAll('[data-type]').forEach(b => b.onclick = () => { type = b.dataset.type; render(); });
  };
  render();
}
async function opportunity(id) {
  shell(loading(), { back: '#/opportunities', title: 'OPPORTUNITY DETAIL' });
  let d; try { d = await api('/api/opportunities/' + id); } catch (e) { return shell(errorView(e), { back: '#/opportunities' }); }
  const o = d.opportunity, a = d.assignment, r = o.requirements;
  const flow = ['INVITED', 'ACCEPTED', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED']; const cur = { INVITED: 0, VIEWED: 0, APPLIED: 0, ACCEPTED: 1, IN_PROGRESS: 2, SUBMITTED: 3, APPROVED: 4, SETTLED: 4 }[a?.status] ?? -1;
  shell(`<div class="grid g2 m1" style="gap:24px;grid-template-columns:1.4fr 1fr"><div>${plate('retreat', 'wide', o.brandName || '')}<div class="hero" style="padding-top:20px"><h1 class="display h1" style="letter-spacing:.06em">${esc(o.title)}</h1><div class="eyebrow" style="margin-top:6px;letter-spacing:.24em">${esc(o.subtitle || '')}</div><div class="rule" style="max-width:200px;margin:12px 0"><span>✧</span></div><span class="pill">${a ? 'INVITED · ' + ME.tierCode + ' ' + (ME.roles.includes('INFLUENCER') ? 'CREATOR' : 'SELLER') : 'ADMIN PREVIEW'}</span></div>
    <div class="grid g2" style="margin-top:8px">${[['OVERVIEW', o.description], ['DELIVERABLES', (r.deliverables || []).map(x => '• ' + x).join('<br>')], ['TIMELINE', r.timeline], ['USAGE RIGHTS', r.usageRights], ['ELIGIBILITY', r.eligibility || (o.requiredRole + (o.requiredTierRank ? ' · 등급 충족' : ''))]].filter(x => x[1]).map(([t, b]) => `<div class="panel"><div class="eyebrow">${t}</div><p class="small" style="margin-top:8px">${b}</p></div>`).join('')}</div></div>
  <div class="stack"><div class="panel"><div class="eyebrow">REWARD</div><div class="num brass" style="font-size:36px;line-height:1.1;margin:6px 0">${o.rewardType === 'COMMISSION' ? pct(o.commissionRateBp) + ' 커미션' : o.rewardType === 'PRODUCT' ? '제품 시딩' : won(a?.rewardAmount || o.rewardMax)}</div><div class="xs muted">${o.rewardType === 'COMMISSION' ? `최소 판매 ${won(o.minSales)} · 정산은 영업일 기준` : 'EXPECTED SETTLEMENT · 결과물 승인 후 5영업일 이내 · 3.3% 원천징수 후 지급'}</div>
      <div class="kv" style="margin-top:8px"><span class="k small">DEADLINE</span><span class="v sm">${dt(o.deadline)} 23:59까지</span></div><div class="kv"><span class="k small">CONTACT</span><span class="v sm">PUFFWATT 운영팀</span></div></div>
    ${a ? `<div class="panel"><div class="eyebrow">PROGRESS</div><div class="steps" style="margin-top:10px">${['초대', '수락', '진행', '제출', '승인'].map((s, i) => `<div class="st ${i < cur ? 'done' : i === cur ? 'cur' : ''}"><i>${i < cur ? '✓' : i + 1}</i>${s}</div>${i < 4 ? '<span class="ar">→</span>' : ''}`).join('')}</div>${a.status === 'DECLINED' ? `<div class="alert err" style="margin-top:8px">거절한 기회입니다.</div>` : ''}
      <div class="grid g3" style="margin-top:12px;gap:8px">${['INVITED', 'VIEWED', 'APPLIED'].includes(a.status) ? `<button class="btn primary" data-act="ACCEPT">수락</button>` : ''}${a.status === 'ACCEPTED' ? `<button class="btn primary" data-act="START">진행 시작</button>` : ''}<button class="btn" id="ask">문의</button>${['INVITED', 'VIEWED', 'APPLIED', 'ACCEPTED'].includes(a.status) ? `<button class="btn" data-act="DECLINE">거절</button>` : ''}</div></div>
    <div class="panel"><div class="eyebrow">SUBMISSION</div>${['ACCEPTED', 'IN_PROGRESS'].includes(a.status) ? `<form id="sub" class="stack" style="margin-top:10px"><div class="field"><label>결과물 URL</label><input class="input" name="url" placeholder="Instagram Reel 또는 콘텐츠 URL을 입력하세요" required></div><div class="field"><label>메모 (선택)</label><textarea class="input" name="note" placeholder="운영팀에게 전달하고 싶은 내용을 입력해주세요."></textarea></div><button class="btn primary block">결과물 제출</button></form>` : ''}
      ${d.submissions.map(s => `<div class="alert ${s.status === 'REJECTED' ? 'err' : 'ok'}" style="margin-top:10px"><span class="check">${s.status === 'APPROVED' ? '✓' : '…'}</span><div style="flex:1"><div class="small">${s.status === 'APPROVED' ? '결과물이 승인되었습니다.' : s.status === 'REJECTED' ? '보완 요청 · ' + esc(s.feedback || '') : '결과물이 제출되었으며 운영자 검토를 기다립니다.'}</div><div class="xs muted">${esc(s.url)} · ${dtm(s.submittedAt)}</div></div></div>`).join('')}
      ${!['ACCEPTED', 'IN_PROGRESS'].includes(a.status) && !d.submissions.length ? '<p class="xs muted" style="margin-top:8px">수락 후 결과물을 제출할 수 있습니다.</p>' : ''}</div>
    ${d.messages.length ? `<div class="panel"><div class="eyebrow">MESSAGES</div>${d.messages.map(m => `<div class="kv" style="align-items:flex-start"><span class="k small" style="flex:1">${esc(m.body)}</span><span class="xs muted">${esc(m.fromName)} · ${dtm(m.createdAt)}</span></div>`).join('')}</div>` : ''}` : '<div class="panel muted small">운영자 미리보기 — 배정 관계가 없어 응답 버튼이 표시되지 않습니다.</div>'}</div></div>`, { back: '#/opportunities', title: 'OPPORTUNITY DETAIL' });
  app.querySelectorAll('[data-act]').forEach(b => b.onclick = busy(b, async () => { await api(`/api/opportunities/${id}/respond`, { action: b.dataset.act }); toast({ ACCEPT: '기회를 수락했습니다.', DECLINE: '기회를 거절했습니다.', START: '진행을 시작했습니다.' }[b.dataset.act]); opportunity(id); }));
  const ask = $('#ask'); if (ask) ask.onclick = async () => { const body = prompt('운영팀에 보낼 문의를 입력하세요.'); if (body) { await api(`/api/opportunities/${id}/ask`, { body }); toast('문의를 보냈습니다.'); opportunity(id); } };
  const sub = $('#sub'); if (sub) sub.onsubmit = e => { e.preventDefault(); busy(sub.querySelector('button'), async () => { await api(`/api/opportunities/${id}/submit`, Object.fromEntries(new FormData(sub))); toast('결과물이 제출되었으며 운영자 검토를 기다립니다.'); opportunity(id); })(); };
}
async function seller() {
  shell(loading(), { title: 'SELLER CENTER' });
  let d; try { d = await api('/api/seller'); } catch (e) { return shell(errorView(e)); }
  const s = d.summary;
  shell(`<div class="row between wrap hero"><h1 class="display h2">Sales, after returns and fees.</h1><span class="pill">APPROVED SELLER</span></div>
  <div class="grid g4 m2">${[['진행 판매', s.active], ['현금 순매출', won(s.gross)], ['반품', won(s.returns)], ['플랫폼 수수료', won(s.fee)]].map(([l, v]) => `<div class="stat"><div class="l">${l}</div><div class="n" style="font-size:24px">${v}</div></div>`).join('')}</div>
  <div class="stat brass" style="margin-top:14px;border-color:var(--brass-line)"><div class="l">예상 정산</div><div class="n brass">${won(s.net)}</div><div class="d">정산은 영업일 기준 지급 · 모든 금액 VAT 제외</div></div>
  <div class="panel" style="margin-top:14px;padding:0"><div style="padding:14px 16px" class="eyebrow">✧ ASSIGNED OPPORTUNITIES</div><div class="tscroll"><table class="table"><thead><tr><th>구분</th><th>상품명</th><th>판매 기간</th><th>최소 판매</th><th>커미션</th><th>상태</th><th></th></tr></thead><tbody>${d.opportunities.map(o => `<tr><td><span class="pill ${o.type === 'LIVE' ? 'dark' : ''}">${o.type.replace('_', ' ')}</span></td><td><div>${esc(o.title)}</div><div class="xs muted">${esc(o.subtitle || '')}</div></td><td class="small">${o.startsAt ? dt(o.startsAt) + ' ~ ' : ''}${dt(o.deadline)}</td><td class="num">${won(o.minSales)}</td><td class="num">${pct(o.commissionRateBp)}</td><td>${st(o.assignmentStatus)}</td><td><a class="btn sm" href="#/opportunity/${o.id}">상세 보기</a></td></tr>`).join('') || '<tr><td colspan="7" class="muted small" style="text-align:center;padding:20px">배정된 공동구매·라이브가 없습니다.</td></tr>'}</tbody></table></div></div>
  <div class="panel" style="padding:0"><div style="padding:14px 16px" class="eyebrow">정산 일정</div><div class="tscroll"><table class="table"><thead><tr><th>기간</th><th>기회</th><th>총매출</th><th>반품</th><th>수수료</th><th>정산</th><th>상태</th></tr></thead><tbody>${d.settlements.map(x => `<tr><td class="small">${dt(x.periodStart)} ~ ${dt(x.periodEnd)}</td><td class="small">${esc(x.title || '—')}</td><td class="num">${won(x.grossCashSales)}</td><td class="num">${won(x.returns)}</td><td class="num">${won(x.fee)}</td><td class="num brass">${won(x.netSettlement)}</td><td>${st(x.status)}${x.paidAt ? `<div class="xs muted">${dt(x.paidAt)}</div>` : ''}</td></tr>`).join('')}</tbody></table></div></div>
  <div class="notice">자동 송금·세금계산서·원천징수는 운영 전 연결 대상입니다 (PRODUCTION BLOCKER).</div>`, { title: 'SELLER' });
}

/* ---------- router ---------- */
async function loadMe() { try { const r = await api('/api/auth/me'); ME = r.user; ENVINFO = { ...r, policy: (await api('/api/health')).policy }; } catch { ME = null; } }
const R = [
  [/^#\/?$/, () => landing()], [/^#\/login/, login], [/^#\/membership/, membershipPreview],
  [/^#\/club/, club], [/^#\/catalog/, catalog], [/^#\/product\/(.+)/, (m) => product(m[1])], [/^#\/cart/, cart], [/^#\/orders\/?(\d+)?/, (m) => orders(m[1])],
  [/^#\/rewards/, rewards], [/^#\/quests/, quests], [/^#\/achievements/, achievements], [/^#\/profile/, profile], [/^#\/creator/, creator],
  [/^#\/opportunities/, opportunities], [/^#\/opportunity\/(\d+)/, (m) => opportunity(m[1])], [/^#\/seller/, seller],
  [/^#\/admin/, (m) => window.adminRoute(location.hash)],
];
async function route() {
  closePanel(); window.scrollTo(0, 0);
  const h = location.hash || '#/';
  if (ME === null && !/^#\/(login|membership|$)/.test(h) && h !== '#/') { await loadMe(); if (!ME) return go('#/login'); }
  for (const [re, fn] of R) { const m = h.split('?')[0].match(re); if (m) { try { await fn(m); } catch (e) { console.error(e); shell(errorView(e)); } return; } }
  go('#/');
}
window.route = route; window.shell = shell; window.api = api; window.toast = toast; window.busy = busy; window.openPanel = openPanel; window.closePanel = closePanel;
window.F = { won, pt, pct, dt, dtm, esc, st, loading, errorView };
Object.defineProperty(window, 'ME', { get: () => ME });
window.addEventListener('hashchange', route);
loadMe().then(route);
