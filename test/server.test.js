// 服务端接口的冒烟测试。
//
// 为什么加这个：有一次重构把 safeUrl / expandCustomBlock 两个辅助函数误删了，
// **每个写接口都在 500**，而 `npm test` 依然全绿 —— 因为原来的测试只覆盖抓取器，
// 一行服务端代码都没跑到。那种"测试通过但服务是坏的"最危险。
//
// 这里起一个真的 HTTP 服务，用真的请求打一遍，重点盯两件事：
//   1. 公开接口不能漏个人信息
//   2. 写接口真的能写（哪怕只是不 500）

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const TOKEN = 'test-token-do-not-use'
const PORT = 8199
const BASE = `http://127.0.0.1:${PORT}`

let child
let dataDir

const get = (p, headers = {}) => fetch(BASE + p, { headers })
const post = (p, body, token = TOKEN) => fetch(BASE + p, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-auth': token },
  body: JSON.stringify(body),
})

before(async () => {
  // 用一个临时 data 目录，绝不碰真实数据
  dataDir = await mkdtemp(path.join(tmpdir(), 'schedule-test-'))
  child = spawn(process.execPath, ['server/server.js'], {
    env: { ...process.env, PORT: String(PORT), WRITE_TOKEN: TOKEN, DATA_DIR: dataDir, TZ: 'America/Los_Angeles' },
    stdio: 'ignore',
  })
  // 等到**数据也就绪**为止。只等 /healthz 是不够的：HTTP 一监听就通了，
  // 但首次启动那次抓取还在跑，此时 /api/data 是 ready:false 的空壳。
  for (let i = 0; i < 90; i++) {
    try {
      const r = await get('/api/data')
      if (r.ok && (await r.json()).ready) return
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('服务没能在 90 秒内把数据准备好')
})

after(async () => {
  child?.kill('SIGTERM')
  if (dataDir) await rm(dataDir, { recursive: true, force: true })
})

test('写接口能正常工作（回归：曾经因为误删辅助函数全部 500）', async () => {
  const r1 = await post('/api/custom', {
    action: 'add',
    event: { title: '测试事件', kind: 'deadline', dueDate: '2026-10-01', type: 'homework', url: 'https://example.com/x' },
  })
  assert.equal(r1.status, 200, `POST /api/custom 应 200，实际 ${r1.status}`)
  const j1 = await r1.json()
  assert.equal(j1.custom.length, 1)
  assert.equal(j1.custom[0].url, 'https://example.com/x', 'safeUrl 应放行 https')

  const r2 = await post('/api/item', { id: 'x:y:z', note: '备注', url: 'javascript:alert(1)' })
  assert.equal(r2.status, 200)
  const j2 = await r2.json()
  assert.equal(j2.overrides['x:y:z'].url, '', 'safeUrl 应拦下 javascript:')
  assert.equal(j2.overrides['x:y:z'].note, '备注')

  assert.equal((await post('/api/colors', { course: 'cs61b', hue: 'violet' })).status, 200)
})

test('时间段事件会展开成课次（回归：expandCustomBlock 曾被误删）', async () => {
  const r = await post('/api/custom', {
    action: 'add',
    event: { title: '每周块', kind: 'block', dueDate: '2026-09-04', startTime: '15:00', endTime: '17:00', repeat: 'weekly' },
  })
  assert.equal(r.status, 200)
  const mine = await (await get('/api/mine', { 'x-auth': TOKEN })).json()
  const blocks = mine.meetings.filter((m) => m.title === '每周块')
  assert.ok(blocks.length > 5, `每周重复应展开成多场，实际 ${blocks.length}`)
  assert.ok(blocks.every((b) => b.startClock === '15:00' && b.endClock === '17:00'))
})

test('公开的 /api/data 不能带任何个人信息', async () => {
  const pub = await (await get('/api/data')).json()
  const raw = JSON.stringify(pub)

  assert.equal(pub.state, undefined, 'state 不该出现在公开接口里')
  assert.ok(!raw.includes('测试事件'), '自定义事件不该出现')
  assert.ok(!raw.includes('每周块'), '自定义时间段不该出现')
  assert.ok(!raw.includes('备注'), '个人备注不该出现')

  // 最关键的一条：不能从公开数据推出"他选了哪个 section"
  assert.equal(pub.meetings.filter((m) => m.type !== 'lecture').length, 0,
    '公开的 meetings 只能有 lecture —— section 场次会暴露选了哪个')
  assert.ok(pub.sections.length > 20, 'section 清单是公开课程信息，应当完整给出')

  // 课程配色用默认值，不是用户改过的（上面刚把 cs61b 改成 violet）
  assert.equal(pub.courses.find((c) => c.key === 'cs61b').colorHue, 'green',
    '公开视图应显示配置里的默认配色，而不是用户的个人偏好')
})

test('/api/mine 必须要口令', async () => {
  assert.equal((await get('/api/mine')).status, 401, '无口令应 401')
  assert.equal((await get('/api/mine', { 'x-auth': 'wrong' })).status, 401, '错口令应 401')

  const ok = await get('/api/mine', { 'x-auth': TOKEN })
  assert.equal(ok.status, 200)
  const mine = await ok.json()
  assert.equal(mine.state.colors.cs61b, 'violet', '对口令应拿到个人配色')
  assert.ok(mine.custom.some((c) => c.title === '测试事件'))
})

test('写接口一律要口令', async () => {
  for (const [p, body] of [
    ['/api/state', { id: 'a', done: true }],
    ['/api/custom', { action: 'add', event: { title: 'x', dueDate: '2026-10-01' } }],
    ['/api/item', { id: 'a', note: 'x' }],
    ['/api/colors', { course: 'cs61b', hue: 'red' }],
    ['/api/sections', { course: 'cs61b', keys: [] }],
  ]) {
    assert.equal((await post(p, body, '')).status, 401, `${p} 无口令应 401`)
    assert.equal((await post(p, body, 'wrong')).status, 401, `${p} 错口令应 401`)
  }
})

test('ICS 订阅：不带口令只有课程内容，带口令才含个人的', async () => {
  const pub = await (await get('/api/calendar.ics')).text()
  assert.ok(pub.includes('BEGIN:VCALENDAR'))
  assert.ok(!pub.includes('测试事件'), '匿名订阅不该含自定义事件')
  assert.ok(!pub.includes('备注'), '匿名订阅不该含个人备注')

  const mine = await (await get(`/api/calendar.ics?t=${TOKEN}`)).text()
  assert.ok(mine.includes('测试事件'), '带口令订阅应含自定义事件')

  const bad = await (await get('/api/calendar.ics?t=wrong')).text()
  assert.equal(bad, pub, '错口令的订阅内容应和匿名完全一致')
})
