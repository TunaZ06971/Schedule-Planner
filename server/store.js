// data/ 目录的读写。原子写（先写临时文件再 rename），避免进程被杀时留下半个文件。

import { readFile, writeFile, rename, mkdir, readdir, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data')
const EVENTS_FILE = path.join(DATA_DIR, 'events.json')
const STATE_FILE = path.join(DATA_DIR, 'state.json')
const SNAP_DIR = path.join(DATA_DIR, 'snapshots')
const MAX_SNAPSHOTS = 60

export async function ensureDirs() {
  await mkdir(DATA_DIR, { recursive: true })
  await mkdir(SNAP_DIR, { recursive: true })
}

async function readJSON(file, fallback) {
  try {
    if (!existsSync(file)) return fallback
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

async function writeJSON(file, data) {
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await rename(tmp, file)
}

export const loadEvents = () => readJSON(EVENTS_FILE, null)
export const saveEvents = (d) => writeJSON(EVENTS_FILE, d)

export const loadState = () =>
  readJSON(STATE_FILE, { done: {}, custom: [], sections: {}, updatedAt: null })
export const saveState = (s) => writeJSON(STATE_FILE, { ...s, updatedAt: new Date().toISOString() })

/**
 * 清掉已经退掉的课留下的残渣。
 *
 * `state.sections` 是按课程 key 存的（用户选的 discussion / lab 时段）。退掉一门课之后，
 * 那门课的 key 还留在文件里，既不会报错也不会显示，就是一直躺着。顺手清掉。
 */
export function pruneState(state, validKeys) {
  const valid = new Set(validKeys)
  const sections = {}
  let dropped = 0
  for (const [key, v] of Object.entries(state.sections || {})) {
    if (valid.has(key)) sections[key] = v
    else dropped++
  }
  return { state: { ...state, sections }, dropped }
}

export async function saveSnapshot(data) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  await writeJSON(path.join(SNAP_DIR, `${stamp}.json`), data)
  // 只留最近 N 份，别让磁盘慢慢涨满
  const files = (await readdir(SNAP_DIR)).filter((f) => f.endsWith('.json')).sort()
  for (const f of files.slice(0, Math.max(0, files.length - MAX_SNAPSHOTS))) {
    await unlink(path.join(SNAP_DIR, f)).catch(() => {})
  }
}

/**
 * 把新一轮抓取结果并进已有数据 —— **失败的课保留上一次的好数据**。
 *
 * 这是整个可靠性设计的核心：课程网站改版、临时 502、网络抖动都会让某一门抓取失败。
 * 如果直接覆盖，用户就会看到一个空日历，比看到旧数据危险得多。
 */
export function mergeScrape(previous, fresh) {
  const merged = {
    term: fresh.term,
    holidays: fresh.holidays,
    lastRefresh: fresh.scrapedAt,
    courses: {},
  }

  for (const [key, next] of Object.entries(fresh.courses)) {
    const prev = previous?.courses?.[key]

    if (next.ok) {
      merged.courses[key] = {
        ...next,
        lastSuccessAt: next.scrapedAt,
        staleSince: null,
      }
      continue
    }

    // 这一轮失败了：保留上一次的好数据，但把错误和"多久没成功"记下来
    if (prev) {
      merged.courses[key] = {
        ...prev,
        ok: false,
        error: next.error,
        scrapedAt: next.scrapedAt,
        staleSince: prev.staleSince || prev.lastSuccessAt || next.scrapedAt,
      }
    } else {
      // 从来没成功过
      merged.courses[key] = { ...next, lastSuccessAt: null, staleSince: next.scrapedAt }
    }
  }

  return merged
}
