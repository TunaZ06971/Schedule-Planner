// 和上一次抓取比对，找出变了什么。
//
// 这条直接回应用户说的"我很容易记错"：课程组把 deadline 改了 / 加了新作业 / 撤掉了某项，
// 光看日历是看不出来的。有了 diff，页面上就能顶一条「本周变更」提示。

/** 把一次抓取结果压成 id → 关键字段 的映射 */
function indexEvents(data) {
  const map = new Map()
  for (const course of Object.values(data?.courses || {})) {
    for (const e of course.events || []) {
      map.set(e.id, {
        id: e.id,
        course: e.course,
        type: e.type,
        title: e.title,
        dueDate: e.dueDate,
        due: e.due,
        provisional: e.provisional,
      })
    }
  }
  return map
}

/**
 * @returns {Array<{kind:'added'|'moved'|'removed'|'confirmed', ...}>}
 */
export function diffEvents(previous, next) {
  if (!previous) return []
  const a = indexEvents(previous)
  const b = indexEvents(next)
  const changes = []

  for (const [id, cur] of b) {
    const old = a.get(id)
    if (!old) {
      changes.push({ kind: 'added', ...cur })
      continue
    }
    if (old.dueDate !== cur.dueDate) {
      changes.push({ kind: 'moved', ...cur, from: old.dueDate, to: cur.dueDate })
    }
    // 从"暂定"变成"定稿" —— 对 61B 和 162 的考试特别重要
    if (old.provisional && !cur.provisional) {
      changes.push({ kind: 'confirmed', ...cur })
    }
  }

  for (const [id, old] of a) {
    if (!b.has(id)) changes.push({ kind: 'removed', ...old })
  }

  return changes
}

/** 保留最近 N 条变更，新的在前 */
export function appendChanges(history, changes, at, limit = 200) {
  const stamped = changes.map((c) => ({ ...c, at }))
  return [...stamped, ...(history || [])].slice(0, limit)
}
