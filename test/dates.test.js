// 日期 / 时区。学期跨越 11 月 1 日的夏令时切换，写死偏移会让后半学期整体差一小时。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { atPT, parseBareDate, addDays, ptISODate, eachDay } from '../scrapers/lib/dates.js'
import { inferFinalExam, isHoliday, HOLIDAYS } from '../scrapers/lib/academic.js'

test('夏令时切换前后的 23:59 要落在不同的 UTC 偏移上', () => {
  // 11/01 之前是 PDT (-07:00)
  assert.equal(atPT('2026-09-10', '23:59'), '2026-09-11T06:59:00.000Z')
  // 11/01 之后是 PST (-08:00)
  assert.equal(atPT('2026-11-20', '23:59'), '2026-11-21T07:59:00.000Z')
})

test('CS 61C 的截止是 23:59:59，不是 23:59:00', () => {
  assert.equal(atPT('2026-12-01', '23:59:59'), '2026-12-02T07:59:59.000Z')
})

test('解析没有年份的日期（含 HTML 转义的斜杠）', () => {
  assert.equal(parseBareDate('Due 9&#x2F;08', 2026).iso, '2026-09-08')
  assert.equal(parseBareDate('(due Tue Sep 08)', 2026).iso, '2026-09-08')
  assert.equal(parseBareDate('Wed Aug 26', 2026).iso, '2026-08-26')
  assert.equal(parseBareDate('Mon09/07', 2026).iso, '2026-09-07')
  assert.equal(parseBareDate('12/14', 2026).iso, '2026-12-14')
  assert.equal(parseBareDate('没有日期', 2026), null)
})

test('跨夏令时和跨年加天数都不能错位', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01')
  assert.equal(addDays('2026-11-01', 1), '2026-11-02')   // DST 当天
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(eachDay('2026-08-26', '2026-08-30').length, 5)
})

test('ptISODate 按太平洋时区取日期，不是 UTC 日期', () => {
  // 2026-09-11T06:00Z 在太平洋还是 9/10 晚上 11 点
  assert.equal(ptISODate(new Date('2026-09-11T06:00:00Z')), '2026-09-10')
})

test('registrar 期末 Group 映射：61C 的推算必须和官网公布的一致', () => {
  // 这条是整个推算逻辑的锚点 —— 61C 官网公布的是 12/14 11:30-14:30
  const c61c = inferFinalExam('MWF', '11:00')
  assert.equal(c61c.date, '2026-12-14')
  assert.equal(c61c.start, '11:30')
  assert.equal(c61c.end, '14:30')

  // 61B 官网没公布，靠这条规则推算
  const c61b = inferFinalExam('MWF', '14:00')
  assert.equal(c61b.date, '2026-12-17')
  assert.equal(c61b.start, '15:00')

  // M/W/F/MW/MF/WF 都按 MWF 处理
  assert.equal(inferFinalExam('MW', '14:00').date, '2026-12-17')
  assert.equal(inferFinalExam('F', '14:00').date, '2026-12-17')
  // 含 Tu 或 Th 按 TuTh 处理
  assert.equal(inferFinalExam('TuTh', '14:00').date, '2026-12-15')
})

test('假期表', () => {
  assert.equal(HOLIDAYS.length, 5)
  for (const d of ['2026-09-07', '2026-11-11', '2026-11-25', '2026-11-26', '2026-11-27']) {
    assert.ok(isHoliday(d), `${d} 应当是假期`)
  }
  assert.ok(!isHoliday('2026-09-08'))
})
