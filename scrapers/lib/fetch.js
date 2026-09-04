// 有礼貌的抓取：带 UA、超时、重试。课程网站是别人的服务器，别把它打疼了。

const UA = 'Schedule_Design/1.0 (personal course-deadline aggregator; 4 courses; hourly)'

export async function fetchText(url, { timeout = 25000, retries = 2, headers = {} } = {}) {
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(1000 * attempt)
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeout)
    try {
      const res = await fetch(url, {
        signal: ac.signal,
        headers: { 'User-Agent': UA, Accept: '*/*', ...headers },
        redirect: 'follow',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
      return await res.text()
    } catch (e) {
      lastErr = e
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastErr
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
