// CS 61C —— https://cs61c.org/fa26/
//
// 主页有一个 <table class="table table-bordered">，80 行 × 7 列
// [Week, Date, Lecture, Discussion, Lab, HW, Project]，整学期都在里面，服务端渲染。
// 截止日期写成单元格里的文字 "Due 9/08"，多段 project 写成 "A: Due 9/24 B: Due 10/08"。
// 注意斜杠被转义成 &#x2F;，parseBareDate 里已经还原。

import { load } from 'cheerio'
import { fetchText } from './lib/fetch.js'
import { gridFromTable, cellText, cellLink } from './lib/table.js'
import { extractDues } from './lib/assignment.js'
import { TERM } from './lib/academic.js'
import { atPT } from './lib/dates.js'

const COL = { week: 0, date: 1, lecture: 2, disc: 3, lab: 4, hw: 5, proj: 6 }
const TYPE_OF_COL = { [COL.lab]: 'lab', [COL.hw]: 'homework', [COL.proj]: 'project' }

export async function scrape(course, { html } = {}) {
  const body = html ?? (await fetchText(course.home))
  const $ = load(body)

  const table = $('table.table-bordered').first()
  if (!table.length) throw new Error('cs61c: schedule table (table.table-bordered) not found')

  const grid = gridFromTable($, table[0])
  if (grid.length < 20) throw new Error(`cs61c: schedule table has only ${grid.length} rows — clearly wrong`)

  const events = []
  // rowspan 会让同一个单元格出现在多行里，用对象身份去重
  const seen = new Set()

  for (const row of grid.slice(1)) {
    for (const [colStr, type] of Object.entries(TYPE_OF_COL)) {
      const col = +colStr
      const cell = row[col]
      if (!cell || seen.has(cell)) continue
      seen.add(cell)

      const text = cellText($, cell)
      if (!text) continue
      const { title, parts } = extractDues(text, TERM.year)
      if (!parts.length) continue

      const url = cellLink($, cell, course.home)
      const optional = /\boptional\b/i.test(title)

      for (const p of parts) {
        events.push({
          id: `cs61c:${type}:${slug(title)}${p.part ? ':' + p.part.toLowerCase() : ''}`,
          course: 'cs61c',
          type,
          title: p.part ? `${title} (${p.part})` : title,
          due: atPT(p.iso, course.dueTime),
          dueDate: p.iso,
          url,
          optional,
          provisional: false,
          timeAssumed: false,
          sourceUrl: course.home,
        })
      }
    }
  }

  return { events, meta: { rows: grid.length } }
}

const slug = (s) =>
  s.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
