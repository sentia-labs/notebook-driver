-- notebook.nvim — the human side of notebook-driver.
--
-- Pages are <home>/notebook/pNNNN.md and hold a fixed number of lines (28 by default). This
-- plugin makes that limit visible while you write, turns pages, speeds up rapid logging (Bullet
-- Journal key in markdown), and talks to `nbd` for questions, sync and rituals. It never
-- touches the vault.

local M = {}

local uv = vim.uv or vim.loop
local ns = vim.api.nvim_create_namespace("notebook")

M.config = {
  home = nil, -- default: $NBD_HOME or ~/notebook
  nbd = nil, -- command to run nbd: "nbd" (default) or { "node", "/path/to/bin/nbd.js" }
  max_lines = nil, -- default: page.maxLines from <home>/nbd.json, else 28
  warn_at = nil, -- default: page.warnAt from nbd.json, else max_lines - 3
  winbar = true, -- page number, fill gauge, questions and rituals in the winbar
  keymaps = true, -- buffer-local <localleader> maps in page buffers
  notify = true, -- vim.notify when a page fills up or overflows
  new_page_heading = "# %Y-%m-%d %a", -- first line of a page made by :NotebookNew (strftime)
  date_heading = "## %Y-%m-%d %a", -- :NotebookDate
  status_poll_ms = 30000,
}

local state = {
  pages = {}, -- bufnr -> { id, num, last_lines }
  status = nil, -- decoded .nbd/status.json
  timer = nil,
}

-- ------------------------------------------------------------------------------ helpers

local function home()
  return M.config.home
end

local function notebook_dir()
  return home() .. "/notebook"
end

local function page_id(num)
  return string.format("p%04d", num)
end

local function read_file(path)
  local fd = io.open(path, "r")
  if not fd then
    return nil
  end
  local data = fd:read("*a")
  fd:close()
  return data
end

local function nbd_cmd(args)
  local base = M.config.nbd or "nbd"
  local cmd = type(base) == "table" and vim.deepcopy(base) or { base }
  vim.list_extend(cmd, args)
  vim.list_extend(cmd, { "--home", home() })
  return cmd
end

--- Run nbd asynchronously; on_done(ok, stdout, stderr) runs on the main loop.
local function nbd(args, opts, on_done)
  opts = opts or {}
  local ok, err = pcall(vim.system, nbd_cmd(args), { text = true, stdin = opts.stdin }, function(res)
    vim.schedule(function()
      if on_done then
        on_done(res.code == 0, res.stdout or "", res.stderr or "")
      end
    end)
  end)
  if not ok then
    vim.notify("notebook: cannot run nbd (" .. tostring(err) .. "). Set opts.nbd.", vim.log.levels.ERROR)
  end
end

local function notify(msg, level)
  if M.config.notify then
    vim.notify(msg, level or vim.log.levels.INFO, { title = "Notebook" })
  end
end

--- All pages as { num, id, path }, in notebook order.
function M.pages()
  local out = {}
  local fs = uv.fs_scandir(notebook_dir())
  if not fs then
    return out
  end
  while true do
    local name, typ = uv.fs_scandir_next(fs)
    if not name then
      break
    end
    local n = name:match("^p(%d%d%d%d+)%.md$")
    if n and (typ == "file" or typ == nil) then
      table.insert(out, { num = tonumber(n), id = page_id(tonumber(n)), path = notebook_dir() .. "/" .. name })
    end
  end
  table.sort(out, function(a, b)
    return a.num < b.num
  end)
  return out
end

function M.current_page()
  local pages = M.pages()
  return pages[#pages]
end

--- The page a buffer holds, or nil.
function M.page_of(buf)
  local name = vim.api.nvim_buf_get_name(buf or 0)
  if name == "" then
    return nil
  end
  name = vim.fs.normalize(name)
  local dir = vim.fs.normalize(notebook_dir())
  local n = name:match("^" .. vim.pesc(dir) .. "/p(%d%d%d%d+)%.md$")
  if not n then
    return nil
  end
  return { num = tonumber(n), id = page_id(tonumber(n)), path = name }
end

local function load_settings()
  local cfg = read_file(home() .. "/nbd.json")
  local ok, data = pcall(vim.json.decode, cfg or "{}")
  data = ok and type(data) == "table" and data or {}
  local page = type(data.page) == "table" and data.page or {}
  M.config.max_lines = M.config.max_lines or page.maxLines or 28
  M.config.warn_at = M.config.warn_at or page.warnAt or (M.config.max_lines - 3)
  local server = type(data.server) == "table" and data.server or {}
  M.config.viewer = M.config.viewer
    or string.format("http://%s:%d", server.host or "127.0.0.1", server.port or 4242)
end

local function read_status()
  local raw = read_file(home() .. "/.nbd/status.json")
  if not raw then
    state.status = nil
    return
  end
  local ok, data = pcall(vim.json.decode, raw)
  state.status = ok and data or nil
end

-- ------------------------------------------------------------------------------ decorations

local function line_count(buf)
  local n = vim.api.nvim_buf_line_count(buf)
  -- An empty buffer still has one (empty) line; a page with nothing on it uses none.
  if n == 1 and vim.api.nvim_buf_get_lines(buf, 0, 1, false)[1] == "" then
    return 0
  end
  return n
end

local function decorate(buf)
  local info = state.pages[buf]
  if not info or not vim.api.nvim_buf_is_valid(buf) then
    return
  end
  local max = M.config.max_lines
  local n = line_count(buf)
  vim.api.nvim_buf_clear_namespace(buf, ns, 0, -1)

  if n >= max then
    vim.api.nvim_buf_set_extmark(buf, ns, max - 1, 0, {
      virt_lines = {
        { { string.format("──── end of page %d · %d/%d lines ────", info.num, n, max), n > max and "NotebookOverflow" or "NotebookPageEnd" } },
      },
    })
  end
  for l = max, n - 1 do
    vim.api.nvim_buf_set_extmark(buf, ns, l, 0, {
      line_hl_group = "NotebookOverflowLine",
      sign_text = "✗",
      sign_hl_group = "NotebookOverflow",
    })
  end

  -- Crossing the limit while writing deserves a nudge, once per crossing.
  local last = info.last_lines
  if last ~= nil and n ~= last then
    if n > max and last <= max then
      notify(string.format("Page %d overflows by %d line%s. Move them to the next page (:NotebookNew).", info.num, n - max, n - max > 1 and "s" or ""), vim.log.levels.ERROR)
    elseif n == max and last < max then
      notify(string.format("Page %d is full (%d/%d). Turn the page with :NotebookNew.", info.num, n, max), vim.log.levels.WARN)
    elseif n >= M.config.warn_at and last < M.config.warn_at then
      notify(string.format("Page %d: %d lines left.", info.num, max - n))
    end
  end
  info.last_lines = n
  if M.config.winbar then
    vim.cmd("redrawstatus!")
  end
end

-- ------------------------------------------------------------------------------ winbar

function M.gauge(n, max, width)
  width = width or 14
  local filled = math.min(width, math.floor(n / max * width + 0.5))
  return string.rep("▰", filled) .. string.rep("▱", width - filled)
end

--- Winbar text for the current window's buffer (exposed for statusline plugins too).
function M.winbar()
  local buf = vim.api.nvim_get_current_buf()
  local info = state.pages[buf]
  if not info then
    return ""
  end
  local max = M.config.max_lines
  local n = line_count(buf)
  local hl = n > max and "NotebookOverflow" or n >= max and "NotebookFull" or n >= M.config.warn_at and "NotebookNear" or "NotebookGauge"
  local parts = {
    "%#NotebookWinbar# 📓 page " .. info.num .. " ",
    "%#" .. hl .. "#" .. M.gauge(n, max) .. string.format(" %d/%d", n, max),
    "%#NotebookWinbar#%=",
  }
  local s = state.status
  if s then
    if s.questions and s.questions.open and s.questions.open > 0 then
      table.insert(parts, "%#NotebookAttention# ? " .. s.questions.open .. " ")
    end
    for _, r in ipairs(s.rituals or {}) do
      if r.due then
        table.insert(parts, "%#NotebookAttention# ⟳ " .. r.kind .. " ")
      end
    end
    if s.ingest and s.ingest.running then
      table.insert(parts, "%#NotebookWinbar# ⋯ agent ")
    end
  end
  return table.concat(parts)
end

--- Short status for statusline components (e.g. lualine): "p42 23/28".
function M.statusline()
  local info = state.pages[vim.api.nvim_get_current_buf()]
  if not info then
    return ""
  end
  return string.format("p%d %d/%d", info.num, line_count(0), M.config.max_lines)
end

local function set_winbar(win)
  if M.config.winbar and vim.api.nvim_win_is_valid(win) then
    vim.wo[win].winbar = "%{%v:lua.require'notebook'.winbar()%}"
  end
end

-- ------------------------------------------------------------------------------ editing

-- Bullet kinds and task states map onto plain markdown (see KEY.md in your notebook home).
local STATE_MARK = { open = " ", started = "/", done = "x", migrated = ">", scheduled = "<", irrelevant = "-" }
local SIGNIFIER = { priority = "*", inspiration = "!", explore = "?", expand = "+" }

--- Split a list line into { indent, marker, rest } (rest has the bullet's own syntax).
local function split_line(line)
  local indent, rest = line:match("^(%s*)[-*+]%s+(.*)$")
  if not indent then
    indent, rest = line:match("^(%s*)(.*)$")
  end
  return indent, rest
end

local function strip_bullet(rest)
  local body = rest:gsub("^%[.%]%s*", "", 1)
  body = body:gsub("^o%s+", "", 1):gsub("^○%s+", "", 1):gsub("^=%s+", "", 1)
  return body
end

local function map_lines(fn, l1, l2)
  local buf = vim.api.nvim_get_current_buf()
  local lines = vim.api.nvim_buf_get_lines(buf, l1 - 1, l2, false)
  for i, line in ipairs(lines) do
    if line:match("%S") then
      lines[i] = fn(line)
    end
  end
  vim.api.nvim_buf_set_lines(buf, l1 - 1, l2, false, lines)
end

function M.set_kind(kind, l1, l2)
  l1 = l1 or vim.fn.line(".")
  l2 = l2 or l1
  map_lines(function(line)
    local indent, rest = split_line(line)
    local body = strip_bullet(rest)
    if kind == "task" then
      return indent .. "- [ ] " .. body
    elseif kind == "event" then
      return indent .. "- o " .. body
    elseif kind == "mood" then
      return indent .. "- = " .. body
    else
      return indent .. "- " .. body
    end
  end, l1, l2)
end

function M.set_state(st, l1, l2)
  local mark = STATE_MARK[st]
  if not mark then
    return vim.notify("notebook: unknown state " .. tostring(st), vim.log.levels.ERROR)
  end
  l1 = l1 or vim.fn.line(".")
  l2 = l2 or l1
  map_lines(function(line)
    local indent, rest = split_line(line)
    local body = rest:match("^%[.%]%s*(.*)$")
    if not body then
      body = strip_bullet(rest)
    end
    return indent .. "- [" .. mark .. "] " .. body
  end, l1, l2)
end

function M.toggle_signifier(name, l1, l2)
  local sym = SIGNIFIER[name]
  l1 = l1 or vim.fn.line(".")
  l2 = l2 or l1
  map_lines(function(line)
    local indent, rest = split_line(line)
    local prefix, body = rest:match("^(%[.%]%s+)(.*)$")
    if not prefix then
      prefix, body = rest:match("^(o%s+)(.*)$")
    end
    if not prefix then
      prefix, body = rest:match("^(=%s+)(.*)$")
    end
    if not prefix then
      prefix, body = "", rest
    end
    local esc = vim.pesc(sym)
    if body:match("^" .. esc .. "%s") then
      body = body:gsub("^" .. esc .. "%s+", "", 1)
    else
      body = sym .. " " .. body
    end
    return indent .. "- " .. prefix .. body
  end, l1, l2)
end

function M.insert_date()
  local text = os.date(M.config.date_heading)
  local row = vim.fn.line(".")
  local cur = vim.api.nvim_get_current_line()
  local lines = cur:match("%S") and { "", text } or { text }
  vim.api.nvim_buf_set_lines(0, row, row, false, lines)
  vim.api.nvim_win_set_cursor(0, { row + #lines, 0 })
end

-- ------------------------------------------------------------------------------ pages

local function open_page(path, at_end)
  vim.cmd.edit(vim.fn.fnameescape(path))
  if at_end then
    vim.cmd("normal! G$")
  end
end

--- Create the next page (exclusive create, so two writers never share a number).
function M.new_page(topic)
  vim.fn.mkdir(notebook_dir(), "p")
  for _ = 1, 5 do
    local cur = M.current_page()
    local num = cur and cur.num + 1 or 1
    local path = notebook_dir() .. "/" .. page_id(num) .. ".md"
    local fd = uv.fs_open(path, "wx", tonumber("644", 8))
    if fd then
      local first = (topic and topic ~= "") and ("# " .. topic) or os.date(M.config.new_page_heading)
      uv.fs_write(fd, first .. "\n")
      uv.fs_close(fd)
      open_page(path)
      vim.api.nvim_buf_set_lines(0, -1, -1, false, { "" })
      vim.cmd("normal! G")
      vim.cmd("startinsert")
      return path
    end
  end
  vim.notify("notebook: could not allocate a page number", vim.log.levels.ERROR)
end

function M.open_current()
  local cur = M.current_page()
  if not cur then
    return M.new_page()
  end
  open_page(cur.path, true)
end

function M.goto_relative(delta)
  local here = M.page_of(0)
  local pages = M.pages()
  if #pages == 0 then
    return
  end
  local idx = #pages
  if here then
    for i, p in ipairs(pages) do
      if p.num == here.num then
        idx = i
      end
    end
  end
  local target = pages[math.max(1, math.min(#pages, idx + delta))]
  if target and (not here or target.num ~= here.num) then
    open_page(target.path)
  end
end

-- ------------------------------------------------------------------------------ nbd integration

function M.sync()
  notify("Asking the agent to ingest…")
  nbd({ "sync" }, nil, function(ok, out, err)
    notify(vim.trim(ok and out or (err ~= "" and err or out)), ok and vim.log.levels.INFO or vim.log.levels.ERROR)
  end)
end

function M.view()
  local page = M.page_of(0)
  read_status()
  local base = (state.status and state.status.url) or M.config.viewer
  vim.ui.open(base .. (page and ("/n/" .. page.id) or "/"))
end

local function parse_question(path)
  local text = read_file(path) or ""
  local fm = text:match("^%-%-%-\n(.-)\n%-%-%-") or ""
  local status = fm:match("\nstatus:%s*([%w-]+)") or fm:match("^status:%s*([%w-]+)") or "open"
  local title = text:match("\n#%s+([^\n]+)") or vim.fn.fnamemodify(path, ":t:r")
  local options = {}
  local opts_block = fm:match("options:%s*\n(.-)\n%w") or fm:match("options:%s*\n(.*)$")
  if opts_block then
    for item in opts_block:gmatch("%s+%-%s+([^\n]+)") do
      table.insert(options, (item:gsub('^"(.*)"$', "%1")))
    end
  end
  local body = text:gsub("^%-%-%-\n.-\n%-%-%-\n?", ""):gsub("\n## Answer.*$", "")
  return { id = vim.fn.fnamemodify(path, ":t:r"), path = path, status = status, title = title, body = body, options = options }
end

function M.open_questions()
  local dir = home() .. "/vault/inbox"
  local qs = {}
  for _, path in ipairs(vim.fn.globpath(dir, "q*.md", false, true)) do
    local q = parse_question(path)
    if q.status == "open" then
      table.insert(qs, q)
    end
  end
  table.sort(qs, function(a, b)
    return a.id < b.id
  end)
  if #qs == 0 then
    return notify("No open questions.")
  end
  vim.ui.select(qs, {
    prompt = "Questions from your notebook agent",
    format_item = function(q)
      return q.id .. "  " .. q.title
    end,
  }, function(q)
    if q then
      M.answer(q)
    end
  end)
end

--- Answer a question in a scratch buffer; :w sends it to nbd.
function M.answer(q)
  if type(q) == "string" then
    q = parse_question(home() .. "/vault/inbox/" .. q .. ".md")
  end
  local buf = vim.api.nvim_create_buf(false, true)
  local lines = {}
  for _, l in ipairs(vim.split(vim.trim(q.body), "\n")) do
    table.insert(lines, "<!-- " .. l .. " -->")
  end
  if #q.options > 0 then
    table.insert(lines, "<!-- options: " .. table.concat(q.options, " | ") .. " -->")
  end
  table.insert(lines, "<!-- Write your answer below and :w to send it (:q to cancel). -->")
  table.insert(lines, "")
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].filetype = "markdown"
  vim.bo[buf].buftype = "acwrite"
  vim.api.nvim_buf_set_name(buf, "notebook://answer/" .. q.id)
  local width = math.min(90, vim.o.columns - 6)
  local height = math.min(#lines + 8, vim.o.lines - 6)
  vim.api.nvim_open_win(buf, true, {
    relative = "editor",
    width = width,
    height = height,
    row = math.floor((vim.o.lines - height) / 2),
    col = math.floor((vim.o.columns - width) / 2),
    border = "rounded",
    title = " " .. q.id .. ": " .. q.title .. " ",
    title_pos = "center",
  })
  vim.api.nvim_win_set_cursor(0, { #lines, 0 })
  vim.api.nvim_create_autocmd("BufWriteCmd", {
    buffer = buf,
    callback = function()
      local answer = {}
      for _, l in ipairs(vim.api.nvim_buf_get_lines(buf, 0, -1, false)) do
        if not l:match("^%s*<!%-%-.*%-%->%s*$") then
          table.insert(answer, l)
        end
      end
      local text = vim.trim(table.concat(answer, "\n"))
      if text == "" then
        return notify("Empty answer — nothing sent.", vim.log.levels.WARN)
      end
      nbd({ "answer", q.id, "-" }, { stdin = text }, function(ok, out, err)
        if ok then
          vim.bo[buf].modified = false
          notify(vim.trim(out))
          pcall(vim.api.nvim_buf_delete, buf, { force = true })
        else
          notify("Answer not saved: " .. vim.trim(err ~= "" and err or out), vim.log.levels.ERROR)
        end
      end)
    end,
  })
end

--- Run a guided ritual (an interactive agent session) in a terminal split.
function M.ritual(kind)
  kind = kind and kind ~= "" and kind or "weekly"
  vim.cmd("botright split | resize " .. math.floor(vim.o.lines * 0.6))
  vim.fn.jobstart(nbd_cmd({ "ritual", kind }), { term = true, cwd = home() })
  vim.cmd("startinsert")
end

-- ------------------------------------------------------------------------------ attach

local function buf_map(buf, lhs, rhs, desc, modes)
  vim.keymap.set(modes or "n", lhs, rhs, { buffer = buf, desc = "Notebook: " .. desc, silent = true })
end

local function range_fn(fn, arg)
  return function()
    local mode = vim.fn.mode()
    if mode == "v" or mode == "V" or mode == "\22" then
      local a, b = vim.fn.line("v"), vim.fn.line(".")
      vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes("<Esc>", true, false, true), "n", false)
      fn(arg, math.min(a, b), math.max(a, b))
    else
      fn(arg)
    end
  end
end

local function attach(buf)
  local page = M.page_of(buf)
  if not page then
    return
  end
  local first = state.pages[buf] == nil
  state.pages[buf] = state.pages[buf] or { num = page.num, id = page.id }
  if first then
    -- gf on [[p0042]] or [[some-note]] opens the page or vault note.
    vim.bo[buf].suffixesadd = ".md"
    vim.bo[buf].path = notebook_dir() .. "," .. home() .. "/vault/**"
    vim.api.nvim_create_autocmd({ "TextChanged", "TextChangedI", "BufWritePost" }, {
      group = "Notebook",
      buffer = buf,
      callback = function()
        decorate(buf)
      end,
    })
    if M.config.keymaps then
      local nv = { "n", "x" }
      buf_map(buf, "<localleader>t", range_fn(M.set_kind, "task"), "make task", nv)
      buf_map(buf, "<localleader>e", range_fn(M.set_kind, "event"), "make event", nv)
      buf_map(buf, "<localleader>n", range_fn(M.set_kind, "note"), "make note", nv)
      buf_map(buf, "<localleader>m", range_fn(M.set_kind, "mood"), "make mood", nv)
      buf_map(buf, "<localleader>x", range_fn(M.set_state, "done"), "task done ×", nv)
      buf_map(buf, "<localleader>>", range_fn(M.set_state, "migrated"), "task migrated >", nv)
      buf_map(buf, "<localleader><", range_fn(M.set_state, "scheduled"), "task scheduled <", nv)
      buf_map(buf, "<localleader>-", range_fn(M.set_state, "irrelevant"), "task irrelevant", nv)
      buf_map(buf, "<localleader>/", range_fn(M.set_state, "started"), "task started /", nv)
      buf_map(buf, "<localleader><Space>", range_fn(M.set_state, "open"), "task open •", nv)
      buf_map(buf, "<localleader>*", range_fn(M.toggle_signifier, "priority"), "signifier * priority", nv)
      buf_map(buf, "<localleader>!", range_fn(M.toggle_signifier, "inspiration"), "signifier ! inspiration", nv)
      buf_map(buf, "<localleader>?", range_fn(M.toggle_signifier, "explore"), "signifier ? explore", nv)
      buf_map(buf, "<localleader>+", range_fn(M.toggle_signifier, "expand"), "signifier + expand later", nv)
      buf_map(buf, "<localleader>d", M.insert_date, "date heading")
      buf_map(buf, "<localleader>N", function() M.new_page() end, "new page")
      buf_map(buf, "<localleader>]", function() M.goto_relative(1) end, "next page")
      buf_map(buf, "<localleader>[", function() M.goto_relative(-1) end, "previous page")
      buf_map(buf, "<localleader>s", M.sync, "sync vault now")
      buf_map(buf, "<localleader>q", M.open_questions, "answer questions")
      buf_map(buf, "<localleader>v", M.view, "open in viewer")
    end
  end
  for _, win in ipairs(vim.fn.win_findbuf(buf)) do
    set_winbar(win)
  end
  decorate(buf)
end

local function detach_win(win)
  if not vim.api.nvim_win_is_valid(win) then
    return
  end
  local buf = vim.api.nvim_win_get_buf(win)
  if not state.pages[buf] and vim.wo[win].winbar:find("notebook", 1, true) then
    vim.wo[win].winbar = ""
  end
end

-- ------------------------------------------------------------------------------ setup

function M.setup(opts)
  M.config = vim.tbl_deep_extend("force", M.config, opts or {})
  M.config.home = vim.fs.normalize(M.config.home or vim.env.NBD_HOME or "~/notebook")
  load_settings()

  local function hl(name, link)
    vim.api.nvim_set_hl(0, name, { link = link, default = true })
  end
  hl("NotebookPageEnd", "NonText")
  hl("NotebookOverflow", "DiagnosticError")
  hl("NotebookOverflowLine", "DiffDelete")
  hl("NotebookWinbar", "WinBar")
  hl("NotebookGauge", "DiagnosticOk")
  hl("NotebookNear", "DiagnosticWarn")
  hl("NotebookFull", "DiagnosticWarn")
  hl("NotebookAttention", "DiagnosticInfo")

  local group = vim.api.nvim_create_augroup("Notebook", { clear = true })
  local pattern = notebook_dir() .. "/p*.md"
  vim.api.nvim_create_autocmd({ "BufReadPost", "BufNewFile", "BufWinEnter" }, {
    group = group,
    pattern = pattern,
    callback = function(ev)
      attach(ev.buf)
    end,
  })
  vim.api.nvim_create_autocmd("BufWinEnter", {
    group = group,
    callback = function()
      detach_win(vim.api.nvim_get_current_win())
    end,
  })
  vim.api.nvim_create_autocmd("BufWipeout", {
    group = group,
    callback = function(ev)
      state.pages[ev.buf] = nil
    end,
  })

  read_status()
  if state.timer then
    state.timer:stop()
  end
  state.timer = uv.new_timer()
  state.timer:start(M.config.status_poll_ms, M.config.status_poll_ms, vim.schedule_wrap(function()
    read_status()
    if next(state.pages) then
      vim.cmd("redrawstatus!")
    end
  end))

  local cmd = vim.api.nvim_create_user_command
  cmd("Notebook", M.open_current, { desc = "Open the current notebook page" })
  cmd("NotebookNew", function(a) M.new_page(a.args) end, { nargs = "?", desc = "Turn the page (optional topic)" })
  cmd("NotebookNext", function() M.goto_relative(1) end, {})
  cmd("NotebookPrev", function() M.goto_relative(-1) end, {})
  cmd("NotebookDate", M.insert_date, { desc = "Insert today's date heading" })
  cmd("NotebookKind", function(a) M.set_kind(a.args, a.line1, a.line2) end, {
    nargs = 1, range = true, complete = function() return { "task", "event", "mood", "note" } end,
  })
  cmd("NotebookMark", function(a) M.set_state(a.args, a.line1, a.line2) end, {
    nargs = 1, range = true,
    complete = function() return { "open", "started", "done", "migrated", "scheduled", "irrelevant" } end,
  })
  cmd("NotebookSignifier", function(a) M.toggle_signifier(a.args, a.line1, a.line2) end, {
    nargs = 1, range = true, complete = function() return { "priority", "inspiration", "explore", "expand" } end,
  })
  cmd("NotebookSync", M.sync, { desc = "Ask the agent to ingest changed pages now" })
  cmd("NotebookQuestions", M.open_questions, { desc = "Answer the agent's questions" })
  cmd("NotebookAnswer", function(a) M.answer(a.args) end, { nargs = 1 })
  cmd("NotebookView", M.view, { desc = "Open this page in the web viewer" })
  cmd("NotebookRitual", function(a) M.ritual(a.args) end, {
    nargs = "?", complete = function() return { "weekly", "monthly", "quarterly", "yearly" } end,
  })
  cmd("NotebookStatus", function()
    nbd({ "status" }, nil, function(_, out, err)
      vim.notify(vim.trim(out ~= "" and out or err), vim.log.levels.INFO, { title = "Notebook" })
    end)
  end, {})

  -- Pages already open when setup runs (e.g. `nvim ~/notebook/notebook/p0042.md`).
  for _, buf in ipairs(vim.api.nvim_list_bufs()) do
    if vim.api.nvim_buf_is_loaded(buf) then
      attach(buf)
    end
  end
end

return M
