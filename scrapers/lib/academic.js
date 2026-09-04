// UC Berkeley Fall 2026 学期骨架 —— 全是静态常量，一学期不会变，不需要抓取。
//
// 来源：教务处 2026-27 学年历 PDF 和期末考试 Group 表
//   https://registrar.berkeley.edu/wp-content/uploads/UCB_AcademicCalendar_2026-27_a11y.pdf
//   https://registrar.berkeley.edu/calendars/final-exam-groups/

export const TERM = {
  name: 'Fall 2026',
  year: 2026,
  instructionStart: '2026-08-26',   // 开课
  formalClassesEnd: '2026-12-04',   // 正式课程结束
  rrrStart: '2026-12-07',           // RRR 周
  rrrEnd: '2026-12-11',             // 也是 last day of instruction
  finalsStart: '2026-12-14',
  finalsEnd: '2026-12-18',
}

// 学期内的假期 / 非教学日。这几天不上课，必须从每周固定课程里排除掉 ——
// Google Calendar 的 ICS 里不一定带了 EXDATE，不能假定。
export const HOLIDAYS = [
  { date: '2026-09-07', name: 'Labor Day' },
  { date: '2026-11-11', name: 'Veterans Day' },
  { date: '2026-11-25', name: 'Non-instructional day' },
  { date: '2026-11-26', name: 'Thanksgiving' },
  { date: '2026-11-27', name: 'Day after Thanksgiving' },
]

const HOLIDAY_SET = new Set(HOLIDAYS.map((h) => h.date))
export const isHoliday = (isoDate) => HOLIDAY_SET.has(isoDate)

// 期末考试 Group 表（Fall 2026）。四个时段：8–11、11:30–14:30、15–18、19–22。
//
// 教务处的映射规则原文：
//   "If a class is offered on M, W, F, MW, MF, or WF, it will fall under the same
//    start times as MWF. If a class is offered on Tu or Th, it will fall under the
//    same start times as TuTh."
//
// 注意：表里还有若干**按课程类别的覆盖档**（Group 3 化学/Econ 140、Group 6 Econ 1/DATA C8、
// Group 10 线上课程、Group 12 Stat 20、Group 19 English 1A），会盖过上课时段规则。
// 所以推算值只能兜底 —— 课程官网公布的时间永远优先。
export const FINAL_EXAM_GROUPS = [
  { group: 1,  date: '2026-12-14', start: '08:00', end: '11:00', pattern: 'MWF',  at: '10:00' },
  { group: 2,  date: '2026-12-14', start: '11:30', end: '14:30', pattern: 'MWF',  at: '11:00' },
  { group: 3,  date: '2026-12-14', start: '15:00', end: '18:00', pattern: null,   note: 'Common exam: Chem 1A/1B/3A/3B/4A/4B/32, Econ 140' },
  { group: 4,  date: '2026-12-14', start: '19:00', end: '22:00', pattern: 'MWF',  at: '08:00' },
  { group: 5,  date: '2026-12-15', start: '08:00', end: '11:00', pattern: 'TuTh', at: '14:00' },
  { group: 6,  date: '2026-12-15', start: '11:30', end: '14:30', pattern: null,   note: 'Common exam: Econ 1 & 100B, UGBA 101B, DATA C8' },
  { group: 7,  date: '2026-12-15', start: '15:00', end: '18:00', pattern: 'TuTh', at: '09:00' },
  { group: 8,  date: '2026-12-15', start: '19:00', end: '22:00', pattern: 'MWF',  at: '15:00' },
  { group: 9,  date: '2026-12-16', start: '08:00', end: '11:00', pattern: 'TuTh', at: '11:00' },
  { group: 10, date: '2026-12-16', start: '11:30', end: '14:30', pattern: null,   note: 'Online courses & elementary foreign languages' },
  { group: 11, date: '2026-12-16', start: '15:00', end: '18:00', pattern: 'TuTh', at: '08:00' },
  { group: 12, date: '2026-12-16', start: '19:00', end: '22:00', pattern: 'MWF',  at: '13:00' },
  { group: 13, date: '2026-12-17', start: '08:00', end: '11:00', pattern: 'MWF',  at: '16:00' },
  { group: 14, date: '2026-12-17', start: '11:30', end: '14:30', pattern: 'TuTh', at: '17:00+' },
  { group: 15, date: '2026-12-17', start: '15:00', end: '18:00', pattern: 'MWF',  at: '14:00' },
  { group: 16, date: '2026-12-17', start: '19:00', end: '22:00', pattern: 'MWF',  at: '09:00' },
  { group: 17, date: '2026-12-18', start: '08:00', end: '11:00', pattern: 'TuTh', at: '12:00' },
  { group: 18, date: '2026-12-18', start: '11:30', end: '14:30', pattern: 'MWF',  at: '12:00' },
  { group: 19, date: '2026-12-18', start: '15:00', end: '18:00', pattern: 'TuTh', at: '10:00' },
  { group: 20, date: '2026-12-18', start: '19:00', end: '22:00', pattern: 'TuTh', at: '15:00' },
]

// 有些 group 覆盖多个开课时间（如 Group 1 是 MWF 10am，但 9:30 也归 Group 16）。
// 这里把教务处表里写的"9 & 9:30"这类合并时间展开成精确查表。
const START_TIME_ALIASES = {
  MWF:  { '09:30': '09:00', '15:30': '15:00', '16:30': '16:00', '12:30': '12:00' },
  TuTh: { '09:30': '09:00', '12:30': '12:00', '13:00': '12:00', '15:30': '15:00', '16:00': '15:00' },
}

/**
 * 按 registrar 的规则推算某门课的期末考试时段。
 *
 * @param {string} days  上课日，如 'MWF' / 'MW' / 'TuTh' / 'Tu'
 * @param {string} start 上课开始时间 'HH:MM'（24 小时制）
 * @returns {{group, date, start, end, inferred: true} | null}
 */
export function inferFinalExam(days, start) {
  const pattern = normalizePattern(days)
  if (!pattern) return null

  let at = start
  const alias = START_TIME_ALIASES[pattern]?.[start]
  if (alias) at = alias

  // TuTh 下午 5 点及以后统一归 Group 14
  if (pattern === 'TuTh' && toMinutes(at) >= toMinutes('17:00')) {
    const g = FINAL_EXAM_GROUPS.find((x) => x.at === '17:00+')
    return g ? { ...g, inferred: true } : null
  }

  const hit = FINAL_EXAM_GROUPS.find((g) => g.pattern === pattern && g.at === at)
  return hit ? { group: hit.group, date: hit.date, start: hit.start, end: hit.end, inferred: true } : null
}

// M / W / F / MW / MF / WF / MWF → 'MWF'；含 Tu 或 Th → 'TuTh'
function normalizePattern(days) {
  const d = String(days).replace(/[\s,\/]/g, '')
  if (/Tu|Th/.test(d)) return 'TuTh'
  if (/^[MWF]+$/.test(d)) return 'MWF'
  return null
}

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}
