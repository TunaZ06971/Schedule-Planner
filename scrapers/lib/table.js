// HTML 表格 → 对齐好的二维网格。
//
// 为什么需要这个：三门课的课表全都用 rowspan 合并周次和跨天条目。逐行读 <td> 必然错位 ——
// 比如 61B 第一行有 7 个 cell，第二行只有 4 个，因为前 3 列被上一行的 rowspan 占着。
// 直接按下标取列会把「Lab」列的内容读成「HW」列。
//
// 做法：维护一组"进位"记录 (列号, 还剩几行, 单元格)，每读一行就先把这些进位重新注入到
// 它们占据的列，剩下的位置才按顺序填本行真正的 <td>。

/**
 * @param {*} $      cheerio 实例
 * @param {*} table  表格元素
 * @returns {Array<Array<element|undefined>>} 每行都是对齐好的列数组
 */
export function gridFromTable($, table) {
  const rows = $(table).find('tr').toArray()
  const grid = []
  const carries = [] // { col, colspan, remaining, cell }

  for (const tr of rows) {
    const cells = $(tr).children('td, th').toArray()

    // 本行仍然有效的进位：列号 → 进位记录
    const active = new Map()
    for (const c of carries) {
      if (c.remaining > 0) {
        for (let k = 0; k < c.colspan; k++) active.set(c.col + k, c)
      }
    }

    const out = []
    const used = new Set()
    const maxCarryCol = active.size ? Math.max(...active.keys()) : -1
    let ci = 0
    let col = 0
    let guard = 0

    while ((ci < cells.length || col <= maxCarryCol) && guard++ < 200) {
      const carried = active.get(col)
      if (carried) {
        out[col] = carried.cell
        used.add(carried)
        col++
        continue
      }
      if (ci >= cells.length) { col++; continue }

      const cell = cells[ci++]
      const rowspan = int($(cell).attr('rowspan'))
      const colspan = int($(cell).attr('colspan'))
      for (let k = 0; k < colspan; k++) out[col + k] = cell
      if (rowspan > 1) carries.push({ col, colspan, remaining: rowspan - 1, cell })
      col += colspan
    }

    for (const c of used) c.remaining--
    for (let i = carries.length - 1; i >= 0; i--) {
      if (carries[i].remaining <= 0) carries.splice(i, 1)
    }

    grid.push(out)
  }

  return grid
}

const int = (v) => {
  const n = parseInt(v || '1', 10)
  return Number.isFinite(n) && n > 0 ? n : 1
}

/** 取单元格纯文本，把 <br> 当成空格，压掉多余空白 */
export function cellText($, cell) {
  if (!cell) return ''
  const c = $(cell).clone()
  c.find('br').replaceWith(' ')
  return c.text().replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
}

/** 取单元格里第一个链接的绝对地址 */
export function cellLink($, cell, base) {
  if (!cell) return ''
  const href = $(cell).find('a[href]').first().attr('href')
  if (!href) return ''
  try { return new URL(href, base).toString() } catch { return href }
}

/** 找出表头里每一列的下标，按列名关键词匹配（大小写不敏感） */
export function headerIndex($, table, keywords) {
  const rows = $(table).find('tr').toArray()
  for (const tr of rows.slice(0, 3)) {
    const cells = $(tr).children('th, td').toArray()
    if (!cells.length) continue
    const labels = cells.map((c) => cellText($, c).toLowerCase())
    const idx = {}
    let hits = 0
    for (const [key, words] of Object.entries(keywords)) {
      const at = labels.findIndex((l) => l && words.some((w) => l.includes(w)))
      if (at >= 0) { idx[key] = at; hits++ }
    }
    if (hits >= 2) return idx
  }
  return null
}
