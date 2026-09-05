// CS 61B —— https://fa26.datastructur.es/
//
// 主页 <table class="spanned-table">，49 行 × 7 列
// [Wk., Date, Lecture, Sections, Lab, HW, Project]。
//
// 三个要点：
//  1. 截止日期是自由文本 "(due Tue Sep 08)"，没有年份也没有时间
//  2. 49 行里有 43 行带 class="unfinalized-row" —— 课程组明示只有前两周定稿，
//     其余日期随时会变。必须标出来，否则会给用户虚假的确定感。
//  3. 考试藏在 Lecture 列的文字里："Mini-Midterm 1: Wed Sep 23, 8-9:20 PM"
//     期末是 "Final Exam (date/time TBD, Dec 14-18)" —— 用 registrar 规则兜底推算。

import { load } from 'cheerio'
import { fetchText } from './lib/fetch.js'
import { gridFromTable, cellText, cellLink } from './lib/table.js'
import { extractDues } from './lib/assignment.js'
import { TERM, inferFinalExam } from './lib/academic.js'
import { atPT, parseBareDate, addDays } from './lib/dates.js'

const COL = { week: 0, date: 1, lecture: 2, sections: 3, lab: 4, hw: 5, proj: 6 }

export async function scrape(course, { html } = {}) {
  const body = html ?? (await fetchText(course.home))
  const $ = load(body)

  const table = $('table.spanned-table').first()
  if (!table.length) throw new Error('cs61b: schedule table (table.spanned-table) not found')

  const grid = gridFromTable($, table[0])
  const trs = $(table[0]).find('tr').toArray()
  if (grid.length < 20) throw new Error(`cs61b: schedule table has only ${grid.length} rows — clearly wrong`)

  const events = []
  const seen = new Set()
  const firstDateOf = new Map() // 单元格 → 它第一次出现那行的日期
  const weekDates = new Map()   // 周次格 → 这一周覆盖的所有上课日

  for (let i = 1; i < grid.length; i++) {
    const row = grid[i]
    const rowDate = parseBareDate(cellText($, row[COL.date]), TERM.year)?.iso || null
    const provisional = $(trs[i]).hasClass('unfinalized-row')

    for (const col of [COL.lab, COL.hw, COL.proj, COL.lecture]) {
      const cell = row[col]
      if (!cell) continue
      if (!firstDateOf.has(cell)) firstDateOf.set(cell, { date: rowDate, provisional })
    }

    // 周次格用 rowspan 罩住一整周，把这一周的上课日都记下来（算 survey 截止要用）
    const wc = row[COL.week]
    if (wc && rowDate) {
      if (!weekDates.has(wc)) weekDates.set(wc, [])
      weekDates.get(wc).push(rowDate)
    }
  }

  events.push(...weeklySurveys($, weekDates, course))

  for (let i = 1; i < grid.length; i++) {
    const row = grid[i]

    // ---- 作业 / 项目：日期在单元格文字里 ----
    for (const col of [COL.hw, COL.proj]) {
      const cell = row[col]
      if (!cell || seen.has(cell)) continue
      seen.add(cell)

      const text = cellText($, cell)
      const { title, parts } = extractDues(text, TERM.year)
      if (!parts.length || !title) continue

      const meta = firstDateOf.get(cell) || {}
      // Project 5（BYOW）是结对项目，其余是个人项目
      const type = /design project\s*5/i.test(title) ? 'group_project' : 'project'

      for (const p of parts) {
        events.push(mk(course, {
          type: col === COL.hw ? 'homework' : type,
          title,
          iso: p.iso,
          url: cellLink($, cell, course.home),
          provisional: meta.provisional ?? true,
        }))
      }
    }

    // ---- Lab：**不产出 deadline** ----
    //
    // 61B 的 lab 是纯出勤制，官网 policies 原文：
    //   "Discussion and Lab Attendance — attendance will be part of your grade"
    // 课表 Lab 列的 15 个格子里，**一个 due 字样都没有**（对比 61C：9 个 lab 全都写着
    // "Due 9/08" 这种，那些是真的要交）。
    //
    // 早先这里拿所在行的日期硬造了一个 23:59 的截止时间 —— 等于凭空发明了一个
    // 课程根本没有的 deadline。对这个项目来说这是最糟的错法：它要防的就是记错时间，
    // 结果自己造了个假的出来。所以现在整个跳过。
    //
    // 你实际去哪节 lab，是从课程日历的 section 里选的（比如周四 11:00 Sarveshan's Lab），
    // 那个照常显示在时间网格上。

    // ---- 考试：藏在 Lecture 列的文字里 ----
    const lecCell = row[COL.lecture]
    if (lecCell && !seen.has(lecCell + ':exam')) {
      const text = cellText($, lecCell)
      for (const ex of parseExams(text)) {
        const key = `cs61b:exam:${slug(ex.name)}`
        if (events.some((e) => e.id === key)) continue
        events.push({
          id: key,
          course: 'cs61b',
          type: 'exam',
          title: ex.name,
          start: ex.iso ? atPT(ex.iso, ex.start) : null,
          end: ex.iso ? atPT(ex.iso, ex.end) : null,
          due: ex.iso ? atPT(ex.iso, ex.end) : null,
          dueDate: ex.iso,
          url: cellLink($, lecCell, course.home),
          provisional: !ex.iso,
          timeAssumed: false,
          sourceUrl: course.home,
        })
      }
    }
  }

  // 期末考试：官网写的是 "date/time TBD, Dec 14-18" —— 用 registrar 的
  // Final Exam Group 表推算兜底，并明确标成推算值。
  if (!events.some((e) => e.type === 'exam' && /final/i.test(e.title) && e.dueDate)) {
    const g = inferFinalExam(course.lecture.days, course.lecture.start)
    if (g) {
      events.push({
        id: 'cs61b:exam:final',
        course: 'cs61b',
        type: 'exam',
        title: 'Final Exam',
        start: atPT(g.date, g.start),
        end: atPT(g.date, g.end),
        due: atPT(g.date, g.end),
        dueDate: g.date,
        url: course.home,
        provisional: true,
        inferred: true,
        inferredNote: `Not published by the course; inferred from registrar final-exam Group ${g.group} (${course.lecture.days} ${course.lecture.start} lecture)`,
        timeAssumed: false,
        sourceUrl: 'https://registrar.berkeley.edu/calendars/final-exam-groups/',
      })
    }
  }

  return { events, meta: { rows: grid.length, unfinalized: $(table[0]).find('tr.unfinalized-row').length } }
}

/**
 * Weekly Surveys —— 藏在课表**第 0 列（Wk.）**里。
 *
 * 这一列长期被完全忽略：`COL.week` 定义了却一次没读过，13 个 survey 因此全丢了
 * （policies 里它们值 100 分）。格子形如：
 *   <td class="week-cell" rowspan="3" id="week-35">2<br><a href="https://forms.gle/…">Survey</a></td>
 *
 * ⚠️ 日期是**推出来的，不是官网给的**。课表格子里只有"周次 + Survey"两个字，
 * 没有日期也没有时间。规则来自 /policies/：每周二 23:59 截止，24 小时宽限。
 * 全站只有一条公告给出唯一一个具体日期 —— Week 2 → 周二 9/8，正好和这条规则算出来的一致。
 * 除 Week 2 外一律标 provisional + inferred，让界面上看得出这是推的。
 */
function weeklySurveys($, weekDates, course) {
  const out = []
  for (const [cell, dates] of weekDates) {
    const text = cellText($, cell)
    if (!/\bsurvey\b/i.test(text)) continue          // 17 个周次格里只有 13 个有
    if (!dates.length) continue

    const week = (text.match(/^\s*(\d+)/) || [])[1] || '?'

    // 该周最后一个上课日之后的那个周二
    let due = dates[dates.length - 1]
    for (let i = 0; i < 8; i++) {
      due = addDays(due, 1)
      if (weekdayOf(due) === 2) break
    }

    // 只取周次格**内部**的链接。/policies/ 上还有两个 forms.gle
    // （Late Add Intent、student support meeting），按"所有 forms.gle"找会误判。
    const href = $(cell).find('a[href]').first().attr('href') || ''

    // 唯一被官网公告确认过的是 Week 2
    const confirmed = week === '2'

    out.push({
      id: `cs61b:survey:week-${week}`,
      course: 'cs61b',
      type: 'survey',
      title: `Week ${week} Survey`,
      due: atPT(due, course.dueTime),
      dueDate: due,
      url: href || course.home,
      provisional: !confirmed,
      inferred: !confirmed,
      inferredNote: confirmed
        ? ''
        : 'Date derived from the policy rule (due Tuesdays 11:59 PM); only the Week 2 date is published',
      timeAssumed: false,   // 时间是 policies 明写的
      sourceUrl: course.home,
    })
  }
  out.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  return out
}

/** 'YYYY-MM-DD' → 0=周日，2=周二 */
function weekdayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

// "Mini-Midterm 1: Wed Sep 23, 8-9:20 PM" / "Midterm 2: Wed Nov 4, 8-10 PM"
const EXAM_RE = /\b(Mini-Midterm\s*\d+|Midterm\s*\d+|Final\s*Exam)\s*:?\s*(?:\(?)([A-Za-z]{3},?\s+[A-Za-z]{3,9}\.?\s+\d{1,2})?,?\s*(\d{1,2}(?::\d{2})?)\s*[-–]\s*(\d{1,2}(?::\d{2})?)\s*(AM|PM)/gi

function parseExams(text) {
  const out = []
  EXAM_RE.lastIndex = 0
  let m
  while ((m = EXAM_RE.exec(text))) {
    const [, name, dateStr, s, e, ampm] = m
    const d = dateStr ? parseBareDate(dateStr, TERM.year) : null
    out.push({
      name: name.replace(/\s+/g, ' ').trim(),
      iso: d?.iso || null,
      start: to24(s, ampm, true),
      end: to24(e, ampm, false),
    })
  }
  return out
}

// "8" + PM（区间结束是 9:20 PM）→ 起点也是 PM；跨 AM/PM 的考试这里不存在
function to24(clock, ampm, isStart) {
  let [h, mi = '00'] = clock.split(':')
  h = +h
  const pm = /pm/i.test(ampm)
  if (pm && h < 12) h += 12
  if (!pm && h === 12) h = 0
  return `${String(h).padStart(2, '0')}:${mi.padStart(2, '0')}`
}

function mk(course, { type, title, iso, url, provisional, attendance }) {
  return {
    id: `cs61b:${type}:${slug(title)}`,
    course: 'cs61b',
    type,
    title,
    due: atPT(iso, course.dueTime),
    dueDate: iso,
    url,
    provisional: !!provisional,
    attendance: !!attendance,
    timeAssumed: false,
    sourceUrl: course.home,
  }
}

const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
