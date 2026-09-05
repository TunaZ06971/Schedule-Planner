// 抓取器的离线回归：对着存下来的真实页面跑，断言条目数和关键日期。
//
// 为什么要断数量：网站改版时，解析器往往不会报错，而是**安静地少抓一半**。
// 那种失败最危险 —— 日历看起来正常，但少了几个 deadline。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { byKey } from '../config/courses.js'
import * as cs61c from '../scrapers/cs61c.js'
import * as cs61b from '../scrapers/cs61b.js'
import * as cs162 from '../scrapers/cs162.js'

const read = (f) => readFileSync(`test/fixtures/${f}`, 'utf8')
const has = (f) => existsSync(`test/fixtures/${f}`)
const countBy = (evs) => evs.reduce((a, e) => ((a[e.type] = (a[e.type] || 0) + 1), a), {})

test('CS 61C：10 个 HW、9 个 lab、5 个 project 截止点', { skip: !has('cs61c.html') }, async () => {
  const { events } = await cs61c.scrape(byKey.cs61c, { html: read('cs61c.html') })
  const by = countBy(events)
  assert.equal(by.homework, 10)
  assert.equal(by.lab, 9)          // Lab 0-7 + 可选的 Lab 8
  assert.equal(by.project, 5)      // Proj 1 + Proj 2 A/B + Proj 3 A/B
  // 分段项目的两个截止点必须分开
  const p2 = events.filter((e) => /CS61Classify/.test(e.title))
  assert.deepEqual(p2.map((e) => e.dueDate).sort(), ['2026-09-24', '2026-10-08'])
})

test('CS 61B：8 HW、13 survey、3 考试、无 lab deadline，期末靠 registrar 规则推算', { skip: !has('cs61b.html') }, async () => {
  const { events, meta } = await cs61b.scrape(byKey.cs61b, { html: read('cs61b.html') })
  const by = countBy(events)
  assert.equal(by.homework, 8)
  assert.equal(by.group_project, 3)   // Design Project 5A/5B/5C（BYOW，结对）
  assert.equal(by.exam, 3)

  // 43/49 行被课程组标成未定稿 —— 必须原样反映出来，不能假装都定了
  assert.equal(meta.unfinalized, 43)
  // 22 条里 16 条是暂定的，只有前两周那 6 条定了稿
  assert.equal(events.filter((e) => e.provisional && e.type !== 'survey').length, 16)
  assert.equal(events.filter((e) => !e.provisional && e.type !== 'survey').length, 6)

  // 前两周是定稿的
  const hw1 = events.find((e) => /Tools HW1/.test(e.title))
  assert.equal(hw1.provisional, false)

  // 61B 的 lab 是纯出勤制，官网课表里一个 due 都没写 ——
  // 绝不能凭空造一个截止时间出来。（曾经就是拿行日期硬编了 23:59。）
  assert.equal(by.lab, undefined, 'CS 61B 不该产出任何 lab deadline')

  // Weekly Surveys 藏在第 0 列（Wk.）里，那一列曾经完全没被读过 —— 13 个 survey 全丢了
  assert.equal(by.survey, 13, 'policies 明写 13 个 weekly survey')

  const surveys = events.filter((e) => e.type === 'survey')

  // 唯一的真值锚点：全站只有一条公告，说 Week 2 Survey 截止 9/8。
  // 截止日期是按 policy 规则（每周二 23:59）推的 —— 这条断言就是在守那条规则。
  // 规则推错的话，这里第一个红。
  const wk2 = surveys.find((e) => e.title === 'Week 2 Survey')
  assert.equal(wk2.dueDate, '2026-09-08', 'Week 2 是官网唯一公布的 survey 日期')
  assert.equal(wk2.provisional, false, 'Week 2 有公告佐证，不该标成暂定')

  // 其余 12 个都是推出来的，必须让用户看得出来
  for (const s of surveys.filter((e) => e.title !== 'Week 2 Survey')) {
    assert.equal(s.provisional, true, `${s.title} 的日期是推的，必须标暂定`)
    assert.equal(s.inferred, true, `${s.title} 必须标 inferred`)
  }

  // 全部落在周二
  for (const s of surveys) {
    const [y, m, d] = s.dueDate.split('-').map(Number)
    assert.equal(new Date(Date.UTC(y, m - 1, d)).getUTCDay(), 2, `${s.title} 应当截止于周二`)
  }

  // 期末：官网写的是 TBD，这里应当是推算值且标记清楚
  const fin = events.find((e) => e.type === 'exam' && /Final/i.test(e.title))
  assert.equal(fin.dueDate, '2026-12-17')
  assert.equal(fin.inferred, true)
  assert.equal(fin.provisional, true)
})

test('CS 162：3 个 midterm、无期末、设计文档是硬截止', { skip: !has('cs162.html') }, async () => {
  const { events } = await cs162.scrape(byKey.cs162, { html: read('cs162.html') })
  const by = countBy(events)
  assert.equal(by.exam, 3)
  assert.equal(by.group_project, 6)   // 三个小组项目 × (设计文档 + 代码报告)
  assert.ok(!events.some((e) => /final exam/i.test(e.title)), 'CS 162 没有期末考')

  // 三个 midterm 的时间官网都还是 TBD
  assert.equal(events.filter((e) => e.type === 'exam' && e.timeAssumed).length, 3)

  // "Design Document Due" 出现三次，文字一模一样，必须靠 CSS class 区分成三个项目
  const dd = events.filter((e) => /Design Document/.test(e.title))
  assert.equal(dd.length, 3)
  assert.equal(new Set(dd.map((e) => e.title)).size, 3, '三个设计文档必须能区分开')
  for (const e of dd) assert.equal(e.hardDeadline, true)

  // 名字必须来自 Release 行，不能假设 projN = Project N。
  // 官网的 class 编号和项目编号差一位：proj2 其实是 Project 1。
  assert.ok(dd.some((e) => e.title.startsWith('Project 1: User Programs')),
    'proj2 的标题必须是 Project 1 —— class 编号差一位，不能直接拿来当项目号')

  // 发布日期挂在已有条目上，不新增行
  const withRelease = events.filter((e) => e.releaseDate)
  assert.ok(withRelease.length >= 10, `应有 10+ 条带发布日期，实际 ${withRelease.length}`)
  for (const e of withRelease) {
    assert.ok(e.releaseDate < e.dueDate, `${e.title} 的发布日期应早于截止日期`)
  }

  // 官网不公布 Design Review 和组内互评的时间 —— 不造日期，只在最相关的条目上留提醒
  for (const e of dd) assert.match(e.note, /Design Review/, '设计文档应提醒去约 Design Review')
  const reports = events.filter((e) => /Code and Final Report/.test(e.title))
  assert.equal(reports.length, 3)
  for (const e of reports) assert.match(e.note, /[Gg]roup evaluation/, '结题应提醒交组内互评')
  assert.ok(!events.some((e) => /Design Review/i.test(e.title)),
    '不该为 Design Review 造出带日期的条目 —— 官网根本不发布时间')
})
