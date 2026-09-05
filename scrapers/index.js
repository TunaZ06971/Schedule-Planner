// 跑全部抓取器，产出规范化的事件集合。
//
// 关键设计：**每门课独立成功/失败**。一门课的网站改版或临时 502，不能影响其余几门，
// 也绝不能清空已有数据 —— 上层 store 会保留上一次的好数据。

import { COURSES } from '../config/courses.js'
import { fetchMeetings, summarizeSections, synthesizeLectures } from './lib/ics.js'
import { TERM, HOLIDAYS } from './lib/academic.js'
import * as cs61b from './cs61b.js'
import * as cs61c from './cs61c.js'
import * as cs162 from './cs162.js'

const SCRAPERS = { cs61b, cs61c, cs162 }

// 每门课至少应该抓到这么多条 deadline。抓少了说明网站改版或解析坏了 ——
// 静默少抓比抓不到危险得多，所以这里直接判失败、保留旧数据。
const MIN_EVENTS = { cs61b: 30, cs61c: 18, cs162: 14 }

// 自检：COURSES / SCRAPERS / MIN_EVENTS 是三张分开维护的表，谁漏了谁都不会报错，
// 只会在真正用到的时候抛一个看不出所以然的 "Cannot read properties of undefined"。
// 加/删课程时最容易漏，所以在模块加载时就把它们对一遍。
{
  const inConfig = new Set(COURSES.map((c) => c.key))
  const problems = []
  for (const key of inConfig) {
    if (!SCRAPERS[key]) problems.push(`${key} is in COURSES but has no scraper in SCRAPERS`)
    if (!MIN_EVENTS[key]) problems.push(`${key} is in COURSES but has no threshold in MIN_EVENTS`)
  }
  for (const key of Object.keys(SCRAPERS)) {
    if (!inConfig.has(key)) problems.push(`${key} is in SCRAPERS but no longer in COURSES`)
  }
  for (const key of Object.keys(MIN_EVENTS)) {
    if (!inConfig.has(key)) problems.push(`${key} is in MIN_EVENTS but no longer in COURSES`)
  }
  if (problems.length) {
    throw new Error('Course config mismatch:\n  - ' + problems.join('\n  - '))
  }
}

export async function scrapeCourse(course) {
  const startedAt = new Date().toISOString()
  const result = {
    key: course.key,
    ok: false,
    error: null,
    scrapedAt: startedAt,
    events: [],
    meetings: [],
    sections: [],
  }

  // --- 作业 deadline（来自课程主页的 HTML 课表）---
  try {
    const { events, meta } = await SCRAPERS[course.key].scrape(course)
    if (events.length < MIN_EVENTS[course.key]) {
      throw new Error(`Only ${events.length} items scraped (expected \u2265 ${MIN_EVENTS[course.key]}) \u2014 the site may have changed`)
    }
    result.events = events
    result.meta = meta
    result.ok = true
  } catch (e) {
    result.error = `Schedule scrape failed: ${e.message}`
    return result
  }

  // --- 每周固定的课（来自公开 ICS feed）---
  // ICS 失败不算整门课失败：deadline 才是主角，课表时间是锦上添花。
  const meetings = []
  for (const feed of course.ics) {
    try {
      const ms = await fetchMeetings(feed.url)
      meetings.push(...ms.map((m) => ({ ...m, course: course.key, feed: feed.name })))
    } catch (e) {
      result.icsError = `${feed.name}: ${e.message}`
    }
  }
  // 日历里没有 lecture 的课（61B 从来没有，162 的 lecture 日历已过期），按配置补上
  if (!meetings.some((m) => m.type === 'lecture')) {
    const synth = synthesizeLectures(course)
    meetings.push(...synth.map((m) => ({ ...m, course: course.key, feed: 'config' })))
    if (synth.length) result.lecturesSynthesized = synth.length
  }

  meetings.sort((a, b) => a.start.localeCompare(b.start))
  result.meetings = meetings

  // 有些课的考试只在日历里，课表 HTML 上没有（CS 61C 的 Quest / Midterm / Final 就是这样）。
  // 把日历里的考试提升成正式条目，避免漏掉最重要的东西。
  const haveExam = new Set(
    result.events.filter((e) => e.type === 'exam').map((e) => e.dueDate),
  )
  const seenExam = new Set()
  for (const mt of meetings) {
    if (mt.type !== 'exam') continue
    if (haveExam.has(mt.date)) continue
    const title = cleanExamTitle(mt.title)
    const key = `${title}|${mt.date}`
    if (seenExam.has(key)) continue
    seenExam.add(key)
    result.events.push({
      id: `${course.key}:exam:${slugify(title)}:${mt.date}`,
      course: course.key,
      type: 'exam',
      title,
      start: mt.start,
      end: mt.end,
      due: mt.end,
      dueDate: mt.date,
      location: mt.location,
      url: course.home,
      provisional: false,
      timeAssumed: false,
      fromCalendar: true,
      sourceUrl: course.ics[0]?.url || course.home,
    })
  }
  result.sections = summarizeSections(meetings).map((s) => ({ ...s, course: course.key }))

  return result
}

export async function scrapeAll() {
  // 一门一门来，中间让出事件循环。
  // 并发跑看着快，但三门课的 HTML 解析和 RRULE 展开都是同步的，挤在一起会把
  // 事件循环连续堵住好几秒 —— 那段时间网页上点任何东西都没反应。
  const results = []
  for (const c of COURSES) {
    results.push(await scrapeCourse(c))
    await new Promise((r) => setImmediate(r))
  }
  return {
    term: TERM,
    holidays: HOLIDAYS,
    scrapedAt: new Date().toISOString(),
    courses: Object.fromEntries(results.map((r) => [r.key, r])),
  }
}

// 直接跑 `node scrapers/index.js` 时打印一份摘要，方便人工对照
if (import.meta.url === `file://${process.argv[1]}`) {
  const out = await scrapeAll()
  let total = 0
  for (const [key, r] of Object.entries(out.courses)) {
    const by = {}
    for (const e of r.events) by[e.type] = (by[e.type] || 0) + 1
    total += r.events.length
    console.log(
      `${r.ok ? '✓' : '✗'} ${key.padEnd(7)} deadline ${String(r.events.length).padStart(3)}  ` +
      `课次 ${String(r.meetings.length).padStart(4)}  时段 ${String(r.sections.length).padStart(3)}  ` +
      JSON.stringify(by) + (r.error ? `  !! ${r.error}` : '') + (r.icsError ? `  (ICS: ${r.icsError})` : ''),
    )
  }
  console.log(`\n合计 ${total} 条 deadline`)
}

// "[CS 61C FA26] Midterm Part 1 Begins (10/28 - 10/30)" → "Midterm Part 1 (10/28 - 10/30)"
function cleanExamTitle(t) {
  return String(t)
    .replace(/^\[[^\]]*\]\s*/, '')
    .replace(/\s*\bBegins\b\s*/i, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// 用函数声明而非 const —— 文件末尾的 `import.meta.url` 自执行块会在模块求值时
// 就调用到它，const 还处在 TDZ 里会报 "Cannot access before initialization"。
function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 44)
}
