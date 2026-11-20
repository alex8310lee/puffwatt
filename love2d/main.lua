-- PUFFWATT LÖVE client — talks to the PUFFWATT Node server (/api/*).
-- Run:  love love2d                       (server at http://localhost:3000)
--       love love2d http://192.168.0.10:3000
local api = require("lib.api")
local utf8 = require("utf8")

local C = {
  bg = { 0.094, 0.102, 0.094 }, panel = { 1, 1, 1, 0.035 }, panel2 = { 0.149, 0.161, 0.153 },
  fg = { 0.957, 0.945, 0.918 }, fg2 = { 0.847, 0.820, 0.773 }, mute = { 0.557, 0.533, 0.486 },
  brass = { 0.659, 0.545, 0.353 }, brass2 = { 0.769, 0.643, 0.420 }, line = { 0.847, 0.820, 0.773, 0.14 },
  ok = { 0.431, 0.604, 0.361 }, err = { 0.722, 0.341, 0.290 },
}
local F = {}
local PAD = 16

local state = {
  screen = "login", tab = "club", user = nil, demoEnabled = false, demo = nil,
  health = nil, healthErr = nil, data = {}, loading = {}, scroll = {}, contentH = {},
  toast = nil, toastT = 0, focus = nil,
  fields = { url = "", email = "", password = "" },
}
local hits = {}

---------------------------------------------------------------- helpers
local function readFile(path)
  local f = io.open(path, "rb"); if not f then return nil end
  local d = f:read("*a"); f:close(); return d
end

local function loadFonts()
  -- Korean glyphs need a CJK font. Drop one at love2d/assets/font.ttf to override.
  local data
  if love.filesystem.getInfo("assets/font.ttf") then data = love.filesystem.newFileData("assets/font.ttf")
  elseif love.filesystem.getInfo("assets/font.otf") then data = love.filesystem.newFileData("assets/font.otf") end
  if not data then
    local windir = os.getenv("WINDIR") or "C:\\Windows"
    local home = os.getenv("HOME") or ""
    local candidates = {
      windir .. "\\Fonts\\malgun.ttf", windir .. "\\Fonts\\gulim.ttc",
      "/System/Library/Fonts/AppleSDGothicNeo.ttc", "/System/Library/Fonts/Supplemental/AppleGothic.ttf",
      "/Library/Fonts/NanumGothic.ttf", home .. "/Library/Fonts/NanumGothic.ttf",
      "/usr/share/fonts/truetype/nanum/NanumGothic.ttf", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
      "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc", "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
      "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", "/usr/share/fonts/opentype/unifont/unifont.otf",
    }
    for _, p in ipairs(candidates) do
      local raw = readFile(p)
      if raw then
        local ok, fd = pcall(love.filesystem.newFileData, raw, p:match("[^/\\]+$"))
        if ok and pcall(love.graphics.newFont, fd, 12) then data = fd; break end
      end
    end
  end
  local function mk(size) return data and love.graphics.newFont(data, size) or love.graphics.newFont(size) end
  F.small, F.body, F.bold, F.h2, F.h1 = mk(12), mk(14), mk(16), mk(20), mk(30)
  F.hasKorean = data ~= nil
end

local function comma(n)
  n = math.floor(tonumber(n) or 0)
  local s = tostring(math.abs(n)):reverse():gsub("(%d%d%d)", "%1,"):reverse():gsub("^,", "")
  return (n < 0 and "-" or "") .. s
end
local function pct(bp) if not bp then return "-" end local v = bp / 100; return (v % 1 == 0 and string.format("%d", v) or string.format("%.1f", v)) .. "%" end
local function date(iso) return iso and iso:sub(1, 10) or "" end

local function toast(msg, isErr) state.toast = { msg = msg, err = isErr }; state.toastT = 3.2 end
local function errMsg(e) return e and (e.message or e.code) or "오류" end

local function setColor(c, a) love.graphics.setColor(c[1], c[2], c[3], a or c[4] or 1) end
local function text(s, font, color, x, y, w, align)
  love.graphics.setFont(font); setColor(color or C.fg)
  if w then love.graphics.printf(s or "", x, y, w, align or "left") else love.graphics.print(s or "", x, y) end
end
local function wrappedHeight(s, font, w) local _, lines = font:getWrap(s or "", w); return #lines * font:getHeight() end
local function hit(x, y, w, h, fn) hits[#hits + 1] = { x = x, y = y, w = w, h = h, fn = fn } end
local function hovered(x, y, w, h) local mx, my = love.mouse.getPosition(); return mx >= x and mx < x + w and my >= y and my < y + h end

local function button(label, x, y, w, h, fn, style)
  local hov = hovered(x, y, w, h)
  if style == "ghost" then
    setColor(C.brass, hov and 0.9 or 0.55); love.graphics.rectangle("line", x + 0.5, y + 0.5, w - 1, h - 1, 2)
    text(label, F.body, hov and C.brass2 or C.fg2, x, y + (h - F.body:getHeight()) / 2, w, "center")
  else
    setColor(hov and C.brass2 or C.brass); love.graphics.rectangle("fill", x, y, w, h, 2)
    text(label, F.bold, C.bg, x, y + (h - F.bold:getHeight()) / 2, w, "center")
  end
  hit(x, y, w, h, fn)
end

local function field(key, label, x, y, w, secret)
  text(label, F.small, C.mute, x, y)
  y = y + 18
  local h = 38
  local focused = state.focus == key
  setColor(C.panel2); love.graphics.rectangle("fill", x, y, w, h, 2)
  setColor(focused and C.brass2 or C.line); love.graphics.rectangle("line", x + 0.5, y + 0.5, w - 1, h - 1, 2)
  local v = state.fields[key]
  local shown = secret and string.rep("•", utf8.len(v) or 0) or v
  love.graphics.setScissor(x, y, w, h)
  local tw = F.body:getWidth(shown)
  local ox = math.min(0, (w - 20) - tw)
  text(shown, F.body, C.fg, x + 10 + ox, y + (h - F.body:getHeight()) / 2)
  if focused and (love.timer.getTime() % 1) < 0.55 then
    setColor(C.brass2); love.graphics.rectangle("fill", x + 11 + ox + tw, y + 9, 1.5, h - 18)
  end
  love.graphics.setScissor()
  hit(x, y, w, h, function() state.focus = key; love.keyboard.setTextInput(true) end)
  return y + h
end

local function panel(x, y, w, h)
  setColor(C.panel); love.graphics.rectangle("fill", x, y, w, h, 3)
  setColor(C.line); love.graphics.rectangle("line", x + 0.5, y + 0.5, w - 1, h - 1, 3)
end

local function bar(x, y, w, h, ratio)
  setColor(C.line); love.graphics.rectangle("fill", x, y, w, h, h / 2)
  setColor(C.brass); love.graphics.rectangle("fill", x, y, math.max(h, w * math.min(1, math.max(0, ratio))), h, h / 2)
end

---------------------------------------------------------------- data flows
local load -- forward

local function enterApp(user)
  state.user = user; state.screen = "app"; state.focus = nil
  state.data = {}; state.tab = "club"
  love.keyboard.setTextInput(false)
  load("club")
end

local function checkServer()
  state.health, state.healthErr = nil, nil
  api.get("/api/health", function(d, e)
    if e then state.healthErr = errMsg(e); return end
    state.health = d
    api.get("/api/auth/me", function(me, e2)
      if e2 then return end
      state.demoEnabled = me.demoEnabled
      if me.user then enterApp(me.user); return end
      if me.demoEnabled then
        api.get("/api/auth/demo-accounts", function(list) state.demo = list end)
      end
    end)
  end)
end

local function connect()
  api.setBaseUrl(state.fields.url)
  state.fields.url = api.baseUrl
  state.demo = nil
  checkServer()
end

local function login()
  api.post("/api/auth/login", { email = state.fields.email, password = state.fields.password }, function(d, e)
    if e then toast(errMsg(e), true) else state.fields.password = ""; enterApp(d.user) end
  end)
end

local function demoLogin(email)
  api.post("/api/auth/demo-login", { email = email }, function(d, e)
    if e then toast(errMsg(e), true) else enterApp(d.user) end
  end)
end

local function logout()
  api.post("/api/auth/logout", {}, function()
    api.cookie = ""; api.save()
    state.user, state.screen, state.data = nil, "login", {}
    checkServer()
  end)
end

local endpoints = { club = "/api/club", catalog = "/api/catalog", quests = "/api/quests", rewards = "/api/rewards" }
function load(tab)
  state.loading[tab] = true
  api.get(endpoints[tab], function(d, e)
    state.loading[tab] = false
    if e then
      if e.status == 401 then state.user, state.screen = nil, "login"; toast("세션이 만료되었습니다. 다시 로그인하세요.", true); checkServer(); return end
      toast(errMsg(e), true); return
    end
    state.data[tab] = d
    if tab == "club" and d.user then state.user = d.user end
  end)
end

local function addToCart(item)
  api.post("/api/cart/add", { productId = item.id, quantity = 1 }, function(d, e)
    if e then toast(errMsg(e), true) else toast(item.name .. " — 장바구니에 담았습니다 (" .. #(d.lines or {}) .. "종)") end
  end)
end

local function completeQuest(qu)
  api.post("/api/quests/" .. qu.id .. "/complete", {}, function(_, e)
    if e then toast(errMsg(e), true) else toast("퀘스트 완료: " .. qu.name); load("quests") end
  end)
end

---------------------------------------------------------------- screens
local function drawLogin(W)
  local x, w = PAD, W - PAD * 2
  local y = 48
  text("PRIVATE ACCESS CLUB", F.small, C.brass, x, y, w, "center"); y = y + 22
  text("PUFFWATT", F.h1, C.fg, x, y, w, "center"); y = y + 56

  y = field("url", "서버 주소", x, y, w - 88) - 38
  button("연결", x + w - 80, y, 80, 38, connect, "ghost"); y = y + 46
  local status, col
  if state.health then status, col = "● 연결됨 · " .. (state.health.env or "") .. " · 정책 " .. (state.health.policy or ""), C.ok
  elseif state.healthErr then status, col = "● 연결 실패: " .. state.healthErr, C.err
  else status, col = "● 확인 중…", C.mute end
  text(status, F.small, col, x, y, w); y = y + wrappedHeight(status, F.small, w) + 20

  y = field("email", "이메일", x, y, w) + 12
  y = field("password", "비밀번호", x, y, w, true) + 16
  button("로그인", x, y, w, 44, login); y = y + 60

  if state.demo and #state.demo > 0 then
    text("데모 계정 (개발 모드)", F.small, C.brass, x, y); y = y + 22
    for _, u in ipairs(state.demo) do
      local h = 52
      local hov = hovered(x, y, w, h)
      panel(x, y, w, h)
      if hov then setColor(C.brass, 0.12); love.graphics.rectangle("fill", x, y, w, h, 3) end
      text(u.name, F.bold, C.fg, x + 12, y + 8)
      text(table.concat(u.roles or {}, "·") .. "  " .. (u.tierCode or ""), F.small, C.mute, x + 12, y + 30)
      text(comma(u.wallet) .. " P", F.body, C.brass2, x, y + 17, w - 12, "right")
      hit(x, y, w, h, function() demoLogin(u.email) end)
      y = y + h + 8
    end
  end
  if not F.hasKorean then
    y = y + 8
    text("Korean font not found - put a .ttf at love2d/assets/font.ttf", F.small, C.err, x, y, w); y = y + 30
  end
  return y + PAD
end

local function stat(label, value, x, y, w)
  text(label, F.small, C.mute, x, y, w)
  text(value, F.h2, C.fg, x, y + 18, w)
end

local function drawClub(W, y)
  local d = state.data.club
  if not d then text(state.loading.club and "불러오는 중…" or "", F.body, C.mute, PAD, y); return y + 30 end
  local x, w = PAD, W - PAD * 2
  local u = d.user or state.user
  text("WELCOME BACK", F.small, C.brass, x, y); y = y + 20
  text(u.name, F.h1, C.fg, x, y); y = y + 42
  text(u.tierCode .. " · " .. (u.memberCode or "") .. (d.featuredTitle and ("  ·  " .. d.featuredTitle.name) or ""), F.body, C.fg2, x, y, w); y = y + 30

  panel(x, y, w, 150)
  local cw = (w - 32) / 2
  stat("사용 가능 포인트", comma(d.wallet.available) .. " P", x + 16, y + 14, cw)
  stat("적립 예정", comma(d.wallet.pending) .. " P", x + 16 + cw, y + 14, cw)
  stat("최근 30일 적립", comma(d.monthEarn) .. " P", x + 16, y + 64, cw)
  stat("만료 예정(30일)", comma(d.wallet.expiringSoon) .. " P", x + 16 + cw, y + 64, cw)
  local xpLabel = "XP " .. comma(d.wallet.xp) .. (d.xpGoal and (" / " .. comma(d.xpGoal) .. " → " .. (d.nextTier or "")) or " · 최고 등급")
  text(xpLabel, F.small, C.mute, x + 16, y + 112)
  bar(x + 16, y + 132, w - 32, 5, d.xpGoal and d.wallet.xp / d.xpGoal or 1)
  y = y + 166

  local items = { { "진행 중 주문", d.ordersInProgress }, { "예약", d.bookings }, { "초대된 기회", d.invitedOpportunities }, { "추천 L1 / L2", d.l1 .. " / " .. d.l2 } }
  local qw = (w - 8) / 2
  for i, it in ipairs(items) do
    local cx = x + ((i - 1) % 2) * (qw + 8)
    local cy = y + math.floor((i - 1) / 2) * 76
    panel(cx, cy, qw, 68)
    stat(it[1], tostring(it[2]), cx + 12, cy + 10, qw - 24)
  end
  y = y + 160

  text("알림", F.small, C.brass, x, y); y = y + 22
  if #(d.notifications or {}) == 0 then text("새 알림이 없습니다.", F.body, C.mute, x, y); y = y + 24 end
  for _, n in ipairs(d.notifications or {}) do
    local bh = wrappedHeight(n.body or "", F.small, w - 24)
    panel(x, y, w, 40 + bh)
    text(n.title, F.bold, C.fg, x + 12, y + 10, w - 24)
    text(n.body or "", F.small, C.fg2, x + 12, y + 32, w - 24)
    y = y + 48 + bh
  end
  return y + PAD
end

local function drawCatalog(W, y)
  local d = state.data.catalog
  if not d then text(state.loading.catalog and "불러오는 중…" or "", F.body, C.mute, PAD, y); return y + 30 end
  local x, w = PAD, W - PAD * 2
  text("CATALOG · 정책 " .. (d.policyVersion or ""), F.small, C.brass, x, y); y = y + 24
  for _, it in ipairs(d.items or {}) do
    local h = 96
    panel(x, y, w, h)
    text((it.brandName or ""):upper() .. " · " .. (it.category or ""), F.small, C.mute, x + 12, y + 10, w - 120)
    text(it.name, F.bold, it.locked and C.mute or C.fg, x + 12, y + 28, w - 120)
    if it.locked then
      text("LOCKED · " .. (it.lockReason or "LOCKED"), F.small, C.brass, x + 12, y + 56)
    else
      local price = comma(it.displayPrice) .. "원"
      if it.basePrice and it.displayPrice and it.displayPrice < it.basePrice then price = price .. "  (정가 " .. comma(it.basePrice) .. ")" end
      text(price, F.body, C.fg, x + 12, y + 52, w - 120)
      text("포인트 최대 " .. pct(it.maxPointRate) .. " · 현금 적립 " .. pct(it.cashEarnRate), F.small, C.brass2, x + 12, y + 72, w - 120)
      button("담기", x + w - 84, y + (h - 34) / 2, 72, 34, function() addToCart(it) end, "ghost")
    end
    y = y + h + 8
  end
  return y + PAD
end

local function drawQuests(W, y)
  local d = state.data.quests
  if not d then text(state.loading.quests and "불러오는 중…" or "", F.body, C.mute, PAD, y); return y + 30 end
  local x, w = PAD, W - PAD * 2
  text("QUESTS", F.small, C.brass, x, y); y = y + 24
  for _, qu in ipairs(d.quests or {}) do
    local desc = qu.description or ""
    local dh = wrappedHeight(desc, F.small, w - 24)
    local h = 112 + dh
    panel(x, y, w, h)
    text(qu.type .. (qu.remaining and ("  ·  잔여 " .. qu.remaining) or ""), F.small, C.mute, x + 12, y + 10, w - 24)
    text(qu.name, F.bold, C.fg, x + 12, y + 28, w - 24)
    text(desc, F.small, C.fg2, x + 12, y + 52, w - 24)
    local ry = y + 60 + dh
    local reward = qu.rewardType .. (qu.rewardAmount and (" " .. comma(qu.rewardAmount)) or "") .. (qu.rewardBadge and (" · " .. qu.rewardBadge) or "")
    text("보상: " .. reward, F.small, C.brass2, x + 12, ry, w - 130)
    if qu.progress then bar(x + 12, ry + 24, w - 140, 5, qu.progress.current / math.max(1, qu.progress.target)) end
    local done = qu.mine and qu.mine.status == "COMPLETED"
    if done then text("완료", F.bold, C.ok, x, ry + 6, w - 16, "right")
    elseif qu.eligible and qu.eligible.ok == false then text("자격 없음", F.small, C.mute, x, ry + 8, w - 16, "right")
    else button("완료하기", x + w - 104, ry - 4, 92, 34, function() completeQuest(qu) end) end
    y = y + h + 8
  end
  return y + PAD
end

local entryLabel = { EARN = "적립", USE = "사용", RESTORE = "복원", REVOKE = "회수", EXPIRE = "만료", ADJUST = "조정", REFERRAL = "추천", CREDIT = "월 크레딧", QUEST = "퀘스트" }
local function drawRewards(W, y)
  local d = state.data.rewards
  if not d then text(state.loading.rewards and "불러오는 중…" or "", F.body, C.mute, PAD, y); return y + 30 end
  local x, w = PAD, W - PAD * 2
  text("REWARDS", F.small, C.brass, x, y); y = y + 24
  panel(x, y, w, 76)
  local cw = (w - 32) / 2
  stat("추천 코드", d.referralCode or "-", x + 16, y + 14, cw)
  stat("내 추천 L1 / L2", (d.l1 or 0) .. " / " .. (d.l2 or 0), x + 16 + cw, y + 14, cw)
  y = y + 92
  text("포인트 원장 (최근 40건)", F.small, C.brass, x, y); y = y + 22
  for _, l in ipairs(d.ledger or {}) do
    local h = 50
    setColor(C.line); love.graphics.line(x, y + h, x + w, y + h)
    text((entryLabel[l.entryType] or l.entryType) .. " · " .. (l.status or ""), F.body, C.fg, x, y + 6, w - 120)
    text(date(l.createdAt) .. "  " .. (l.reason or l.sourceType or ""), F.small, C.mute, x, y + 28, w - 120)
    text((l.amount > 0 and "+" or "") .. comma(l.amount) .. " P", F.bold, l.amount >= 0 and C.brass2 or C.err, x, y + 14, w, "right")
    y = y + h + 6
  end
  return y + PAD
end

local tabs = { { "club", "클럽" }, { "catalog", "카탈로그" }, { "quests", "퀘스트" }, { "rewards", "리워드" } }
local drawers = { club = drawClub, catalog = drawCatalog, quests = drawQuests, rewards = drawRewards }

---------------------------------------------------------------- LÖVE callbacks
function love.load(args)
  love.graphics.setBackgroundColor(C.bg)
  love.keyboard.setKeyRepeat(true)
  loadFonts()
  local urlArg = args and args[1] or os.getenv("PUFFWATT_URL")
  api.init(urlArg ~= "" and urlArg or nil)
  state.fields.url = api.baseUrl
  checkServer()
end

function love.update(dt)
  api.update()
  if state.toastT > 0 then state.toastT = state.toastT - dt end
end

local TOPBAR, TABBAR = 52, 56

function love.draw()
  hits = {}
  local W, H = love.graphics.getDimensions()
  local key = state.screen == "login" and "login" or state.tab
  local sy = state.scroll[key] or 0

  if state.screen == "login" then
    love.graphics.push(); love.graphics.translate(0, -sy)
    local base = #hits
    state.contentH.login = drawLogin(W)
    for i = base + 1, #hits do hits[i].y = hits[i].y - sy end
    love.graphics.pop()
    state.viewH = H
  else
    love.graphics.setScissor(0, TOPBAR, W, H - TOPBAR - TABBAR)
    love.graphics.push(); love.graphics.translate(0, -sy)
    local base = #hits
    state.contentH[key] = drawers[key](W, TOPBAR + 16)
    for i = base + 1, #hits do
      local hh = hits[i]; hh.y = hh.y - sy
      if hh.y + hh.h < TOPBAR or hh.y > H - TABBAR then hh.fn = nil end
    end
    love.graphics.pop(); love.graphics.setScissor()
    state.viewH = H - TABBAR

    -- top bar
    setColor(C.bg); love.graphics.rectangle("fill", 0, 0, W, TOPBAR)
    setColor(C.line); love.graphics.line(0, TOPBAR, W, TOPBAR)
    text("PUFFWATT", F.bold, C.fg, PAD, (TOPBAR - F.bold:getHeight()) / 2)
    if state.user then text(state.user.tierCode, F.small, C.brass, PAD + F.bold:getWidth("PUFFWATT") + 10, (TOPBAR - F.small:getHeight()) / 2 + 1) end
    button("새로고침", W - PAD - 160, 10, 76, 32, function() load(state.tab) end, "ghost")
    button("로그아웃", W - PAD - 76, 10, 76, 32, logout, "ghost")

    -- tab bar
    setColor(C.bg); love.graphics.rectangle("fill", 0, H - TABBAR, W, TABBAR)
    setColor(C.line); love.graphics.line(0, H - TABBAR, W, H - TABBAR)
    local tw = W / #tabs
    for i, t in ipairs(tabs) do
      local tx = (i - 1) * tw
      local active = state.tab == t[1]
      if active then setColor(C.brass); love.graphics.rectangle("fill", tx + tw * 0.3, H - TABBAR, tw * 0.4, 2) end
      text(t[2], active and F.bold or F.body, active and C.brass2 or C.mute, tx, H - TABBAR + (TABBAR - F.body:getHeight()) / 2, tw, "center")
      hit(tx, H - TABBAR, tw, TABBAR, function()
        state.tab = t[1]
        if not state.data[t[1]] then load(t[1]) end
      end)
    end
  end

  if api.busy > 0 then
    local a = love.timer.getTime() * 6
    setColor(C.brass2); love.graphics.arc("line", "open", W - 14, state.screen == "login" and 14 or TOPBAR + 14, 6, a, a + 4)
  end

  if state.toast and state.toastT > 0 then
    local tw = W - PAD * 2
    local th = wrappedHeight(state.toast.msg, F.body, tw - 24) + 20
    local ty = H - (state.screen == "login" and 16 or TABBAR + 12) - th
    setColor(state.toast.err and C.err or C.panel2, math.min(1, state.toastT * 3)); love.graphics.rectangle("fill", PAD, ty, tw, th, 3)
    text(state.toast.msg, F.body, C.fg, PAD + 12, ty + 10, tw - 24)
  end
end

local function clampScroll(key)
  local maxS = math.max(0, (state.contentH[key] or 0) - (state.viewH or love.graphics.getHeight()))
  state.scroll[key] = math.max(0, math.min(maxS, state.scroll[key] or 0))
end
local function currentKey() return state.screen == "login" and "login" or state.tab end

function love.wheelmoved(_, dy)
  local k = currentKey(); state.scroll[k] = (state.scroll[k] or 0) - dy * 40; clampScroll(k)
end

local drag
function love.mousepressed(x, y, b)
  if b ~= 1 then return end
  drag = { x = x, y = y, moved = false }
end
function love.mousemoved(_, y, _, dy)
  if drag and love.mouse.isDown(1) then
    if math.abs(y - drag.y) > 6 then drag.moved = true end
    if drag.moved then local k = currentKey(); state.scroll[k] = (state.scroll[k] or 0) - dy; clampScroll(k) end
  end
end
function love.mousereleased(x, y, b)
  if b ~= 1 or not drag then return end
  local moved = drag.moved; drag = nil
  if moved then return end
  for i = #hits, 1, -1 do
    local h = hits[i]
    if h.fn and x >= h.x and x < h.x + h.w and y >= h.y and y < h.y + h.h then h.fn(); return end
  end
  state.focus = nil
  love.keyboard.setTextInput(false)
end

function love.textinput(t)
  if state.focus then state.fields[state.focus] = state.fields[state.focus] .. t end
end

local order = { "url", "email", "password" }
function love.keypressed(k)
  local ctrl = love.keyboard.isDown("lctrl", "rctrl", "lgui", "rgui")
  if state.focus then
    local v = state.fields[state.focus]
    if k == "backspace" then
      local off = utf8.offset(v, -1)
      if off then state.fields[state.focus] = v:sub(1, off - 1) end
    elseif k == "v" and ctrl then
      state.fields[state.focus] = v .. (love.system.getClipboardText() or ""):gsub("[\r\n]", "")
    elseif k == "tab" then
      for i, f in ipairs(order) do if f == state.focus then state.focus = order[i % #order + 1]; break end end
    elseif k == "return" or k == "kpenter" then
      if state.focus == "url" then connect() else login() end
    elseif k == "escape" then state.focus = nil; love.keyboard.setTextInput(false) end
    return
  end
  if k == "escape" then love.event.quit() end
  if state.screen == "app" then
    if k == "f5" or (k == "r" and ctrl) then load(state.tab) end
    local n = tonumber(k)
    if n and tabs[n] then state.tab = tabs[n][1]; if not state.data[state.tab] then load(state.tab) end end
  end
end

function love.resize() for k in pairs(state.scroll) do clampScroll(k) end end
function love.quit() api.quit() end
