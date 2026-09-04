// 从课程的公开 Google Calendar ICS feed 里取每周固定的课 —— lecture / discussion / lab /
// office hours，以及少数一次性的考试窗口。
//
// 为什么用 ICS 而不用 Google Calendar API：课程网站上那个 API key 是**按 referrer 限制**的，
// 服务端直接调会返回 403 API_KEY_HTTP_REFERRER_BLOCKED。ICS feed 不需要 key，也不看 referrer。
//
// ICS 里只有 RRULE（"每周三 13:00"），需要自己展开成一个个具体日期。
// 展开后还要再过一遍假期表 —— Google Calendar 的 EXDATE 不一定填全，不能假定。

import ical from 'node-ical'
import { fetchText } from './fetch.js'
import { TERM, isHoliday } from './academic.js'
import { ptISODate, ptTime, ptDate } from './dates.js'

const TERM_START = ptDate(2026, 8, 26, 0, 0)
const TERM_END = ptDate(2026, 12, 19, 0, 0)

/** summary 文字 → 类型 */
export function classifySummary(summary) {
  const s = String(summary || '').toLowerCase()
  if (/office hour|\boh\b|queue/.test(s)) return 'office_hours'
  if (/\blab\b/.test(s)) return 'lab'
  if (/discussion|\bdisc\b|section|bridge|scholars|weekbehind|deeper/.test(s)) return 'discussion'
  if (/lecture|\blec\b/.test(s)) return 'lecture'
  if (/exam|midterm|quest|final|quiz/.test(s)) return 'exam'
  if (/review|guerrilla/.test(s)) return 'review'
  return 'other'
}

/**
 * 抓一个 ICS feed，展开成学期内的具体场次。
 * @returns {Array<{uid,title,type,date,start,end,location,recurring}>}
 */
export async function fetchMeetings(feedUrl, { text } = {}) {
  const body = text ?? (await fetchText(feedUrl))
  const parsed = ical.sync.parseICS(body)

  const out = []
  // RRULE 展开是纯 CPU 的同步活儿，一个学期的课能展开出好几百场。
  // Node 是单线程的 —— 闷头跑完会把事件循环卡住，这段时间**所有 HTTP 请求都在排队**，
  // 用户点个按钮就会感觉"卡了一下"。所以每处理几个事件就让出一次。
  let sinceYield = 0
  const breathe = async () => {
    if (++sinceYield < 8) return
    sinceYield = 0
    await new Promise((r) => setImmediate(r))
  }

  for (const key of Object.keys(parsed)) {
    const ev = parsed[key]
    if (!ev || ev.type !== 'VEVENT' || !ev.start) continue
    await breathe()

    const durationMs = ev.end && ev.start ? ev.end.getTime() - ev.start.getTime() : 3600000
    const title = String(ev.summary || '').replace(/\s+/g, ' ').trim()
    const type = classifySummary(title)
    let location = String(ev.location || '').replace(/\s+/g, ' ').trim()

    // CS 162 的日历不填 LOCATION 字段，而是把教室塞在标题的方括号前缀里
    // （"[CORY285] Tiger's Discussion"）。没有 location 时就从那里取。
    if (!location) {
      const m = title.match(/^\[([A-Z]{2,6}\s?\d{1,4}[A-Z]?)\]/i)
      if (m) location = m[1].trim()
    }

    // 这个 VEVENT 被排除掉的日期
    const excluded = new Set(
      Object.values(ev.exdate || {}).map((d) => ptISODate(new Date(d))),
    )

    // ⚠️ node-ical 的 rrule 展开返回的是"浮动时间"：把本地墙上时钟直接盖上 UTC 标记。
    // 实测 lecture 的 ev.start 是 2026-08-26T18:00Z（= 11:00 PDT，正确），
    // 但 rrule.between() 给的是 2026-08-26T11:00Z —— 直接用会整体差 7/8 小时。
    //
    // 所以：**日期**取自 rrule 展开（用 UTC 分量读，那才是本地日期），
    //       **时刻**取自 ev.start 的太平洋墙上时钟。
    // 这样跨 11/01 夏令时切换也对 —— 11:00 的课前后都还是 11:00。
    const clock = ptTime(ev.start)
    const [ch, cm] = clock.split(':').map(Number)

    let dates = []
    if (ev.rrule) {
      try {
        dates = ev.rrule
          .between(TERM_START, TERM_END, true)
          .map((d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`)
      } catch {
        dates = []
      }
    } else {
      dates = [ptISODate(ev.start)]
    }

    for (const date of dates) {
      if (date < TERM.instructionStart || date > TERM.finalsEnd) continue
      if (excluded.has(date)) continue
      // 假期二次过滤：ICS 的 EXDATE 不一定全
      if (isHoliday(date) && type !== 'exam') continue

      const [yy, mm, dd] = date.split('-').map(Number)
      const st = ev.rrule ? ptDate(yy, mm, dd, ch, cm) : ev.start
      const en = new Date(st.getTime() + durationMs)
      out.push({
        uid: `${ev.uid || key}@${date}`,
        title,
        type,
        date,
        start: st.toISOString(),
        end: en.toISOString(),
        startClock: ptTime(st),
        endClock: ptTime(en),
        location,
        recurring: !!ev.rrule,
      })
    }
  }

  out.sort((a, b) => a.start.localeCompare(b.start))
  return out
}

/**
 * 把展开后的场次收敛成"每周固定时段"的清单，供用户挑自己的 section。
 * 同一个 section 每周都出现，这里按 (标题, 星期, 时刻) 归成一条。
 */
export function summarizeSections(meetings) {
  const groups = new Map()
  for (const m of meetings) {
    const wd = weekdayOf(m.date)
    const k = `${m.type}|${m.title}|${wd}|${m.startClock}|${m.endClock}`
    if (!groups.has(k)) {
      groups.set(k, {
        key: k,
        type: m.type,
        title: m.title,
        weekday: wd,
        startClock: m.startClock,
        endClock: m.endClock,
        location: m.location,
        dates: [],
      })
    }
    groups.get(k).dates.push(m.date)
  }
  return [...groups.values()]
    .map((g) => ({ ...g, count: g.dates.length, firstDate: g.dates[0] }))
    .sort((a, b) => a.weekday - b.weekday || a.startClock.localeCompare(b.startClock))
}

const pad = (n) => String(n).padStart(2, '0')

/** 'YYYY-MM-DD' → 0=周日 (按日期本身算，不受时区影响) */
function weekdayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/**
 * 按配置生成每周的 lecture 场次。
 *
 * 为什么需要：不是每门课的日历都有 lecture ——
 *   · CS 61B 的公开日历只有 section / lab / office hours，从来就没有 lecture
 *   · CS 162 的 "Lectures" 日历是**过期的**，里面只剩 2022/2023/2025 的事件，
 *     Fall 2026 一场都没有（RRULE 的 UNTIL 早就过了，展开出来是 0 场）
 * 这两门课的上课时间只能按配置生成。配置里的时间已对照课程官网和用户选课截图核实过。
 */
export function synthesizeLectures(course) {
  const { days, start, end, location } = course.lecture || {}
  if (!days || !start) return []

  const wanted = new Set(
    /Tu|Th/.test(days)
      ? [/Tu/.test(days) ? 2 : null, /Th/.test(days) ? 4 : null].filter((x) => x !== null)
      : days.split('').map((ch) => ({ M: 1, W: 3, F: 5 }[ch])).filter(Boolean),
  )

  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = (end || start).split(':').map(Number)

  const out = []
  let cur = TERM.instructionStart
  let guard = 0
  while (cur <= TERM.formalClassesEnd && guard++ < 200) {
    const [y, mo, d] = cur.split('-').map(Number)
    const wd = new Date(Date.UTC(y, mo - 1, d)).getUTCDay()
    if (wanted.has(wd) && !isHoliday(cur)) {
      const st = ptDate(y, mo, d, sh, sm)
      const en = ptDate(y, mo, d, eh, em)
      out.push({
        uid: `${course.key}-lecture@${cur}`,
        title: `${course.name} Lecture`,
        type: 'lecture',
        date: cur,
        start: st.toISOString(),
        end: en.toISOString(),
        startClock: ptTime(st),
        endClock: ptTime(en),
        location: location || '',
        recurring: true,
        synthesized: true,
      })
    }
    const nx = new Date(Date.UTC(y, mo - 1, d + 1))
    cur = `${nx.getUTCFullYear()}-${pad(nx.getUTCMonth() + 1)}-${pad(nx.getUTCDate())}`
  }
  return out
}
