// 日期工具。这个项目里所有时间都锚在 America/Los_Angeles。
//
// 为什么不能用 new Date('2026-09-10T23:59:00-07:00') 这种硬编码偏移：
// 2026-11-01 之后加州从 PDT(-07:00) 切到 PST(-08:00)。学期跨越了这个切换点，
// 写死偏移会让 11 月之后的 deadline 全部差一小时。

const TZ = 'America/Los_Angeles'

// 求某个时刻在 TZ 下的 UTC 偏移（毫秒）
function tzOffsetMs(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((a, p) => ((a[p.type] = p.value), a), {})

  const asUTC = Date.UTC(
    +parts.year, +parts.month - 1, +parts.day,
    +parts.hour % 24, +parts.minute, +parts.second,
  )
  return asUTC - date.getTime()
}

/**
 * 把一个"太平洋时间的墙上时钟"转成真正的 Date。
 * 例：ptDate(2026, 11, 20, 23, 59) → 2026-11-20 23:59 PST
 */
export function ptDate(y, mo, d, h = 0, mi = 0, s = 0) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s)
  // 迭代两次：第一次用猜测时刻求偏移，第二次用修正后的时刻再求一遍，
  // 这样跨 DST 边界也能收敛到正确值。
  let ts = guess - tzOffsetMs(new Date(guess))
  ts = guess - tzOffsetMs(new Date(ts))
  return new Date(ts)
}

/** Date → 'YYYY-MM-DD'（按太平洋时区取日期，不是 UTC 日期） */
export function ptISODate(date) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).reduce((a, x) => ((a[x.type] = x.value), a), {})
  return `${p.year}-${p.month}-${p.day}`
}

/** Date → 'HH:MM'（太平洋时区） */
export function ptTime(date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour12: false, hour: '2-digit', minute: '2-digit',
  }).format(date)
}

/** Date → 太平洋时区的星期几，0=周日 */
export function ptWeekday(date) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(date)
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name)
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

/**
 * 解析课程网站上那些没有年份的日期，补上学期年份。
 * 认得的写法：'9/08'、'9/8'、'Sep 08'、'Sept 8'、'Tue Sep 08'、'Wed<br>Aug 26'
 *
 * @param {string} text
 * @param {number} year 学期年份
 * @returns {{month, day, iso} | null}
 */
export function parseBareDate(text, year) {
  if (!text) return null
  // 先把 HTML 转义的斜杠还原（CS 61C 会把 / 转成 &#x2F;）
  const s = String(text).replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/').replace(/\s+/g, ' ').trim()

  let m = s.match(/(\d{1,2})\s*\/\s*(\d{1,2})/)
  if (m) return build(+m[1], +m[2], year)

  m = s.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})\b/)
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()]
    if (mo) return build(mo, +m[2], year)
  }
  return null
}

function build(month, day, year) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return { month, day, iso }
}

/** 'YYYY-MM-DD' + 'HH:MM[:SS]' → ISO 字符串（带正确的 PT 偏移） */
export function atPT(isoDate, clock = '23:59') {
  const [y, mo, d] = isoDate.split('-').map(Number)
  const [h, mi, sec] = clock.split(':').map(Number)
  return ptDate(y, mo, d, h || 0, mi || 0, sec || 0).toISOString()
}

/** 从 'YYYY-MM-DD' 往后数 n 天 */
export function addDays(isoDate, n) {
  const [y, mo, d] = isoDate.split('-').map(Number)
  return ptISODate(new Date(ptDate(y, mo, d, 12).getTime() + n * 86400000))
}

/** 闭区间内的每一天 */
export function eachDay(startISO, endISO) {
  const out = []
  let cur = startISO
  let guard = 0
  while (cur <= endISO && guard++ < 500) {
    out.push(cur)
    cur = addDays(cur, 1)
  }
  return out
}
