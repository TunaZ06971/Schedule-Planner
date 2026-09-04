// 课程配置。改这里就能加/删课程或换学期。
// color 用的是色相名（见 config/palette.js），不是 hex —— 用户能在网页上改，改动存 state.json。

export const COURSES = [
  {
    key: 'cs61b',
    name: 'COMPSCI 61B',
    full: 'CS 61B — Data Structures',
    color: 'green',              // Berkeleytime COLOR_ORDER 第 2 位；用户可在网页上改
    home: 'https://fa26.datastructur.es/',
    units: 4,
    // 课程官网 policies 页写明的截止时间
    dueTime: '23:59',
    // 免罚宽限期（小时）。61B 有 +24h grace period —— 实际可交时间比课表上晚一天，
    // 这正是最容易记错的地方，UI 上要显示出来。
    graceHours: 24,
    lecture: { days: 'MWF', start: '14:00', end: '15:00', location: 'Wheeler 150' },
    ics: [
      { name: 'Website Calendar', url: 'https://calendar.google.com/calendar/ical/c_3934560934dc47fe42651a9b8282821772c901c6fc91d15484f96c6ec60c6fb2%40group.calendar.google.com/public/basic.ics' },
    ],
  },
  {
    key: 'cs61c',
    name: 'COMPSCI 61C',
    full: 'CS 61C — Great Ideas in Computer Architecture',
    color: 'red',                // COLOR_ORDER 第 3 位；用户可在网页上改
    home: 'https://cs61c.org/fa26/',
    units: 4,
    dueTime: '23:59:59',         // 官网明写是 59 秒，不是 00 秒
    graceHours: 0,
    lecture: { days: 'MWF', start: '11:00', end: '12:00', location: 'Gateway 1210' },
    ics: [
      { name: 'Events', url: 'https://calendar.google.com/calendar/ical/c_959d3a1aa13cb5195d605d04ac7ca6133655dfc4d13b9e6db7bfc79c0382588b%40group.calendar.google.com/public/basic.ics' },
    ],
  },
  {
    key: 'cs162',
    name: 'COMPSCI 162',
    full: 'CS 162 — Operating Systems',
    color: 'blue',               // COLOR_ORDER 第 1 位；用户可在网页上改
    home: 'https://cs162.org/',
    units: 4,
    dueTime: '23:59:00',
    graceHours: 24,              // policies: 全局 1 天免罚宽限
    lecture: { days: 'TuTh', start: '14:00', end: '15:30', location: 'The Gateway Building 1220' },
    ics: [
      { name: 'Lectures',    url: 'https://calendar.google.com/calendar/ical/c_n7fq2g7gmq9vh7rv88jh86sdgs%40group.calendar.google.com/public/basic.ics' },
      { name: 'Discussions', url: 'https://calendar.google.com/calendar/ical/c_064ssdmabhll0hgk2k9rlogbjg%40group.calendar.google.com/public/basic.ics' },
    ],
  },
]

export const byKey = Object.fromEntries(COURSES.map((c) => [c.key, c]))

// 工作量权重：算"哪几天特别忙"时用。project/exam 明显比一个 lab 重。
export const LOAD_WEIGHT = {
  exam: 5,
  group_project: 4,
  project: 3,
  homework: 2,
  checkpoint: 2,
  lab: 1,
  discussion: 0.5,
  custom: 1,
  other: 1,
}
