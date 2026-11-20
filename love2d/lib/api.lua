-- PUFFWATT REST client: async requests through a worker thread, cookie session persisted to the save dir.
local json = require("lib.json")

local api = { baseUrl = "http://localhost:3000", cookie = "", busy = 0 }
local SAVE = "session.json"
local inbox, outbox, thread
local pending, nextId = {}, 0

function api.init(defaultUrl)
  inbox, outbox = love.thread.newChannel(), love.thread.newChannel()
  thread = love.thread.newThread("lib/http_worker.lua")
  thread:start(inbox, outbox)
  local raw = love.filesystem.getInfo(SAVE) and love.filesystem.read(SAVE)
  local saved = raw and json.decode(raw) or {}
  api.baseUrl = defaultUrl or saved.baseUrl or api.baseUrl
  api.cookie = (saved.baseUrl == api.baseUrl and saved.cookie) or ""
end

function api.save()
  love.filesystem.write(SAVE, json.encode({ baseUrl = api.baseUrl, cookie = api.cookie }))
end

function api.setBaseUrl(url)
  url = (url or ""):gsub("%s+", ""):gsub("/+$", "")
  if not url:match("^https?://") then url = "http://" .. url end
  if url ~= api.baseUrl then api.cookie = "" end
  api.baseUrl = url
  api.save()
end

local function captureCookie(setcookie)
  if not setcookie or setcookie == "" then return end
  local token = setcookie:match("pw_session=([^;,]*)")
  if token == nil then return end
  if token == "" or setcookie:match("pw_session=;.-[Mm]ax%-[Aa]ge=0") then api.cookie = ""
  else api.cookie = "pw_session=" .. token end
  api.save()
end

-- cb(data, err) — err = { status, code, message } on failure
function api.request(method, path, body, cb)
  nextId = nextId + 1
  pending[nextId] = cb or function() end
  api.busy = api.busy + 1
  inbox:push({ id = nextId, method = method, url = api.baseUrl .. path, body = body and json.encode(body) or "", cookie = api.cookie })
end
function api.get(path, cb) api.request("GET", path, nil, cb) end
function api.post(path, body, cb) api.request("POST", path, body or {}, cb) end

function api.update()
  local err = thread:getError()
  if err then error("HTTP worker crashed: " .. err) end
  while true do
    local res = outbox:pop()
    if not res then break end
    api.busy = math.max(0, api.busy - 1)
    local cb = pending[res.id]; pending[res.id] = nil
    if res.err then
      cb(nil, { status = 0, code = "NETWORK", message = res.err })
    else
      captureCookie(res.setcookie)
      local data, perr = json.decode(res.body ~= "" and res.body or "{}")
      if res.status >= 200 and res.status < 300 and not perr then cb(data or {}, nil)
      else
        data = data or {}
        if res.status == 401 then api.cookie = ""; api.save() end
        cb(nil, { status = res.status, code = data.error or "HTTP_" .. res.status, message = data.message or perr or ("HTTP " .. res.status) })
      end
    end
  end
end

function api.quit() if inbox then inbox:push("quit") end end

return api
