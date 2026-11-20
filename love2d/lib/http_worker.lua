-- Runs in a love.thread so network calls never block the render loop.
local inbox, outbox = ...
require("love.timer")

local function lowerHeaders(h)
  local out = {}
  for k, v in pairs(h or {}) do out[string.lower(k)] = type(v) == "table" and table.concat(v, ", ") or tostring(v) end
  return out
end

local function viaLtn12(http, req, headers)
  local ltn12 = require("ltn12")
  local chunks = {}
  local ok, code, h = http.request {
    url = req.url, method = req.method, headers = headers,
    source = req.body ~= "" and ltn12.source.string(req.body) or nil,
    sink = ltn12.sink.table(chunks),
  }
  if not ok then return nil, tostring(code) end
  return tonumber(code), table.concat(chunks), h
end

local function perform(req)
  local headers = { ["Accept"] = "application/json", ["User-Agent"] = "PUFFWATT-LOVE/1.0" }
  if req.cookie ~= "" then headers["Cookie"] = req.cookie end
  if req.body ~= "" then headers["Content-Type"] = "application/json"; headers["Content-Length"] = tostring(#req.body) end

  if req.url:match("^https://") then
    local ok, https = pcall(require, "https") -- LÖVE 12 built-in
    if ok and https.request then
      local code, body, h = https.request(req.url, { method = req.method, headers = headers, data = req.body ~= "" and req.body or nil })
      if not code or code == 0 then return nil, "HTTPS 연결 실패" end
      return code, body, h
    end
    local ok2, sslhttps = pcall(require, "ssl.https") -- LuaSec, if installed
    if ok2 then return viaLtn12(sslhttps, req, headers) end
    return nil, "HTTPS 서버는 LÖVE 12 이상(또는 LuaSec)이 필요합니다. LÖVE 11에서는 http:// 주소(로컬 서버)를 쓰세요."
  end

  local http = require("socket.http")
  http.TIMEOUT = 10
  return viaLtn12(http, req, headers)
end

while true do
  local req = inbox:demand()
  if req == "quit" then break end
  local ok, code, body, h = pcall(perform, req)
  local res = { id = req.id }
  if not ok then res.err = tostring(code)
  elseif not code then res.err = tostring(body)
  else
    res.status = code
    res.body = body or ""
    res.setcookie = lowerHeaders(h)["set-cookie"] or ""
  end
  outbox:push(res)
end
