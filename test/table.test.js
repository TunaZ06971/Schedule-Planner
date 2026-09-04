// rowspan 进位网格的回归测试。
// 这是整个抓取链路最容易坏、坏了又最难发现的一环 —— 列一旦错位，
// 抓出来的还是"合法"数据，只是 Lab 的内容跑到了 HW 那一列。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { load } from 'cheerio'
import { readFileSync, existsSync } from 'node:fs'
import { gridFromTable, cellText } from '../scrapers/lib/table.js'

test('rowspan 会把后续行的列往右挤，网格要把它补回来', () => {
  const $ = load(`<table>
    <tr><td>周次</td><td>A1</td><td>B1</td></tr>
    <tr><td rowspan="3">W</td><td>A2</td><td>B2</td></tr>
    <tr><td>A3</td><td>B3</td></tr>
    <tr><td>A4</td><td>B4</td></tr>
    <tr><td>X</td><td>A5</td><td>B5</td></tr>
  </table>`)
  const g = gridFromTable($, $('table')[0])
  const text = g.map((r) => r.map((c) => cellText($, c)))

  assert.deepEqual(text[1], ['W', 'A2', 'B2'])
  // 关键：这两行的 <td> 只有 2 个，但第 0 列必须由上面的 rowspan 补上
  assert.deepEqual(text[2], ['W', 'A3', 'B3'])
  assert.deepEqual(text[3], ['W', 'A4', 'B4'])
  assert.deepEqual(text[4], ['X', 'A5', 'B5'])
  for (const r of text) assert.equal(r.length, 3, '每行都应是 3 列')
})

test('colspan 也要占住对应的列', () => {
  const $ = load(`<table>
    <tr><td colspan="2">AB</td><td>C</td></tr>
    <tr><td>A</td><td>B</td><td>C2</td></tr>
  </table>`)
  const g = gridFromTable($, $('table')[0])
  assert.deepEqual(g[0].map((c) => cellText($, c)), ['AB', 'AB', 'C'])
  assert.deepEqual(g[1].map((c) => cellText($, c)), ['A', 'B', 'C2'])
})

test('rowspan 和 colspan 同时出现', () => {
  const $ = load(`<table>
    <tr><td rowspan="2" colspan="2">BIG</td><td>C1</td></tr>
    <tr><td>C2</td></tr>
  </table>`)
  const g = gridFromTable($, $('table')[0])
  assert.deepEqual(g[0].map((c) => cellText($, c)), ['BIG', 'BIG', 'C1'])
  assert.deepEqual(g[1].map((c) => cellText($, c)), ['BIG', 'BIG', 'C2'])
})

// ---- 拿三门课的真实页面当 fixture 跑一遍 ----
const FIXTURES = [
  { name: 'cs61c', file: 'test/fixtures/cs61c.html', sel: 'table.table-bordered', cols: 7, minRows: 70 },
  { name: 'cs61b', file: 'test/fixtures/cs61b.html', sel: 'table.spanned-table', cols: 7, minRows: 40 },
  { name: 'cs162', file: 'test/fixtures/cs162.html', sel: 'table#calendar', cols: 8, minRows: 100 },
]

for (const f of FIXTURES) {
  test(`${f.name} 真实课表：每行都对齐到 ${f.cols} 列`, { skip: !existsSync(f.file) }, () => {
    const $ = load(readFileSync(f.file, 'utf8'))
    const table = $(f.sel)[0]
    assert.ok(table, `找不到 ${f.sel}`)
    const g = gridFromTable($, table)
    assert.ok(g.length >= f.minRows, `行数 ${g.length} < ${f.minRows}`)
    const widths = new Set(g.map((r) => r.length))
    assert.deepEqual([...widths], [f.cols],
      `列宽应当处处相同；实际出现了 ${[...widths].join(',')} —— 说明 rowspan 没补对`)
  })
}
