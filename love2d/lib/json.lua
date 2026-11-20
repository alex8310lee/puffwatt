-- Minimal JSON encode/decode (UTF-8, \u escapes incl. surrogate pairs). null -> nil.
local json = {}

local escapes = { ['"'] = '\\"', ['\\'] = '\\\\', ['\b'] = '\\b', ['\f'] = '\\f', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t' }

local function isArray(t)
  local n = 0
  for k in pairs(t) do
    if type(k) ~= "number" or k < 1 or k % 1 ~= 0 then return false end
    n = n + 1
  end
  return n == #t
end

local function encode(v)
  local tv = type(v)
  if v == nil then return "null"
  elseif tv == "boolean" then return tostring(v)
  elseif tv == "number" then
    if v ~= v or v == math.huge or v == -math.huge then return "null" end
    if v % 1 == 0 and math.abs(v) < 2^53 then return string.format("%d", v) end
    return string.format("%.14g", v)
  elseif tv == "string" then
    return '"' .. v:gsub('[%c"\\]', function(c) return escapes[c] or string.format("\\u%04x", c:byte()) end) .. '"'
  elseif tv == "table" then
    local out = {}
    if next(v) ~= nil and isArray(v) then
      for i = 1, #v do out[i] = encode(v[i]) end
      return "[" .. table.concat(out, ",") .. "]"
    end
    for k, val in pairs(v) do out[#out + 1] = encode(tostring(k)) .. ":" .. encode(val) end
    return "{" .. table.concat(out, ",") .. "}"
  end
  error("json: cannot encode " .. tv)
end
json.encode = encode

local function utf8char(cp)
  if cp < 0x80 then return string.char(cp)
  elseif cp < 0x800 then return string.char(0xC0 + math.floor(cp / 0x40), 0x80 + cp % 0x40)
  elseif cp < 0x10000 then return string.char(0xE0 + math.floor(cp / 0x1000), 0x80 + math.floor(cp / 0x40) % 0x40, 0x80 + cp % 0x40)
  end
  return string.char(0xF0 + math.floor(cp / 0x40000), 0x80 + math.floor(cp / 0x1000) % 0x40, 0x80 + math.floor(cp / 0x40) % 0x40, 0x80 + cp % 0x40)
end

function json.decode(s)
  local pos = 1
  local function err(msg) error(string.format("json: %s at %d", msg, pos)) end
  local function ws() pos = s:find("[^ \t\r\n]", pos) or #s + 1 end
  local value
  local function str()
    pos = pos + 1
    local buf = {}
    while true do
      local a, b = s:find('["\\]', pos)
      if not a then err("unterminated string") end
      buf[#buf + 1] = s:sub(pos, a - 1)
      if s:sub(a, a) == '"' then pos = a + 1; break end
      local c = s:sub(a + 1, a + 1)
      if c == "u" then
        local cp = tonumber(s:sub(a + 2, a + 5), 16) or err("bad \\u")
        pos = a + 6
        if cp >= 0xD800 and cp <= 0xDBFF and s:sub(pos, pos + 1) == "\\u" then
          local lo = tonumber(s:sub(pos + 2, pos + 5), 16)
          if lo and lo >= 0xDC00 and lo <= 0xDFFF then cp = 0x10000 + (cp - 0xD800) * 0x400 + (lo - 0xDC00); pos = pos + 6 end
        end
        buf[#buf + 1] = utf8char(cp)
      else
        buf[#buf + 1] = ({ b = "\b", f = "\f", n = "\n", r = "\r", t = "\t" })[c] or c
        pos = a + 2
      end
    end
    return table.concat(buf)
  end
  function value()
    ws()
    local c = s:sub(pos, pos)
    if c == "{" then
      pos = pos + 1; local t = {}
      ws(); if s:sub(pos, pos) == "}" then pos = pos + 1; return t end
      while true do
        ws(); if s:sub(pos, pos) ~= '"' then err("expected key") end
        local k = str(); ws()
        if s:sub(pos, pos) ~= ":" then err("expected ':'") end
        pos = pos + 1; t[k] = value(); ws()
        local d = s:sub(pos, pos); pos = pos + 1
        if d == "}" then return t elseif d ~= "," then err("expected ',' or '}'") end
      end
    elseif c == "[" then
      pos = pos + 1; local t, n = {}, 0
      ws(); if s:sub(pos, pos) == "]" then pos = pos + 1; return t end
      while true do
        n = n + 1; t[n] = value(); ws()
        local d = s:sub(pos, pos); pos = pos + 1
        if d == "]" then return t elseif d ~= "," then err("expected ',' or ']'") end
      end
    elseif c == '"' then return str()
    elseif s:sub(pos, pos + 3) == "true" then pos = pos + 4; return true
    elseif s:sub(pos, pos + 4) == "false" then pos = pos + 5; return false
    elseif s:sub(pos, pos + 3) == "null" then pos = pos + 4; return nil
    else
      local num = s:match("^-?%d+%.?%d*[eE]?[-+]?%d*", pos)
      if not num or num == "" then err("unexpected '" .. c .. "'") end
      pos = pos + #num; return tonumber(num)
    end
  end
  local ok, res = pcall(function() local v = value(); ws(); if pos <= #s then err("trailing data") end; return v end)
  if ok then return res end
  return nil, res
end

return json
