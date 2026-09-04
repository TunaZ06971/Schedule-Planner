// 导出成 .ics，可以直接在 Google / Apple 日历里订阅。
//
// 用户这次选的是网页，这个只是顺手做的附赠端点 —— 数据都规范化好了，成本很低。

const CRLF = '\r\n'
const ICS_HOSTNAME = process.env.ICS_HOSTNAME || 'schedule.cks06971.com'

// ICS 规范要求折行到 75 字节；中文是多字节，按字节切才不会切坏字符
function fold(line) {
  const bytes = Buffer.from(line, 'utf8')
  if (bytes.length <= 74) return line
  const out = []
  let start = 0
  while (start < bytes.length) {
    const width = out.length === 0 ? 74 : 73
    let end = Math.min(start + width, bytes.length)
    // 别把一个 UTF-8 字符从中间切开：续接字节形如 10xxxxxx
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--
    out.push((out.length ? ' ' : '') + bytes.subarray(start, end).toString('utf8'))
    start = end
  }
  return out.join(CRLF)
}

const esc = (s) =>
  String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')

const stamp = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

const TYPE_LABEL = {
  homework: 'Homework', lab: 'Lab', project: 'Project', group_project: 'Group Project',
  discussion: 'Discussion', exam: 'Exam', lecture: 'Lecture', custom: 'Custom',
}

export function buildICS(payload) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Schedule_Design//Course Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Course Deadlines',
    'X-WR-TIMEZONE:America/Los_Angeles',
  ]

  const nameOf = Object.fromEntries((payload.courses || []).map((c) => [c.key, c.name]))
  const now = stamp(new Date().toISOString())

  for (const e of payload.events || []) {
    if (!e.due && !e.start) continue
    const course = nameOf[e.course] || e.course || ''
    const label = TYPE_LABEL[e.type] || e.type
    const summary = `${course} ${label}｜${e.title}`

    lines.push('BEGIN:VEVENT')
    lines.push(fold(`UID:${e.id}@${ICS_HOSTNAME}`))
    lines.push(`DTSTAMP:${now}`)

    if (e.start && e.end) {
      // 考试之类有明确起止的，按时间段
      lines.push(`DTSTART:${stamp(e.start)}`)
      lines.push(`DTEND:${stamp(e.end)}`)
    } else {
      // deadline 按一个 15 分钟的点事件，落在截止时刻
      const due = new Date(e.due)
      lines.push(`DTSTART:${stamp(due.toISOString())}`)
      lines.push(`DTEND:${stamp(new Date(due.getTime() + 15 * 60000).toISOString())}`)
    }

    lines.push(fold(`SUMMARY:${esc(summary)}`))

    const notes = []
    // 个人标注排在最前 —— 订阅到手机日历上，这才是你自己写的东西
    if (e.userNote) notes.push(`📝 ${e.userNote}`)
    if (e.provisional) notes.push('⚠️ Marked tentative by the course staff — the date may change')
    if (e.inferred) notes.push(`⚠️ ${e.inferredNote || 'Inferred from the registrar\u2019s rules — not officially published'}`)
    if (e.timeAssumed) notes.push('⚠️ No specific time published')
    if (e.hardDeadline) notes.push('Hard deadline: no slip days, late = 0')
    if (e.userUrl) notes.push(e.userUrl)
    if (e.url && e.url !== e.userUrl) notes.push(e.url)
    if (notes.length) lines.push(fold(`DESCRIPTION:${esc(notes.join('\n'))}`))
    if (e.location) lines.push(fold(`LOCATION:${esc(e.location)}`))

    // deadline 提前 1 天提醒
    lines.push('BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', fold(`DESCRIPTION:${esc(summary)}`), 'END:VALARM')
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.join(CRLF) + CRLF
}
