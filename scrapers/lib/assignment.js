// 从课表单元格里抠出作业名和截止日期。
//
// 三门课的写法不一样，但都是"名字 + 一个或多个 due 日期"这个形状：
//   CS 61C  "Lab 1: C Due 9/08"            "Project 2: CS61Classify A: Due 9/24 B: Due 10/08"
//   CS 61B  "Tools HW1: Setup (due Tue Sep 08)"
//   CS 162  "HW0 Due" / "Project 0 Due"     （日期在行的 date 列上，不在单元格里）

import { parseBareDate } from './dates.js'

// 匹配 "Due 9/08"、"due Tue Sep 08"、"(due Sep 08)" 等
const DUE_RE = /\(?\s*due\s*:?\s*((?:[A-Za-z]{3,9}\.?\s+)?(?:\d{1,2}\s*\/\s*\d{1,2}|[A-Za-z]{3,9}\.?\s+\d{1,2}))\s*\)?/gi
// 匹配 "A: Due 9/24"、"B: Due 10/08" 这种分段
const PART_RE = /\b([A-Z])\s*:\s*due\s*:?\s*(\d{1,2}\s*\/\s*\d{1,2}|[A-Za-z]{3,9}\.?\s+\d{1,2})/gi

/**
 * @param {string} text 单元格纯文本
 * @param {number} year 学期年份
 * @returns {{title: string, parts: Array<{part: string|null, iso: string}>}}
 */
export function extractDues(text, year) {
  const raw = String(text || '').replace(/&#x2F;/gi, '/').replace(/\s+/g, ' ').trim()
  if (!raw) return { title: '', parts: [] }

  const parts = []

  // 先找分段（A: Due .. B: Due ..），它比通用 due 更具体
  PART_RE.lastIndex = 0
  let m
  while ((m = PART_RE.exec(raw))) {
    const d = parseBareDate(m[2], year)
    if (d) parts.push({ part: m[1], iso: d.iso })
  }

  if (!parts.length) {
    DUE_RE.lastIndex = 0
    while ((m = DUE_RE.exec(raw))) {
      const d = parseBareDate(m[1], year)
      if (d) parts.push({ part: null, iso: d.iso })
    }
  }

  // 标题 = 去掉所有 due 片段后剩下的部分
  let title = raw.replace(PART_RE, ' ').replace(DUE_RE, ' ')
  title = title.replace(/\s+/g, ' ').replace(/[\s,;:·—-]+$/, '').trim()

  return { title, parts }
}

/** 有没有提到截止/deadline（用于 CS 162 那种日期在行上的表） */
export const mentionsDue = (text) => /\bdue\b|\bdeadline\b/i.test(String(text || ''))
