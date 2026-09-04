// CS 162 —— https://cs162.org/
//
// 主页 <table id="calendar">，120 行 × 8 列，**每行是一天**
// [Week, Date, #, Lecture, Readings/Discussions, Homework, Project, Event]。
//
// 三个要点：
//  1. 截止日期不在单元格里，而是在**所在行的 date 列**上（"Mon09/07" 这种）
//  2. 单元格文字有歧义 —— "Design Document Due" 和 "Code and Final Report Due"
//     各出现 3 次，文字一模一样。靠单元格的 CSS class（hw0-hw6 / proj1-proj4）区分。
//  3. class 到真实名字的映射，从"Release ..."行里现学：
//     proj1=Project 0 Pregame（个人）、proj2=Project 1、proj3=Project 2、proj4=Project 3（都是小组）
//  4. 三个 midterm 全是 "(TBD)"/"(TBA)"，只有日期没有时间。

import { load } from 'cheerio'
import { fetchText } from './lib/fetch.js'
import { gridFromTable, cellText, cellLink } from './lib/table.js'
import { TERM } from './lib/academic.js'
import { atPT, parseBareDate } from './lib/dates.js'

const COL = { week: 0, date: 1, num: 2, lecture: 3, reading: 4, hw: 5, proj: 6, event: 7 }

export async function scrape(course, { html } = {}) {
  const body = html ?? (await fetchText(course.home))
  const $ = load(body)

  const table = $('table#calendar').first()
  if (!table.length) throw new Error('cs162: 找不到课表 table#calendar')

  const grid = gridFromTable($, table[0])
  if (grid.length < 50) throw new Error(`cs162: 课表只有 ${grid.length} 行，明显不对`)

  // 第一遍：从 "Release ..." 行学出 class → 真实名字
  const nameOf = {}
  for (let i = 1; i < grid.length; i++) {
    for (const col of [COL.hw, COL.proj]) {
      const cell = grid[i][col]
      if (!cell) continue
      const cls = ($(cell).attr('class') || '').trim()
      const text = cellText($, cell)
      if (!cls || !/^release\b/i.test(text)) continue
      if (!nameOf[cls]) nameOf[cls] = text.replace(/^release\s+/i, '').trim()
    }
  }

  const events = []
  const seen = new Set()

  for (let i = 1; i < grid.length; i++) {
    const row = grid[i]
    const iso = parseBareDate(cellText($, row[COL.date]), TERM.year)?.iso
    if (!iso) continue

    for (const col of [COL.hw, COL.proj, COL.event]) {
      const cell = row[col]
      if (!cell || seen.has(cell)) continue
      seen.add(cell)

      const text = cellText($, cell)
      if (!text) continue
      const cls = ($(cell).attr('class') || '').trim()
      const url = cellLink($, cell, course.home)

      // ---- 考试 ----
      const exam = text.match(/\b(Midterm\s*\d+)\b/i)
      if (exam) {
        const tbd = /\(TB[AD]\)/i.test(text)
        events.push({
          id: `cs162:exam:${slug(exam[1])}`,
          course: 'cs162',
          type: 'exam',
          title: exam[1].replace(/\s+/g, ' '),
          due: atPT(iso, '23:59'),
          dueDate: iso,
          url,
          // 官网只给了日期，时间写的是 (TBD)/(TBA)
          provisional: tbd,
          timeAssumed: tbd,
          note: tbd ? '官网时间仍为 TBD，等课程组公布' : '',
          sourceUrl: course.home,
        })
        continue
      }

      // ---- 截止项 ----
      if (!/\bdue\b|\bdeadline\b/i.test(text)) continue
      if (/early drop/i.test(text)) continue   // 退课截止，不是作业

      const base = nameOf[cls]
      const isProject = cls.startsWith('proj')
      // proj1 = Project 0 Pregame，policies 明确说它按个人作业算；proj2/3/4 才是小组项目
      let type = isProject ? (cls === 'proj1' ? 'project' : 'group_project') : 'homework'
      // RPC Lab 挂在 HW5 名下，但它自己就叫 lab，单独归类方便用户扫
      if (/\bRPC Lab\b/i.test(text)) type = 'lab'

      // 去掉 "Due" / "Deadline" 后剩下的部分：
      //   "HW0 Due"            -> "HW0"          纯粹是编号的重复，用项目名就够
      //   "Design Document Due"-> "Design Document"  是子交付物，必须拼在项目名后面
      const suffix = text
        .replace(/\((?:C|Rust) version\)/gi, '')
        .replace(/\b(due|deadline)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
      const redundant = !suffix || /^(HW\s*\d*|Homework\s*\d*|Project\s*\d*)$/i.test(suffix)
      const title = base
        ? (redundant ? base : `${base} — ${suffix}`)
        : (suffix || text)

      events.push({
        id: `cs162:${type}:${cls || slug(text)}:${slug(suffix || text)}`,
        course: 'cs162',
        type,
        title: title.trim(),
        due: atPT(iso, course.dueTime),
        dueDate: iso,
        url,
        // 设计文档不能用 slip day，迟交直接 0 分
        hardDeadline: /design document/i.test(text),
        provisional: false,
        timeAssumed: false,
        sourceUrl: course.home,
      })
    }
  }

  return { events, meta: { rows: grid.length, names: Object.keys(nameOf).length } }
}

const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
