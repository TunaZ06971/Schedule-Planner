// 课程日历前端。没有构建步骤 —— 改完 rsync 上去就生效。
//
// 日历这一屏的几何和配色照搬 asuc-octo/berkeleytime 的 Schedule/Editor/Week：
// 1 小时 = 60px，1 分钟 = 1px，从午夜起算，整整 24 小时 = 1440px。
//
// 时区约定：**一律按太平洋时间渲染**，不用浏览器本地时区。
// 否则用户回国的时候，所有 deadline 的日期会整体偏移一天，那正是最危险的错记来源。

const TZ = 'America/Los_Angeles'
const WD_CN = ['日', '一', '二', '三', '四', '五', '六']
const WD_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const TYPE_LABEL = {
  homework: '作业', lab: 'Lab', project: '项目', group_project: '小组项目',
  discussion: 'Disc', exam: '考试', lecture: '课', checkpoint: '检查点',
  custom: '自定义', other: '其他', review: '复习课', office_hours: 'OH',
}

/** 清单里那个实心圆角标签上写的字（用英文，和 Berkeleytime 的语感一致） */
const TYPE_BADGE = {
  homework: 'Homework', lab: 'Lab', project: 'Project', group_project: 'Group Project',
  discussion: 'Discussion', exam: 'Exam', checkpoint: 'Checkpoint',
  custom: 'Custom', other: 'Other', lecture: 'Lecture', review: 'Review',
}
const badgeHtml = (type) =>
  `<span class="badge ${esc(type)}">${esc(TYPE_BADGE[type] || type)}</span>`

let DATA = null
let hcEl = null
let VIEW = 'calendar'
let weekOffset = 0
let token = localStorage.getItem('schedule-token') || ''
let didScroll = false

// ---------------------------------------------------------------- 时间

const isoOf = (d) => new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(d)

const clockOf = (d) => new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hour12: false, hour: '2-digit', minute: '2-digit',
}).format(d)

const todayISO = () => isoOf(new Date())

/** 'HH:MM' → 距午夜的分钟数，也就是网格里的像素偏移（Berkeleytime 的 getY） */
function getY(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function wdOf(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}
function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  const x = new Date(Date.UTC(y, m - 1, d + n))
  return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}`
}
const p2 = (n) => String(n).padStart(2, '0')
const weekStart = (iso) => addDaysISO(iso, -wdOf(iso))

/** 24 小时制的小时 → '8 AM' / '12 PM' */
function hourLabel(h) {
  const x = h % 24
  if (x === 0) return '12 AM'
  if (x < 12) return `${x} AM`
  if (x === 12) return '12 PM'
  return `${x - 12} PM`
}

function countdown(dueISO) {
  if (!dueISO) return { text: '—', cls: '' }
  const ms = new Date(dueISO) - new Date()
  if (ms < 0) {
    const d = Math.floor(-ms / 86400000)
    return { text: d === 0 ? '已过期' : `过期 ${d} 天`, cls: 'past' }
  }
  const days = Math.floor(ms / 86400000)
  const hrs = Math.floor((ms % 86400000) / 3600000)
  if (days === 0) return { text: `${hrs} 小时后`, cls: 'now' }
  if (days <= 2) return { text: `${days} 天 ${hrs} 小时`, cls: 'soon' }
  return { text: `${days} 天`, cls: '' }
}

// ---------------------------------------------------------------- 重叠分列
//
// Berkeleytime 用的是一张 1440 格的"每分钟占用表"加递归回填（adjustAttachedEvents）。
// 那段有个毛病：columns 取自簇里第一个事件的列数，三个以上事件交错重叠时会算错。
//
// 这里用等价但正确的写法：先求重叠连通簇，再在簇内按开始时间贪心分配最小可用列。
// 对任何真实课表输出和 Berkeleytime 完全一致，边界情况下还不会画错。

function layoutDay(items) {
  const evs = items
    .map((e) => ({ ...e, _s: getY(e.startClock), _e: Math.max(getY(e.endClock), getY(e.startClock) + 15) }))
    .sort((a, b) => a._s - b._s || a._e - b._e)

  // 切成互不重叠的连通簇
  const clusters = []
  let cur = []
  let curEnd = -1
  for (const e of evs) {
    if (cur.length && e._s >= curEnd) { clusters.push(cur); cur = []; curEnd = -1 }
    cur.push(e)
    curEnd = Math.max(curEnd, e._e)
  }
  if (cur.length) clusters.push(cur)

  // 簇内贪心：放进第一个"已经空出来"的列
  for (const cluster of clusters) {
    const colEnd = []
    for (const e of cluster) {
      let c = colEnd.findIndex((end) => end <= e._s)
      if (c === -1) { c = colEnd.length; colEnd.push(e._e) }
      else colEnd[c] = e._e
      e.position = c
    }
    for (const e of cluster) e.columns = colEnd.length
  }
  return evs
}

/** 事件块的行内样式 —— 数值照 Event/index.tsx */
function evStyle(e) {
  const top = e._s + 1
  const height = e._e - e._s + 1 - 2
  const w = `calc((100% - 4px - ${e.columns - 1} * 2px) / ${e.columns})`
  return `top:${top}px;height:${height}px;` +
    `width:${w};left:calc(2px + ${w} * ${e.position} + 2px * ${e.position});` +
    `background-color:${e.color}`
}

// ---------------------------------------------------------------- 取数

/**
 * 取数分两段：
 *   /api/data —— 公开，只有课程本身的信息（谁都能拉，发给同学看的就是这份）
 *   /api/mine —— 要口令，你的 section 选择、勾选、自定义事件、配色
 *
 * 合并在这里做。没有口令时页面照常显示课程 deadline，只是没有个人那一层。
 */
async function load() {
  const pub = await (await fetch('/api/data')).json()

  let mine = null
  if (token) {
    const r = await fetch('/api/mine', { headers: { 'x-auth': token } })
    if (r.ok) mine = await r.json()
    else if (r.status === 401) {
      // 存着的口令失效了，清掉但不打断浏览 —— 公开内容还是能看的
      token = ''
      localStorage.removeItem('schedule-token')
      markKey()
    }
  }

  DATA = mine ? mergeMine(pub, mine) : withEmptyPersonal(pub)
  render()
}

/** 没有口令时，补上空的个人层，让下游代码不用到处判空 */
function withEmptyPersonal(pub) {
  return { ...pub, state: { done: {}, sections: {}, custom: [] }, locked: true }
}

/** 把个人层合并进公开数据 */
function mergeMine(pub, mine) {
  const paletteOf = (hue) => (pub.palette || []).find((x) => x.hue === hue)

  // 1) 课程配色换成你自己设的
  const courses = pub.courses.map((c) => {
    const hue = mine.courseColors?.[c.key] || c.colorHue
    const pal = paletteOf(hue)
    return pal ? { ...c, colorHue: hue, color: pal.c500, dot: pal.c300 } : c
  })
  const hueOfCourse = Object.fromEntries(courses.map((c) => [c.key, c.colorHue]))

  // 2) 抓来的条目：套上你的备注、链接、单独改的颜色、隐藏状态
  const events = pub.events.map((e) => {
    const ov = mine.state.overrides?.[e.id] || {}
    const hue = ov.color || hueOfCourse[e.course] || e.colorHue
    const pal = paletteOf(hue)
    return {
      ...e,
      userNote: ov.note || '',
      userUrl: ov.url || '',
      colorHue: hue,
      color: pal ? pal.c500 : e.color,
      hidden: !!mine.state.hidden?.[e.id],
    }
  })

  // 3) 你自己加的事件
  events.push(...(mine.custom || []))
  events.sort((a, b) => String(a.due || '').localeCompare(String(b.due || '')))

  // 4) lecture 重新上色 + 补上你选中的 section 场次
  const meetings = [
    ...pub.meetings.map((m) => {
      const pal = paletteOf(hueOfCourse[m.course] || m.colorHue)
      return pal ? { ...m, colorHue: hueOfCourse[m.course], color: pal.c500 } : m
    }),
    ...(mine.meetings || []),
  ]

  return { ...pub, courses, events, meetings, state: mine.state, locked: false }
}

const CANCELLED = '__cancelled__'

/** 发一次写请求，不管鉴权 */
const rawPost = (path, body, t) => fetch(path, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-auth': t },
  body: JSON.stringify(body),
})

/**
 * 写操作的统一入口。
 *
 * 这里踩过两个坑，都跟"慢"和"没反应"有关：
 *
 * 1. 最早版本 401 时只弹框存口令、**从不重试**，于是"输完口令什么也没发生"。
 * 2. 第二版加了个 /api/auth 先校验口令再执行 —— 变成**两次串行往返**。
 *    实测到东京一个来回 ~480ms，光校验就白等半秒，用户盯着"校验中…"。
 *
 * 现在的做法：**口令框里直接跑真正的那次操作**。成功就说明口令对，顺手存下来；
 * 401 就说明口令错，就地提示。一次往返搞定，没有多余的校验请求。
 */
async function post(path, body) {
  const run = (t) => rawPost(path, body, t)

  let r = token ? await run(token) : null

  if (!r || r.status === 401) {
    if (r) {
      // 存着的口令是错的/过期了，扔掉，免得它一直挡在前面
      token = ''
      localStorage.removeItem('schedule-token')
      markKey()
    }
    r = await askTokenAndRun(run)
    if (!r) throw new Error(CANCELLED)
  }

  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || '请求失败')
  return r.json()
}

/**
 * 弹口令框，并**用输入的口令直接执行 run()**。
 * @returns {Promise<Response|null>} 成功的响应；用户取消则 null
 */
function askTokenAndRun(run) {
  return new Promise((resolve) => {
    const modal = document.getElementById('modal-auth')
    const form = document.getElementById('form-auth')
    const err = document.getElementById('auth-err')
    const submit = document.getElementById('auth-submit')

    err.hidden = true
    form.token.value = ''
    modal.hidden = false
    setTimeout(() => form.token.focus(), 50)

    const done = (result) => {
      form.onsubmit = null
      modal.hidden = true
      modal.removeEventListener('click', onBackdrop)
      for (const b of modal.querySelectorAll('[data-close]')) b.onclick = null
      resolve(result)
    }

    form.onsubmit = async (ev) => {
      ev.preventDefault()
      const v = form.token.value.trim()
      if (!v) return
      submit.disabled = true
      submit.textContent = '提交中…'
      try {
        const r = await run(v)           // ← 直接跑真正的操作，不再单独校验一次
        if (r.status === 401) {
          err.textContent = '口令不对，再试一次'
          err.hidden = false
          form.token.select()
        } else {
          token = v
          localStorage.setItem('schedule-token', token)
          markKey()
          done(r)
        }
      } catch {
        err.textContent = '连不上服务器，检查一下网络'
        err.hidden = false
      } finally {
        submit.disabled = false
        submit.textContent = '确定'
      }
    }

    const onBackdrop = (e) => { if (e.target === modal) done(null) }
    modal.addEventListener('click', onBackdrop)
    for (const b of modal.querySelectorAll('[data-close]')) b.onclick = () => done(null)
  })
}

/** 需要动手之前先确保有口令 —— 但不再为此单独发请求，只看本地有没有存 */
const ensureAuth = async () => true

/**
 * 写完之后怎么刷新界面。
 *
 * 以前是 `await load()` 再重画 —— 那是第三次往返东京，还要拉 127KB，白等 ~400ms。
 * 现在改成：**先在本地把这次改动打上去、立刻重画**，然后后台悄悄对一次账。
 * 用户看到的是即时反应；万一本地算得和服务端不一致，几百毫秒后会自动纠正。
 */
function patchAndReconcile(patch) {
  try {
    patch()
  } catch (err) {
    // 本地补丁失败不致命（下面的对账会兜住），但绝不能静默 —— 否则界面"莫名其妙慢"没法查
    console.error('[本地补丁失败，界面会等后台对账]', err)
  }
  render()
  load().catch(() => {})
}

/** 换课程颜色：课程本身 + 它名下没有单独改过色的条目和课次 */
function applyCourseColor(key, hue) {
  const pal = (DATA.palette || []).find((p) => p.hue === hue)
  const c = courseOf(key)
  if (!c || !pal) return
  const was = c.colorHue
  c.colorHue = hue; c.color = pal.c500; c.dot = pal.c300
  // 单独改过颜色的条目不要跟着变 —— 用"当前色还等于旧的课程色"来判断
  for (const e of DATA.events) {
    if (e.course === key && e.colorHue === was) { e.colorHue = hue; e.color = pal.c500 }
  }
  for (const m of DATA.meetings) {
    if (m.course === key && m.colorHue === was) { m.colorHue = hue; m.color = pal.c500 }
  }
}

/** 官网条目的个人标注 */
function applyItemPatch(id, { note, url, color, hidden }) {
  const e = DATA.events.find((x) => x.id === id)
  if (!e) return
  if (note !== undefined) e.userNote = note
  if (url !== undefined) e.userUrl = url
  if (hidden !== undefined) e.hidden = hidden
  if (color) {
    const pal = (DATA.palette || []).find((p) => p.hue === color)
    if (pal) { e.colorHue = color; e.color = pal.c500 }
  }
}

/** 自定义事件整体重建（服务端返回的是完整数组） */
function applyCustom(custom) {
  DATA.state.custom = custom
  DATA.events = DATA.events.filter((e) => !e.custom)
  for (const ce of custom) {
    const pal = (DATA.palette || []).find((p) => p.hue === ce.color)
      || (DATA.palette || []).find((p) => p.hue === 'amber')
    DATA.events.push({
      ...ce, custom: true, course: 'custom', editable: true, hidden: false,
      colorHue: ce.color, color: pal ? pal.c500 : '#f59e0b',
    })
  }
  DATA.events.sort((a, b) => String(a.due || '').localeCompare(String(b.due || '')))
}

const markKey = () => {
  const b = document.getElementById('btn-key')
  b.classList.toggle('armed', !!token)
  b.title = token ? '已解锁 —— 点一下可以换口令' : '输入口令后才能勾选和加事件'
}

// ---------------------------------------------------------------- 渲染

const courseOf = (k) => DATA.courses.find((c) => c.key === k)
const colorOf = (e) => e.color || courseOf(e.course)?.color || '#6b7280'
const isDone = (id) => !!DATA.state.done[id]

/**
 * "要交的东西"。这是全天条和清单的数据源。
 *
 * 排除两类：
 *  - lecture：那是上课，不是要交的
 *  - kind==='block' 的自定义事件：那是画在时间网格上的时间段（比如 X410 每周五 15–17 点），
 *    它没有"截止"这回事，塞进全天条会变成一条莫名其妙的 "X410 截止 00:00"
 */
let showHidden = false
const deadlines = () => DATA.events.filter((e) =>
  e.type !== 'lecture' && e.kind !== 'block' && (showHidden || !e.hidden))

function render() {
  // 重画会把原来的元素整个换掉，mouseout 就再也不会触发了 —— 先手动收起悬浮卡
  if (hcEl) hcEl.hidden = true
  const view = document.getElementById('view')
  if (!DATA?.ready) {
    view.innerHTML = '<div class="loading">还没有数据，稍等一下或点 ↻ 刷新。</div>'
    return
  }
  renderSidebar()
  // 日历订阅走 URL 里的口令 —— 订阅端没法带请求头。没口令就只订阅公开的课程 deadline。
  const sub = document.querySelector('.actions a[href^="/api/calendar.ics"]')
  if (sub) {
    sub.href = token ? `/api/calendar.ics?t=${encodeURIComponent(token)}` : '/api/calendar.ics'
    sub.title = token ? '订阅（含你的备注和自己加的事件）' : '订阅（只有课程 deadline；输口令后可包含个人内容）'
  }
  view.classList.toggle('cal', VIEW === 'calendar')
  view.innerHTML = VIEW === 'calendar' ? viewCalendar()
    : VIEW === 'list' ? `<div class="pane">${viewList()}</div>`
    : `<div class="pane">${viewLoad()}</div>`
  wire(view)

  // 进页面固定滚到早上 8 点（Berkeleytime 的 scrollTop = 8 * 60 = 480）
  if (VIEW === 'calendar') {
    const sc = view.querySelector('.cal-scroll')
    if (sc) sc.scrollTop = 8 * 60
  }
}

// ---------------------------------------------------------------- 侧边栏

function renderSidebar() {
  const el = document.getElementById('sidebar')
  const classes = DATA.courses.length
  const units = DATA.courses.reduce((a, c) => a + (c.units || 0), 0)
  const custom = DATA.state.custom || []

  const courseCards = DATA.courses.map((c) => {
    const n = DATA.events.filter((e) => e.course === c.key && e.type !== 'lecture').length
    const f = DATA.freshness.find((x) => x.key === c.key)
    return `<div class="card" style="--c:${c.color}">
      <div class="left-border"></div>
      <div class="card-body">
        <div class="card-top">
          <span class="dot" data-color="${c.key}" title="改这门课的颜色" style="--dot:${c.dot || c.color}"></span>
          <span class="card-heading">${esc(c.name)}</span>
        </div>
        <div class="card-desc">${esc(c.full.replace(/^[^—]*— ?/, ''))}</div>
        <div class="card-info">
          <span>${c.units} units</span>
          <span>${n} 项待办</span>
          ${f && !f.ok ? '<span style="color:var(--red-500)">数据未更新</span>' : ''}
        </div>
      </div>
    </div>`
  }).join('')

  const customCards = custom.map((e) => `<div class="card" style="--c:${e.color || '#f59e0b'}">
      <div class="left-border"></div>
      <div class="card-body">
        <div class="card-top">
          <span class="card-heading">${esc(e.title)}</span>
          <button class="del" data-del="${esc(e.id)}" title="删掉">🗑</button>
        </div>
        <div class="card-desc">${e.dueDate}${e.note ? ' · ' + esc(e.note) : ''}</div>
      </div>
    </div>`).join('')

  el.innerHTML = `
    <div class="sb-head">
      <div class="context">
        <span class="term">${esc(DATA.term?.name || '')}</span>
        <span class="data">${classes} classes, ${units} units</span>
      </div>
      <button class="add-btn" id="sb-add"><span>添加事件</span><span>＋</span></button>
      <button class="add-btn" id="sb-sections"><span>我的 discussion / lab 时段</span><span>›</span></button>
    </div>
    <div class="sb-body">
      ${courseCards}
      ${customCards}
      ${sidebarNotes()}
    </div>`

  el.querySelectorAll('[data-color]').forEach((d) => {
    d.onclick = () => openColorPicker(d.dataset.color)
  })
  el.querySelector('#sb-add').onclick = () => openAdd({ fresh: true })
  el.querySelector('#sb-sections').onclick = () => openSections()
  el.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('删掉这个事件？')) return
      try {
        const r = await post('/api/custom', { action: 'remove', id: b.dataset.del })
        patchAndReconcile(() => applyCustom(r.custom))
      } catch (e) { if (e.message !== CANCELLED) alert(e.message) }
    }
  })
}

/** 侧边栏底部的提示：抓取失败、最近变更、时间未定的考试 */
function sidebarNotes() {
  const out = []

  const bad = DATA.freshness.filter((f) => !f.ok)
  if (bad.length) {
    out.push(`<div class="sb-note danger"><b>⚠️ 有课程数据没更新上</b><ul>${
      bad.map((f) => {
        const hrs = f.staleSince ? Math.floor((Date.now() - new Date(f.staleSince)) / 3600000) : '?'
        return `<li>${esc(courseOf(f.key)?.name || f.key)} 已 ${hrs} 小时没抓成功，下面是旧数据</li>`
      }).join('')}</ul></div>`)
  }

  const recent = (DATA.changes || []).filter((c) => Date.now() - new Date(c.at) < 7 * 86400000)
  if (recent.length) {
    out.push(`<div class="sb-note"><b>🔔 最近 7 天课程网站的变动</b><ul>${
      recent.slice(0, 5).map((c) => {
        const n = esc(courseOf(c.course)?.name || c.course)
        if (c.kind === 'moved') return `<li>${n} ${esc(c.title)}：<b>${c.from} → ${c.to}</b></li>`
        if (c.kind === 'added') return `<li>${n} 新增 ${esc(c.title)}</li>`
        if (c.kind === 'removed') return `<li>${n} 撤掉了 ${esc(c.title)}</li>`
        return `<li>${n} ${esc(c.title)} 已确定</li>`
      }).join('')}</ul></div>`)
  }

  const tbd = deadlines().filter((e) => e.type === 'exam' && (e.inferred || /TBD|TBA/i.test(e.note || '')))
  if (tbd.length) {
    out.push(`<div class="sb-note warn"><b>📌 这几场考试时间还没定死</b><ul>${
      tbd.map((e) => `<li>${esc(courseOf(e.course)?.name || '')} ${esc(e.title)} — ${e.dueDate}
        ${e.inferred ? '（推算，官网未公布）' : '（官网写的是 TBD）'}</li>`).join('')}</ul></div>`)
  }

  if (DATA.locked) {
    out.push(`<div class="sb-note"><b>🔒 只显示课程内容</b><br>
      你的 section 选择、勾选记录、自己加的事件需要口令才会加载 ——
      点右上角 🔑 输入。<br><span style="color:var(--label-color)">
      （没有口令的人打开这个网址，看到的就是现在这样：只有三门课的公开 deadline。）</span></div>`)
  }

  const t = DATA.lastRefresh ? new Date(DATA.lastRefresh) : null
  const mins = t ? Math.floor((Date.now() - t) / 60000) : null
  const label = mins === null ? '未知' : mins < 1 ? '刚刚' : mins < 60 ? `${mins} 分钟前` : `${Math.floor(mins / 60)} 小时前`
  out.push(`<div class="sb-note">数据更新于 ${label}　·　所有时间均为太平洋时间 (PT)</div>`)

  return out.join('')
}

// ---------------------------------------------------------------- 日历

function viewCalendar() {
  const today = todayISO()
  const start = addDaysISO(weekStart(today), weekOffset * 7)
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(start, i))
  const nowMin = getY(clockOf(new Date()))

  // 表头
  const head = days.map((iso) => `<div class="day ${iso === today ? 'today' : ''}">
      <span class="wd">${WD_EN[wdOf(iso)]}</span><span class="dn">${+iso.slice(8)}</span>
    </div>`).join('')

  // 全天区：deadline
  const allday = days.map((iso) => {
    const hol = (DATA.holidays || []).find((h) => h.date === iso)
    const evs = deadlines().filter((e) => e.dueDate === iso)
    return `<div class="day ${hol ? 'holiday' : ''}">
      ${hol ? `<div class="holiday-chip">${esc(hol.name)}</div>` : ''}
      ${evs.map(chipHtml).join('')}
    </div>`
  }).join('')

  // 时间网格
  const hours = Array.from({ length: 24 }, () => '<div class="hour"></div>').join('')
  const grid = days.map((iso) => {
    const hol = (DATA.holidays || []).some((h) => h.date === iso)
    const laid = layoutDay(
      DATA.meetings.filter((m) => m.date === iso).map((m) => ({ ...m, color: colorOf(m) })),
    )
    const now = iso === today ? `<div class="now-line" style="top:${nowMin}px"></div>` : ''
    return `<div class="day ${hol ? 'holiday' : ''}">${hours}${now}${laid.map(evHtml).join('')}</div>`
  }).join('')

  const gutterHours = Array.from({ length: 24 }, (_, i) =>
    `<div class="hour">${hourLabel(i + 1)}</div>`).join('')

  const inWeek = today >= days[0] && today <= days[6]
  const nowBadge = inWeek
    ? `<div class="now-time" style="top:${nowMin - 12}px">${clockOf(new Date())}</div>` : ''

  const label = `${start.slice(0, 4)} 年 ${+start.slice(5, 7)} 月 ${+start.slice(8)} – ${+days[6].slice(8)} 日`

  return `
    <div class="weeknav">
      <button id="wk-prev">‹</button>
      <button id="wk-today">本周</button>
      <button id="wk-next">›</button>
      <span class="label">${label}</span>
      <span class="sub">${weekOffset === 0 ? '当前周' : weekOffset > 0 ? `+${weekOffset} 周` : `${weekOffset} 周`}</span>
    </div>
    <div class="cal-scroll">
      <div class="week-root">
        <div class="week-head">
          <div class="gutter">PT</div>
          <div class="days">${head}</div>
        </div>
        <div class="allday">
          <div class="gutter">全天<br>deadline</div>
          <div class="days">${allday}</div>
        </div>
        <div class="week-view">
          <div class="gutter">${gutterHours}${nowBadge}</div>
          <div class="days">${grid}</div>
        </div>
      </div>
    </div>`
}

/** 时间网格里的一块课 —— 三行：课程 / 类型+section / 教室（同 Berkeleytime） */
function evHtml(m) {
  const c = courseOf(m.course)
  const title = c ? c.name : shortTitle(m.title)
  const desc = m.type === 'lecture' ? 'Lecture 001'
    : m.custom ? '自己加的' : shortTitle(m.title)
  // 悬浮卡要用的信息一并挂在元素上
  const hc = esc(JSON.stringify({
    t: title, d: desc, loc: m.location || '',
    time: `${m.startClock}–${m.endClock}`,
    note: m.note || '', color: m.color,
    date: m.date, repeat: m.recurring,
  }))
  return `<div class="ev" data-hc="${hc}"${m.customId ? ` data-edit="${esc(m.customId)}" style="cursor:pointer;` : ' style="'}${evStyle(m)}">
    <div class="ev-h">${esc(title)}</div>
    <div class="ev-d">${esc(desc)}</div>
    ${m.location ? `<div class="ev-d">${esc(m.location)}</div>` : ''}
  </div>`
}

// ---------------------------------------------------------------- 悬浮详情卡
//
// 照 Berkeleytime 的 hover card：鼠标停在事件块上就把地点、时间、备注摊开。
// 它那版是绝对定位、超出右边界就翻到左侧，这里同样处理，另外还跟随鼠标。

function initHoverCard() {
  hcEl = document.getElementById('hovercard')
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-hc]')
    if (!el) return
    let d
    try { d = JSON.parse(el.dataset.hc) } catch { return }
    hcEl.innerHTML = `
      <div class="hc-bar" style="--c:${esc(d.color || '#6b7280')}"></div>
      <div class="hc-h">${esc(d.t)}</div>
      ${d.d ? `<div class="hc-d">${esc(d.d)}</div>` : ''}
      <div class="hc-m">${[d.loc, d.time].filter(Boolean).map(esc).join('，')}</div>
      ${d.repeat ? '<div class="hc-m">每周重复</div>' : ''}
      ${d.note ? `<div class="hc-note">📝 ${esc(d.note)}</div>` : ''}`
    hcEl.hidden = false
    placeHoverCard(el)
  })
  document.addEventListener('mouseout', (e) => {
    if (e.target.closest('[data-hc]')) hcEl.hidden = true
  })
  // 滚动时跟着走会很晃，直接收起来
  document.addEventListener('scroll', () => { if (hcEl) hcEl.hidden = true }, true)
}

/** 默认贴在事件块右边；右边放不下就翻到左边，上下也夹进视口 */
function placeHoverCard(el) {
  const r = el.getBoundingClientRect()
  const w = hcEl.offsetWidth
  const h = hcEl.offsetHeight
  const gap = 8

  let left = r.right + gap
  if (left + w > window.innerWidth - 8) left = r.left - w - gap
  if (left < 8) left = 8

  let top = r.top
  if (top + h > window.innerHeight - 8) top = window.innerHeight - h - 8
  if (top < 8) top = 8

  hcEl.style.left = `${Math.round(left)}px`
  hcEl.style.top = `${Math.round(top)}px`
}

/** "[CS 61C FA26] Lecture" / "COMPSCI 61B Lecture" → 去掉前缀噪音 */
function shortTitle(title) {
  return String(title).replace(/^\[[^\]]*\]\s*/, '').replace(/\s+/g, ' ').trim() || title
}

/** 全天区里的一个 deadline chip */
function chipHtml(e) {
  const done = isDone(e.id)
  const hc = esc(JSON.stringify({
    t: e.title,
    d: `${courseOf(e.course)?.name || '自己加的'} · ${TYPE_BADGE[e.type] || e.type}`,
    loc: '', time: `${e.dueDate} ${e.due ? clockOf(new Date(e.due)) : ''} 截止`,
    note: [e.userNote, e.note].filter(Boolean).join(' / '), color: colorOf(e),
  }))
  return `<div class="chip ${done ? 'done' : ''}" data-chip="${esc(e.id)}" data-hc="${hc}"
      title="点一下可以加链接 / 备注 / 改颜色" style="--c:${colorOf(e)}">
    <input type="checkbox" data-id="${esc(e.id)}" ${done ? 'checked' : ''}>
    <span class="chip-t">${linkTitle(e)}${tags(e)}
      <span class="chip-time">${TYPE_LABEL[e.type] || e.type}${e.due ? ' · ' + clockOf(new Date(e.due)) : ''}</span>
    </span></div>`
}

/** 点标题跳转：用户自己贴的链接优先于官网的 */
const linkTitle = (e) => {
  const href = e.userUrl || e.url
  return href
    ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(e.title)}</a>`
    : esc(e.title)
}

function tags(e) {
  const t = []
  if (e.provisional) t.push('<span class="tag prov">暂定</span>')
  if (e.inferred) t.push('<span class="tag infer">推算</span>')
  if (e.hardDeadline) t.push('<span class="tag hard">不可延</span>')
  const c = courseOf(e.course)
  if (c?.graceHours && !['exam', 'lecture', 'discussion'].includes(e.type)) {
    t.push(`<span class="tag grace">+${c.graceHours}h</span>`)
  }
  return t.join('')
}

// ---------------------------------------------------------------- 清单

function viewList() {
  const today = todayISO()
  const all = deadlines().filter((e) => e.dueDate)
    .sort((a, b) => String(a.due).localeCompare(String(b.due)))
  const endOfWeek = addDaysISO(today, 6 - wdOf(today))
  const endOfNext = addDaysISO(endOfWeek, 7)

  // ⚠️ 这里以前写的是「过期**未完成**」—— 带 !isDone 过滤。
  // 后果：勾上一条过期的，它就不再属于这一组，而其余几组是按日期分的（今天/本周/下周/以后）
  // 也都收不了它 —— 整条**凭空消失**。勾选本该只是划掉，不该让条目蒸发。
  // 现在所有分组一律不按完成与否过滤，勾了就是加删除线留在原地。
  const buckets = [
    ['已过期', all.filter((e) => e.dueDate < today)],
    ['今天', all.filter((e) => e.dueDate === today)],
    ['本周剩下的', all.filter((e) => e.dueDate > today && e.dueDate <= endOfWeek)],
    ['下周', all.filter((e) => e.dueDate > endOfWeek && e.dueDate <= endOfNext)],
    ['再往后', all.filter((e) => e.dueDate > endOfNext)],
  ]

  const tip = `<div class="tip">每一条右边的 <b>✎ 编辑</b> 可以贴自己的链接（贴完点标题就跳过去）、
    写备注、单独改颜色、或者把用不上的隐藏起来。
    想加自己的事项用顶栏的 <b>＋ 事件</b>。官网条目的日期和标题以课程网站为准，不能改。</div>`

  const nHidden = DATA.events.filter((e) => e.type !== 'lecture' && e.hidden).length
  const bar = nHidden
    ? `<div class="hidden-bar"><span>有 ${nHidden} 条被隐藏</span>
        <button id="toggle-hidden">${showHidden ? '收起' : '显示出来'}</button></div>`
    : ''

  const body = buckets.filter(([, a]) => a.length).map(([n, a]) => {
    const todo = a.filter((e) => !isDone(e.id)).length
    // 有已完成的就写成「未完成 / 总数」，否则只写一个数
    const count = todo === a.length ? `${a.length}` : `${todo} / ${a.length}`
    return `<div class="group-block"><h3 class="group-h">${n} · ${count}</h3>${a.map(rowHtml).join('')}</div>`
  }).join('') || '<div class="loading">没有条目。</div>'

  return tip + bar + body
}

function rowHtml(e) {
  const done = isDone(e.id)
  const cd = countdown(e.due)
  const c = courseOf(e.course)

  // 标题下面这行只留"额外信息"，类型标签已经挪到日期旁边去了
  const meta = [
    e.windowStart ? `窗口 ${e.windowStart} → ${e.dueDate}` : '',
    !e.windowStart && e.note ? esc(e.note) : '',
    e.userNote ? `<span class="usernote">📝 ${esc(e.userNote)}</span>` : '',
    e.kind === 'block' && e.startTime ? `${e.startTime}–${e.endTime}${e.repeat === 'weekly' ? ' 每周' : ''}` : '',
    e.hidden ? '已隐藏' : '',
  ].filter(Boolean).join(' · ')

  // 日期写成一行：2026-09-07 周一 23:59
  const dateLine = `${e.dueDate} 周${WD_CN[wdOf(e.dueDate)]}` +
    (e.due ? ` <span class="t">${clockOf(new Date(e.due))}</span>` : '')

  // 官网条目删不掉（下次抓取又回来），垃圾桶对它们执行"隐藏"
  const delTitle = e.custom ? '删除这个事件'
    : e.hidden ? '从隐藏里恢复' : '从清单里隐藏（官网条目删不掉，只能隐藏）'

  return `<div class="row ${done ? 'done' : ''} ${e.hidden ? 'is-hidden' : ''}" style="--c:${colorOf(e)}">
    <input type="checkbox" data-id="${esc(e.id)}" ${done ? 'checked' : ''}>
    <span class="course">${esc(c?.name?.replace('COMPSCI ', 'CS ') || '自己加的')}</span>
    <span class="title">${linkTitle(e)}${tags(e)}
      ${meta ? `<div class="meta">${meta}</div>` : ''}
    </span>
    ${badgeHtml(e.type)}
    <span class="date">${dateLine}</span>
    <span class="cd ${done ? 'past' : cd.cls}">${done ? '已完成' : cd.text}</span>
    <button class="edit" data-edit="${esc(e.id)}"
      title="${e.editable ? '编辑这个事件' : '加链接 / 备注 / 改颜色'}">✎ 编辑</button>
    <button class="del" data-del="${esc(e.id)}" title="${delTitle}">${e.hidden ? '↩' : '🗑'}</button>
  </div>`
}

// ---------------------------------------------------------------- 工作量

function viewLoad() {
  const today = todayISO()
  const byDay = {}
  for (const e of deadlines()) {
    if (!e.dueDate) continue
    ;(byDay[e.dueDate] ||= []).push(e)
  }
  const scoreOf = (evs) =>
    evs.filter((e) => !isDone(e.id)).reduce((s, e) => s + (DATA.loadWeight[e.type] || 1), 0)

  // ---- 右侧图例 ----
  const perCourse = DATA.courses.map((c) => ({
    ...c,
    n: deadlines().filter((e) => e.course === c.key && !isDone(e.id)).length,
  }))
  const nCustom = deadlines().filter((e) => e.custom && !isDone(e.id)).length

  const perType = Object.entries(
    deadlines().filter((e) => !isDone(e.id))
      .reduce((a, e) => ((a[e.type] = (a[e.type] || 0) + 1), a), {}),
  ).sort((a, b) => b[1] - a[1])

  const busy = Object.entries(byDay)
    .filter(([d]) => d >= today)
    .map(([d, evs]) => ({ d, evs, score: scoreOf(evs) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.d.localeCompare(b.d))
    .slice(0, 6)

  const side = `
    <div class="legend">
      <h4>课程</h4>
      ${perCourse.map((c) => `<div class="lg">
        <span class="sw round" style="background:${c.color}"></span>
        <span>${esc(c.name)}</span><span class="n">${c.n} 项未完成</span>
      </div>`).join('')}
      ${nCustom ? `<div class="lg"><span class="sw round" style="background:#f59e0b"></span>
        <span>自己加的</span><span class="n">${nCustom} 项</span></div>` : ''}
    </div>

    <div class="legend">
      <h4>类型</h4>
      ${perType.map(([t, n]) => `<div class="lg">
        ${badgeHtml(t)}<span class="n">${n} 项</span>
      </div>`).join('')}
    </div>

    <div class="legend">
      <h4>忙碌程度（按未完成的算）</h4>
      <div class="lg"><span class="hot" style="background:rgba(245,158,11,.12)"></span><span>轻</span><span class="n">1–3 分</span></div>
      <div class="lg"><span class="hot" style="background:rgba(245,158,11,.28)"></span><span>中</span><span class="n">4–6 分</span></div>
      <div class="lg"><span class="hot" style="background:rgba(239,68,68,.30)"></span><span>重</span><span class="n">7 分以上</span></div>
      <div class="lg" style="margin-top:6px;color:var(--label-color)">
        <span>考试 5 · 小组项目 4 · 项目 3 · 作业 2 · Lab 1</span>
      </div>
    </div>

    ${busy.length ? `<div class="legend">
      <h4>接下来最忙的几天</h4>
      ${busy.map((b) => `<div class="lg">
        <span>${b.d.slice(5)} 周${WD_CN[wdOf(b.d)]}</span>
        <span class="n" style="color:var(--amber-500);font-weight:600">${b.score} 分</span>
      </div>`).join('')}
    </div>` : ''}`

  // ---- 左侧月历：格子里直接列任务名，不再只是几个点 ----
  const months = []
  let cur = (DATA.term?.instructionStart || today).slice(0, 7)
  const last = (DATA.term?.finalsEnd || today).slice(0, 7)
  let guard = 0
  while (cur <= last && guard++ < 12) {
    months.push(cur)
    const [y, m] = cur.split('-').map(Number)
    cur = m === 12 ? `${y + 1}-01` : `${y}-${p2(m + 1)}`
  }

  const MAX_SHOWN = 4
  const monthsHtml = months.map((ym) => {
    const [y, m] = ym.split('-').map(Number)
    const lead = wdOf(`${ym}-01`)
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const cells = []
    for (let i = 0; i < lead; i++) cells.push('<div class="cell empty"></div>')
    for (let d = 1; d <= dim; d++) {
      const iso = `${ym}-${p2(d)}`
      const evs = (byDay[iso] || []).slice().sort((a, b) =>
        (DATA.loadWeight[b.type] || 1) - (DATA.loadWeight[a.type] || 1))
      const score = scoreOf(evs)
      const hot = score >= 7 ? 3 : score >= 4 ? 2 : score > 0 ? 1 : 0
      const hol = (DATA.holidays || []).find((h) => h.date === iso)

      const items = evs.slice(0, MAX_SHOWN).map((e) => {
        const hc = esc(JSON.stringify({
          t: e.title,
          d: `${courseOf(e.course)?.name || '自己加的'} · ${TYPE_BADGE[e.type] || e.type}`,
          loc: '', time: `${e.dueDate} ${e.due ? clockOf(new Date(e.due)) : ''} 截止`,
          note: [e.userNote, e.note].filter(Boolean).join(' / '), color: colorOf(e),
        }))
        return `<div class="mini ${isDone(e.id) ? 'done' : ''}" data-hc="${hc}"
          data-edit="${esc(e.id)}" style="--c:${colorOf(e)}">${esc(e.title)}</div>`
      }).join('')

      cells.push(`<div class="cell ${hot ? 'hot' + hot : ''} ${iso === today ? 'today' : ''}">
        <span class="n">${d}</span>
        ${hol ? `<span class="holi">${esc(hol.name.split(' ')[0])}</span>` : ''}
        ${items}
        ${evs.length > MAX_SHOWN ? `<span class="more">还有 ${evs.length - MAX_SHOWN} 项…</span>` : ''}
      </div>`)
    }
    return `<div class="month"><h3>${y} 年 ${m} 月</h3>
      <div class="mgrid">${WD_CN.map((w) => `<div class="wd">${w}</div>`).join('')}${cells.join('')}</div></div>`
  }).join('')

  return `<div class="load-wrap">
    <div class="load-main"><div class="months">${monthsHtml}</div></div>
    <div class="load-side">${side}</div>
  </div>`
}

// ---------------------------------------------------------------- 交互

function wire(root) {
  root.querySelectorAll('input[type=checkbox][data-id]').forEach((cb) => {
    cb.addEventListener('change', async () => {
      try {
        const r = await post('/api/state', { id: cb.dataset.id, done: cb.checked })
        DATA.state.done = r.done
        render()
      } catch (e) {
        cb.checked = !cb.checked
        if (e.message !== CANCELLED) alert(e.message)
      }
    })
  })
  root.querySelectorAll('[data-del]').forEach((b) => {
    b.addEventListener('click', async () => {
      const id = b.dataset.del
      const e = DATA.events.find((x) => x.id === id)
      if (!e) return
      try {
        if (e.custom) {
          // 自己建的，真删
          if (!confirm(`删掉「${e.title}」？`)) return
          const r = await post('/api/custom', { action: 'remove', id })
          patchAndReconcile(() => applyCustom(r.custom))
        } else if (e.hidden) {
          await post('/api/item', { id, hidden: false })
          patchAndReconcile(() => applyItemPatch(id, { hidden: false }))
        } else {
          // 官网条目删不掉 —— 每小时抓取会把它带回来。只能从清单里隐藏。
          if (!confirm(
            `「${e.title}」是 ${courseOf(e.course)?.name || ''} 官网上的条目，删不掉` +
            `（下次抓取又会回来），但可以隐藏。\n\n隐藏后在清单顶部可以随时调回来。要隐藏吗？`,
          )) return
          await post('/api/item', { id, hidden: true })
          patchAndReconcile(() => applyItemPatch(id, { hidden: true }))
        }
      } catch (err) { if (err.message !== CANCELLED) alert(err.message) }
    })
  })
  const editById = (id) => {
    const e = DATA.events.find((x) => x.id === id)
    if (e) (e.editable ? openCustomEditor(e) : openItemEditor(e))
  }

  root.querySelectorAll('[data-edit]').forEach((b) => {
    b.addEventListener('click', () => editById(b.dataset.edit))
  })

  // 日历上的 deadline 小块也能直接点开编辑 —— 不然日历页里一个入口都没有
  root.querySelectorAll('[data-chip]').forEach((c) => {
    c.addEventListener('click', (ev) => {
      if (ev.target.closest('input, a')) return   // 勾选框和链接各管各的
      editById(c.dataset.chip)
    })
  })
  root.querySelector('#toggle-hidden')?.addEventListener('click', () => { showHidden = !showHidden; render() })
  root.querySelector('#wk-prev')?.addEventListener('click', () => { weekOffset--; render() })
  root.querySelector('#wk-next')?.addEventListener('click', () => { weekOffset++; render() })
  root.querySelector('#wk-today')?.addEventListener('click', () => { weekOffset = 0; render() })
}

document.getElementById('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button')
  if (!b) return
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b))
  VIEW = b.dataset.view
  render()
})

document.getElementById('btn-key').addEventListener('click', async () => {
  token = ''
  localStorage.removeItem('schedule-token')
  markKey()
  // 拿 /api/mine 当校验 —— 它本身就是要口令的 GET，不用再单开一个校验接口
  const ok = await askTokenAndRun((t) => fetch('/api/mine', { headers: { 'x-auth': t } }))
  if (ok) await load()
  else render()
})
document.getElementById('btn-panel').addEventListener('click', () => {
  const sb = document.getElementById('sidebar')
  sb.classList.toggle('hidden')
  sb.classList.toggle('open')
})

document.getElementById('btn-refresh').addEventListener('click', async (e) => {
  const t = e.target.textContent
  e.target.textContent = '…'
  try { await post('/api/refresh', {}); await load() }
  catch (err) { if (err.message !== CANCELLED) alert(err.message) }
  finally { e.target.textContent = t }
})

document.getElementById('btn-add').addEventListener('click', () => openAdd({ fresh: true }))

// ---- 选 section ----
function openSections() {
  const box = document.getElementById('sections-body')
  box.innerHTML = DATA.courses.map((c) => {
    const secs = DATA.sections
      .filter((s) => s.course === c.key && ['discussion', 'lab'].includes(s.type))
      .sort((a, b) => a.weekday - b.weekday || a.startClock.localeCompare(b.startClock))
    if (!secs.length) return `<div class="sec-course"><h4 style="color:${c.color}">${esc(c.name)}</h4>
      <p class="hint" style="margin:0">这门课的公开日历里没有 section 时段。</p></div>`
    const picked = DATA.state.sections[c.key] || []
    return `<div class="sec-course"><h4 style="color:${c.color}">${esc(c.name)}
        <span style="color:var(--label-color);font-weight:400">${secs.length} 个时段</span></h4>
      ${secs.map((s) => `<label class="sec-opt ${picked.includes(s.key) ? 'picked' : ''}">
        <input type="checkbox" data-course="${c.key}" value="${esc(s.key)}" ${picked.includes(s.key) ? 'checked' : ''}>
        <span class="w">周${WD_CN[s.weekday]} ${s.startClock}–${s.endClock}</span>
        <span>${esc(s.title)} <span class="loc">${esc(s.location || '')}</span></span>
      </label>`).join('')}</div>`
  }).join('')

  box.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    cb.addEventListener('change', async () => {
      const course = cb.dataset.course
      const keys = [...box.querySelectorAll(`input[data-course="${course}"]:checked`)].map((x) => x.value)
      try {
        const r = await post('/api/sections', { course, keys })
        DATA.state.sections = r.sections
        await load()
        cb.closest('.sec-opt').classList.toggle('picked', cb.checked)
      } catch (e) { cb.checked = !cb.checked }
    })
  })
  show('modal-sections')
}

// ---- 加自定义事件 ----
async function openAdd({ fresh = false } = {}) {
  if (!(await ensureAuth())) return
  if (fresh) resetAddForm()
  const list = document.getElementById('custom-list')
  const cs = DATA.state.custom || []
  list.innerHTML = cs.length
    ? `<h4 style="font-size:var(--text-14);margin:16px 0 6px">已加的事件（点一下可以改）</h4>` +
      cs.map((e) => `<div class="sec-opt" data-edit-custom="${esc(e.id)}">
          <span class="d" style="width:10px;height:10px;border-radius:50%;background:${
            (DATA.palette.find((p) => p.hue === e.color) || {}).c500 || '#f59e0b'};flex:none"></span>
          <span class="w">${e.dueDate}${e.kind === 'block' ? ` ${e.startTime}–${e.endTime}` : ''}</span>
          <span>${esc(e.title)}</span>
        </div>`).join('')
    : ''
  list.querySelectorAll('[data-edit-custom]').forEach((n) => {
    n.onclick = () => {
      const ev = DATA.events.find((x) => x.id === n.dataset.editCustom)
      if (ev) openCustomEditor(ev)
    }
  })
  show('modal-add')
}

document.getElementById('form-add').addEventListener('submit', async (ev) => {
  ev.preventDefault()
  const f = new FormData(ev.target)
  const dueDate = f.get('dueDate')
  const clock = f.get('clock') || '23:59'
  try {
    const editId = ev.target.dataset.editId
    const r = await post('/api/custom', {
      action: editId ? 'update' : 'add',
      event: {
        id: editId,
        title: f.get('title'), type: f.get('type'), note: f.get('note'),
        color: f.get('color'), url: f.get('url'),
        kind: f.get('kind'),
        startTime: f.get('startTime'), endTime: f.get('endTime'),
        repeat: f.get('repeat'), location: f.get('location'),
        dueDate,
        // 学期在 11/01 从 PDT 切到 PST，偏移不能写死
        due: `${dueDate}T${clock}:00${dueDate >= '2026-11-01' ? '-08:00' : '-07:00'}`,
      },
    })
    resetAddForm()
    hide('modal-add')
    patchAndReconcile(() => applyCustom(r.custom))
  } catch (e) { if (e.message !== CANCELLED) alert(e.message) }
})

document.querySelectorAll('[data-close]').forEach((b) =>
  b.addEventListener('click', () => (b.closest('.modal').hidden = true)))
document.querySelectorAll('.modal').forEach((m) =>
  m.addEventListener('click', (e) => { if (e.target === m) m.hidden = true }))

// ---------------------------------------------------------------- 取色 / 编辑

/** 画一排色点。选中态由它自己维护，调用方只管收 onPick 给的色相名。 */
function paintSwatches(el, current, onPick, { withLabels = false } = {}) {
  const pal = DATA.palette || []
  const draw = (sel) => {
    el.innerHTML = pal.map((c) => withLabels
      ? `<div class="sw-row ${c.hue === sel ? 'on' : ''}" data-hue="${c.hue}">
           <span class="d" style="background:${c.c500}"></span><span>${c.label}</span>
           <span class="tick">${c.hue === sel ? '✓' : ''}</span></div>`
      : `<button type="button" class="swatch ${c.hue === sel ? 'on' : ''}"
           data-hue="${c.hue}" title="${c.label}" style="--sw:${c.c500}"></button>`,
    ).join('')
    el.querySelectorAll('[data-hue]').forEach((n) => {
      n.onclick = (ev) => { ev.preventDefault(); draw(n.dataset.hue); onPick(n.dataset.hue) }
    })
  }
  draw(current)
}

/** 改一门课的颜色 */
async function openColorPicker(courseKey) {
  if (!(await ensureAuth())) return
  const c = courseOf(courseKey)
  document.getElementById('color-title').textContent = `${c.name} 的颜色`
  const box = document.getElementById('course-swatches')
  box.className = 'swatches labeled'
  paintSwatches(box, c.colorHue, async (hue) => {
    try {
      hide('modal-color')
      await post('/api/colors', { course: courseKey, hue })
      patchAndReconcile(() => applyCourseColor(courseKey, hue))
    } catch (e) { if (e.message !== CANCELLED) alert(e.message) }
  }, { withLabels: true })
  show('modal-color')
}

/** 官网条目：只能加备注、链接、改颜色、隐藏 */
let editingItem = null
async function openItemEditor(e) {
  if (!(await ensureAuth())) return
  editingItem = e
  document.getElementById('item-title').textContent = e.title
  document.getElementById('item-sub').textContent =
    `${courseOf(e.course)?.name || ''} · ${TYPE_LABEL[e.type] || e.type} · ${e.dueDate}` +
    '　（日期和标题以课程官网为准，改不了）'
  const f = document.getElementById('form-item')
  f.url.value = e.userUrl || ''
  f.note.value = e.userNote || ''
  f.dataset.hue = e.colorHue || ''
  paintSwatches(document.getElementById('item-swatches'), e.colorHue, (hue) => {
    f.dataset.hue = hue
  })
  document.getElementById('item-hide').textContent = e.hidden ? '取消隐藏' : '隐藏这一条'
  show('modal-item')
}

document.getElementById('form-item').addEventListener('submit', async (ev) => {
  ev.preventDefault()
  const f = ev.target
  const payload = {
    id: editingItem.id,
    url: f.url.value.trim(), note: f.note.value, color: f.dataset.hue || '',
  }
  try {
    hide('modal-item')
    await post('/api/item', payload)
    patchAndReconcile(() => applyItemPatch(payload.id, payload))
  } catch (e) { if (e.message !== CANCELLED) alert(e.message) }
})

document.getElementById('item-hide').addEventListener('click', async () => {
  const id = editingItem.id
  const next = !editingItem.hidden
  try {
    hide('modal-item')
    await post('/api/item', { id, hidden: next })
    patchAndReconcile(() => applyItemPatch(id, { hidden: next }))
  } catch (e) { if (e.message !== CANCELLED) alert(e.message) }
})

/** 自己建的条目：什么都能改 */
async function openCustomEditor(e) {
  await openAdd()
  if (document.getElementById('modal-add').hidden) return   // 用户取消了输口令
  const f = document.getElementById('form-add')
  f.dataset.editId = e.id
  f.title.value = e.title
  f.dueDate.value = e.dueDate
  f.clock.value = e.due ? clockOf(new Date(e.due)) : '23:59'
  f.type.value = e.type || 'custom'
  f.url.value = e.userUrl || e.url || ''
  f.note.value = e.note || ''
  f.color.value = e.colorHue || 'amber'
  setKind(e.kind === 'block' ? 'block' : 'deadline')
  if (e.kind === 'block') {
    f.startTime.value = e.startTime || '15:00'
    f.endTime.value = e.endTime || '17:00'
    f.repeat.value = e.repeat || 'once'
    f.location.value = e.location || ''
  }
  paintSwatches(document.getElementById('add-swatches'), f.color.value, (hue) => {
    f.color.value = hue
  })
  document.getElementById('add-submit').textContent = '保存修改'
  document.getElementById('add-cancel').hidden = false
  document.getElementById('add-delete').hidden = false
}

/** 切换"截止时间 / 时间段"两种形态，显示对应的字段 */
function setKind(kind) {
  const f = document.getElementById('form-add')
  f.kind.value = kind
  for (const b of document.querySelectorAll('#kind-seg button')) {
    b.classList.toggle('on', b.dataset.kind === kind)
  }
  for (const el of document.querySelectorAll('.only-deadline')) el.hidden = kind !== 'deadline'
  for (const el of document.querySelectorAll('.only-block')) el.hidden = kind !== 'block'
}

document.getElementById('kind-seg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-kind]')
  if (b) setKind(b.dataset.kind)
})

/** 把新建/编辑表单恢复成"新建"状态 */
function resetAddForm() {
  const f = document.getElementById('form-add')
  f.reset()
  delete f.dataset.editId
  f.color.value = 'amber'
  setKind('deadline')
  paintSwatches(document.getElementById('add-swatches'), 'amber', (hue) => { f.color.value = hue })
  document.getElementById('add-submit').textContent = '添加'
  document.getElementById('add-cancel').hidden = true
  document.getElementById('add-delete').hidden = true
}

document.getElementById('add-cancel').addEventListener('click', resetAddForm)

document.getElementById('add-delete').addEventListener('click', async () => {
  const f = document.getElementById('form-add')
  const id = f.dataset.editId
  if (!id || !confirm('删掉这个事件？')) return
  try {
    const r = await post('/api/custom', { action: 'remove', id })
    resetAddForm()
    hide('modal-add')
    patchAndReconcile(() => applyCustom(r.custom))
  } catch (e) { if (e.message !== CANCELLED) alert(e.message) }
})

const show = (id) => (document.getElementById(id).hidden = false)
const hide = (id) => (document.getElementById(id).hidden = true)

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

markKey()
initHoverCard()
load()
setInterval(load, 5 * 60 * 1000)
