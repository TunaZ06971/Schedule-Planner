// HTTP 服务：静态页面 + 只读 API（公开） + 写 API（要口令） + 每小时自动抓取。
//
// 只监听 127.0.0.1，外面由 Caddy 反代进来。

import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { timingSafeEqual, randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { scrapeAll } from '../scrapers/index.js'
import { COURSES, LOAD_WEIGHT } from '../config/courses.js'
import { PALETTE, HUES, isHue, hex500, hex300 } from '../config/palette.js'
import { TERM, isHoliday } from '../scrapers/lib/academic.js'
import { atPT, eachDay } from '../scrapers/lib/dates.js'
import {
  ensureDirs, loadEvents, saveEvents, loadState, saveState, saveSnapshot, mergeScrape, pruneState,
} from './store.js'
import { diffEvents, appendChanges } from './diff.js'
import { buildICS } from './ics-out.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = path.join(ROOT, 'public')
const HOST = process.env.HOST || '127.0.0.1'
const PORT = +(process.env.PORT || 8132)
const WRITE_TOKEN = process.env.WRITE_TOKEN || ''
const REFRESH_MS = +(process.env.REFRESH_MS || 3600_000)   // 默认每小时

let refreshing = false
let lastRefreshError = null

// ---------------------------------------------------------------- 鉴权

function tokenMatches(given) {
  if (!WRITE_TOKEN) return false           // 没设口令 = 一律拒绝，不是一律放行
  if (typeof given !== 'string' || given.length === 0) return false
  const a = Buffer.from(given)
  const b = Buffer.from(WRITE_TOKEN)
  if (a.length !== b.length) return false  // 长度不同直接拒，但仍走定长比较避免分支泄露
  return timingSafeEqual(a, b)
}

const authorized = (req) => tokenMatches(req.headers['x-auth'])

// ---------------------------------------------------------------- 抓取

async function refresh({ reason = 'scheduled' } = {}) {
  if (refreshing) return { skipped: true }
  refreshing = true
  const startedAt = Date.now()
  try {
    const previous = await loadEvents()
    const fresh = await scrapeAll()
    const merged = mergeScrape(previous, fresh)

    const changes = diffEvents(previous, merged)
    merged.changes = appendChanges(previous?.changes, changes, merged.lastRefresh)
    merged.refreshReason = reason

    await saveEvents(merged)
    if (changes.length) await saveSnapshot(merged)

    lastRefreshError = null
    const failed = Object.values(merged.courses).filter((c) => !c.ok).map((c) => c.key)
    console.log(
      `[refresh:${reason}] ${Date.now() - startedAt}ms  变更 ${changes.length} 条` +
      (failed.length ? `  失败: ${failed.join(',')}` : '  全部成功'),
    )
    return { changes: changes.length, failed }
  } catch (e) {
    lastRefreshError = e.message
    console.error('[refresh] 整体失败:', e.message)
    return { error: e.message }
  } finally {
    refreshing = false
  }
}

// 每小时跑一次，带随机抖动，避免整点扎堆去敲课程网站
function scheduleRefresh() {
  const jitter = Math.floor(Math.random() * 5 * 60_000)
  setTimeout(async () => {
    await refresh({ reason: 'scheduled' })
    scheduleRefresh()
  }, REFRESH_MS + jitter)
}

// ---------------------------------------------------------------- 视图数据

/** 把存好的数据摊平成前端要的形状 */
/**
 * 公开的那一份 —— 只有课程本身的信息，任何人都能拉。
 *
 * ⚠️ 这里绝对不能带任何个人内容。早先的版本把 state（选了哪个 TA 的 section、
 * 勾了什么、自己加了什么事）直接塞进这个公开接口，还把 meetings 预先过滤成
 * "只剩我选的那几场" —— 等于把「我几点在哪个教室、跟哪个 TA」公开了。
 * 个人层一律走下面那个要口令的 buildMine()。
 */
async function buildPublic() {
  const data = await loadEvents()
  if (!data) return { ready: false, courses: [], events: [], meetings: [], sections: [] }

  const events = []
  const meetings = []
  const sections = []
  const freshness = []

  // 公开视图一律用配置里的默认配色 —— 用户自己改的配色属于个人偏好
  const defaultHue = (key) => COURSES.find((c) => c.key === key)?.color || 'gray'

  for (const course of COURSES) {
    const c = data.courses[course.key]
    if (!c) continue
    const hue = defaultHue(course.key)

    freshness.push({
      key: course.key,
      ok: c.ok,
      error: c.error || null,
      lastSuccessAt: c.lastSuccessAt || null,
      staleSince: c.staleSince || null,
      lecturesSynthesized: c.lecturesSynthesized || 0,
      icsError: c.icsError || null,
    })

    // 抓来的 deadline：不带任何个人标注（备注、链接、单独改的颜色、隐藏状态）
    for (const e of c.events || []) {
      events.push({
        ...e,
        colorHue: hue,
        color: hex500(hue),
        userNote: '', userUrl: '', hidden: false, editable: false,
      })
    }

    // 只放 lecture。section 的具体场次会暴露"我选了哪个"，留给 /api/mine。
    for (const m of c.meetings || []) {
      if (m.type !== 'lecture') continue
      meetings.push({ ...m, colorHue: hue, color: hex500(hue) })
    }

    // section 清单本身是公开的课程信息（选择器要用），不含"选了哪个"
    for (const sec of c.sections || []) sections.push(sec)
  }

  events.sort((a, b) => String(a.due || '').localeCompare(String(b.due || '')))

  return {
    ready: true,
    term: data.term,
    holidays: data.holidays,
    lastRefresh: data.lastRefresh,
    lastRefreshError,
    freshness,
    courses: COURSES.map((c) => ({
      key: c.key, name: c.name, full: c.full, units: c.units,
      colorHue: defaultHue(c.key),
      color: hex500(defaultHue(c.key)),
      dot: hex300(defaultHue(c.key)),
      dueTime: c.dueTime, graceHours: c.graceHours, home: c.home,
    })),
    loadWeight: LOAD_WEIGHT,
    palette: HUES.map((h) => ({ hue: h, label: PALETTE[h].label, c500: PALETTE[h].c500, c300: PALETTE[h].c300 })),
    events,
    meetings,
    sections,
    changes: (data.changes || []).slice(0, 40),
  }
}

/**
 * 个人的那一份 —— 要口令才给。
 * 前端拿到后在本地和公开数据合并（见 public/app.js 的 mergeMine）。
 */
async function buildMine() {
  const data = await loadEvents()
  const state = await loadState()

  // 注意：个人层**不依赖**抓取结果。抓取还没跑完、或者三门课全挂了的时候，
  // 你的配色、勾选、自定义事件照样要还给你 —— 早先这里 `if (!data) return 空壳`，
  // 等于一重启就把个人数据"藏"起来，测试第一次跑就把它抓出来了。
  const colors = state.colors || {}
  const hueOf = (key) => {
    const h = colors[key]
    return isHue(h) ? h : (COURSES.find((c) => c.key === key)?.color || 'gray')
  }

  const meetings = []
  for (const course of COURSES) {
    const c = data?.courses?.[course.key]
    if (!c) continue
    const picked = state.sections?.[course.key] || []
    const hue = hueOf(course.key)
    for (const m of c.meetings || []) {
      if (m.type === 'lecture' || m.type === 'office_hours') continue
      if (!picked.includes(sectionKeyOf(m))) continue
      meetings.push({ ...m, colorHue: hue, color: hex500(hue) })
    }
  }

  // 自定义事件（以及有起止时间的那种展开成的课次）
  const custom = []
  const hidden = state.hidden || {}
  for (const ce of state.custom || []) {
    const hue = isHue(ce.color) ? ce.color : 'amber'
    const painted = {
      ...ce, custom: true, course: 'custom',
      colorHue: hue, color: hex500(hue),
      hidden: !!hidden[ce.id], editable: true,
    }
    custom.push(painted)
    if (ce.kind === 'block' && !hidden[ce.id]) meetings.push(...expandCustomBlock(painted))
  }

  return {
    state: {
      done: state.done || {},
      sections: state.sections || {},
      custom: state.custom || [],
      colors,
      overrides: state.overrides || {},
      hidden,
    },
    // 课程配色的个人覆盖，前端拿去重新上色
    courseColors: Object.fromEntries(COURSES.map((c) => [c.key, hueOf(c.key)])),
    meetings,
    custom,
  }
}

/** 只接受 http/https —— 别把 javascript: 之类的东西存进去 */
function safeUrl(v) {
  const t = String(v || '').trim()
  if (!t) return ''
  try {
    const u = new URL(t)
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.toString().slice(0, 500) : ''
  } catch { return '' }
}

/**
 * 把一个"时间段"型自定义事件展开成一场场具体的课次。
 * repeat=weekly 就按 dueDate 那天的星期几，铺满整个学期（跳过假期）。
 */
function expandCustomBlock(ce) {
  const out = []
  const push = (date) => out.push({
    uid: `${ce.id}@${date}`,
    title: ce.title,
    type: 'custom',
    date,
    start: atPT(date, ce.startTime),
    end: atPT(date, ce.endTime),
    startClock: ce.startTime,
    endClock: ce.endTime,
    location: ce.location || '',
    note: ce.note || '',
    url: ce.url || '',
    recurring: ce.repeat === 'weekly',
    course: 'custom',
    colorHue: ce.colorHue,
    color: ce.color,
    custom: true,
    customId: ce.id,
  })

  if (ce.repeat !== 'weekly') { push(ce.dueDate); return out }

  const [y0, m0, d0] = ce.dueDate.split('-').map(Number)
  const want = new Date(Date.UTC(y0, m0 - 1, d0)).getUTCDay()
  for (const date of eachDay(TERM.instructionStart, TERM.finalsEnd)) {
    const [y, m, d] = date.split('-').map(Number)
    if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== want) continue
    if (isHoliday(date)) continue
    push(date)
  }
  return out
}

const sectionKeyOf = (m) =>
  `${m.type}|${m.title}|${weekdayOf(m.date)}|${m.startClock}|${m.endClock}`

function weekdayOf(iso) {
  const [y, mo, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay()
}

// ---------------------------------------------------------------- HTTP

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

const json = (res, code, body) => {
  const s = JSON.stringify(body)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(s) })
  res.end(s)
}

async function readBody(req, limit = 256 * 1024) {
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > limit) throw new Error('请求体过大')
    chunks.push(c)
  }
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const p = url.pathname

  try {
    if (p === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok') }

    // 公开：只有课程本身的信息
    if (p === '/api/data') return json(res, 200, await buildPublic())

    // 个人层：要口令。GET 也要验，不能只拦 POST —— 之前就是漏了这一条。
    if (p === '/api/mine') {
      if (!authorized(req)) return json(res, 401, { error: '需要口令' })
      return json(res, 200, await buildMine())
    }

    if (p === '/api/calendar.ics') {
      // 日历订阅没法带请求头，所以口令走查询串 ?t=xxx。
      // 不带口令只给抓来的课程 deadline；带对口令才含个人的那部分。
      const t = url.searchParams.get('t') || ''
      const mine = t && tokenMatches(t) ? await buildMine() : null
      const payload = await buildPublic()
      if (mine) {
        payload.events = [
          ...payload.events.map((e) => {
            const ov = mine.state.overrides[e.id] || {}
            return { ...e, userUrl: ov.url || '', userNote: ov.note || '' }
          }).filter((e) => !mine.state.hidden[e.id]),
          ...mine.custom.filter((c) => !c.hidden),
        ]
      }
      const body = buildICS(payload)
      res.writeHead(200, {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': 'inline; filename="schedule.ics"',
      })
      return res.end(body)
    }

    // ---- 以下都要口令 ----
    if (p.startsWith('/api/') && req.method === 'POST') {
      if (!authorized(req)) return json(res, 401, { error: '需要口令' })
      const body = await readBody(req)
      const state = await loadState()

      if (p === '/api/state') {
        // { id, done: true|false }
        const { id, done } = body
        if (typeof id !== 'string' || !id) return json(res, 400, { error: '缺少 id' })
        state.done = state.done || {}
        if (done) state.done[id] = new Date().toISOString()
        else delete state.done[id]
        await saveState(state)
        return json(res, 200, { ok: true, done: state.done })
      }

      if (p === '/api/custom') {
        // { action: 'add' | 'update' | 'remove', event | id }
        state.custom = state.custom || []

        if (body.action === 'remove') {
          state.custom = state.custom.filter((e) => e.id !== body.id)
          await saveState(state)
          return json(res, 200, { ok: true, custom: state.custom })
        }

        const e = body.event || {}
        if (!e.title || !e.dueDate) return json(res, 400, { error: '缺少标题或日期' })

        // 两种形态：
        //   deadline —— 只有一个截止时刻，显示在顶部全天条（原来只支持这个）
        //   block    —— 有起止时间，画在时间网格上，可以每周重复（比如 X410 每周五 15:00-17:00）
        const kind = e.kind === 'block' ? 'block' : 'deadline'
        const clock = (v, fallback) => (/^\d{1,2}:\d{2}$/.test(String(v || '')) ? v : fallback)

        const shaped = {
          title: String(e.title).slice(0, 120),
          type: e.type || 'custom',
          kind,
          dueDate: e.dueDate,
          due: e.due || `${e.dueDate}T23:59:00-08:00`,
          note: String(e.note || '').slice(0, 500),
          url: safeUrl(e.url),
          color: isHue(e.color) ? e.color : 'amber',
          location: String(e.location || '').slice(0, 120),
        }

        if (kind === 'block') {
          shaped.startTime = clock(e.startTime, '09:00')
          shaped.endTime = clock(e.endTime, '10:00')
          shaped.repeat = e.repeat === 'weekly' ? 'weekly' : 'once'
          // 结束早于开始就当作 1 小时
          if (shaped.endTime <= shaped.startTime) {
            const [h, m] = shaped.startTime.split(':').map(Number)
            shaped.endTime = `${String(Math.min(23, h + 1)).padStart(2, '0')}:${String(m).padStart(2, '0')}`
          }
        }

        if (body.action === 'update') {
          const i = state.custom.findIndex((x) => x.id === e.id)
          if (i === -1) return json(res, 404, { error: '找不到这个事件' })
          state.custom[i] = { ...state.custom[i], ...shaped }
        } else {
          state.custom.push({ id: `custom:${randomUUID().slice(0, 8)}`, ...shaped })
        }

        await saveState(state)
        return json(res, 200, { ok: true, custom: state.custom })
      }

      if (p === '/api/colors') {
        // { course, hue } —— 改某门课的颜色
        if (!isHue(body.hue)) return json(res, 400, { error: '不认识这个颜色' })
        if (!COURSES.some((c) => c.key === body.course)) return json(res, 400, { error: '没有这门课' })
        state.colors = { ...(state.colors || {}), [body.course]: body.hue }
        await saveState(state)
        return json(res, 200, { ok: true, colors: state.colors })
      }

      if (p === '/api/item') {
        // { id, note?, url?, color?, hidden? } —— 官网条目只能加这几样，日期和标题动不了
        const id = body.id
        if (typeof id !== 'string' || !id) return json(res, 400, { error: '缺少 id' })

        if (body.hidden !== undefined) {
          state.hidden = state.hidden || {}
          if (body.hidden) state.hidden[id] = true
          else delete state.hidden[id]
        }

        if (body.note !== undefined || body.url !== undefined || body.color !== undefined) {
          state.overrides = state.overrides || {}
          const cur = state.overrides[id] || {}
          const next = {
            note: body.note !== undefined ? String(body.note).slice(0, 500) : cur.note || '',
            url: body.url !== undefined ? safeUrl(body.url) : cur.url || '',
            color: body.color !== undefined
              ? (isHue(body.color) ? body.color : '')
              : cur.color || '',
          }
          // 三样都空就把这条记录删掉，别让 state.json 慢慢堆垃圾
          if (!next.note && !next.url && !next.color) delete state.overrides[id]
          else state.overrides[id] = next
        }

        await saveState(state)
        return json(res, 200, { ok: true, overrides: state.overrides || {}, hidden: state.hidden || {} })
      }

      if (p === '/api/sections') {
        // { course, keys: [...] }
        state.sections = state.sections || {}
        if (body.course) state.sections[body.course] = Array.isArray(body.keys) ? body.keys : []
        await saveState(state)
        return json(res, 200, { ok: true, sections: state.sections })
      }

      if (p === '/api/auth') {
        // 保留这个端点只为兼容 —— 前端已经不用它了。
        // 曾经的做法是"先校验口令、再执行操作"，两次往返东京白等半秒；
        // 现在口令框里直接跑真正那次操作，对了就说明口令对。
        return json(res, 200, { ok: true })
      }

      if (p === '/api/refresh') {
        const r = await refresh({ reason: 'manual' })
        return json(res, 200, { ok: true, ...r })
      }

      return json(res, 404, { error: '没有这个接口' })
    }

    // ---- 静态文件 ----
    let file = p === '/' ? '/index.html' : p
    const full = path.join(PUBLIC, path.normalize(file).replace(/^(\.\.[/\\])+/, ''))
    if (!full.startsWith(PUBLIC) || !existsSync(full)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      return res.end('404')
    }
    const buf = await readFile(full)
    res.writeHead(200, {
      'content-type': MIME[path.extname(full)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    })
    res.end(buf)
  } catch (e) {
    console.error('[http]', p, e.message)
    json(res, 500, { error: e.message })
  }
})

// ---------------------------------------------------------------- 启动

await ensureDirs()
if (!WRITE_TOKEN) {
  console.warn('⚠️  没有设 WRITE_TOKEN —— 所有写操作（勾选/加事件）都会被拒绝。')
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用 —— 是不是已经有一个实例在跑了？`)
    console.error(`查一下： lsof -nP -iTCP:${PORT} -sTCP:LISTEN`)
  } else {
    console.error('服务启动失败:', e.message)
  }
  process.exit(1)
})

server.listen(PORT, HOST, async () => {
  console.log(`课程日历跑起来了： http://${HOST}:${PORT}`)

  // 退课之后 state.json 里可能还留着那门课的 section 选择，启动时清一次
  const { state: pruned, dropped } = pruneState(await loadState(), COURSES.map((c) => c.key))
  if (dropped) {
    await saveState(pruned)
    console.log(`清掉了 ${dropped} 门已退课程遗留的 section 选择`)
  }
  const existing = await loadEvents()
  if (!existing) {
    console.log('还没有数据，先抓一次…')
    await refresh({ reason: 'boot' })
  } else {
    console.log(`已有数据，上次抓取 ${existing.lastRefresh}`)
    refresh({ reason: 'boot' })   // 后台再抓一次，不阻塞启动
  }
  scheduleRefresh()
})

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`收到 ${sig}，关闭中…`)
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 5000).unref()
  })
}
