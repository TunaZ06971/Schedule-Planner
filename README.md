# Schedule Planner

<p align="center">
  <a href="#english"><img alt="English README" src="https://img.shields.io/badge/README-English-green?style=for-the-badge"></a>
  <a href="#中文"><img alt="中文 README" src="https://img.shields.io/badge/README-%E4%B8%AD%E6%96%87-blue?style=for-the-badge"></a>
</p>

<p align="center">
  <a href="https://schedule.cks06971.com/">Live Demo</a>
  ·
  <a href="https://schedule.cks06971.com/api/data">Public API</a>
  ·
  <a href="./deploy/DEPLOY.md">Deployment Guide</a>
</p>

<h2 id="english">English</h2>

Schedule Planner is a Berkeley course deadline calendar. It combines assignments, labs, projects, exams, and recurring class meetings for CS 61B, CS 61C, and CS 162 into one Pacific-time web app.

Live demo: <https://schedule.cks06971.com/>

## Demo

The live demo can be viewed without a token:

- `Calendar`: a Berkeleytime-style week grid. Deadlines sit in the all-day lane; lectures, discussions, and labs sit on the time grid.
- `List`: groups deadlines by today, this week, next week, and later, with countdowns, provisional labels, grace periods, and source links.
- `Workload`: shows a semester heatmap and highlights the busiest upcoming days.
- `Subscribe`: `/api/calendar.ics` can be subscribed to from Google Calendar or Apple Calendar.

Token-gated actions only affect the personal layer: completion marks, custom events, notes, private links, course colors, and selected sections. The public view does not expose that data.

## Highlights

- Multi-source aggregation: HTML schedule tables provide deadlines; public ICS feeds provide recurring class meetings.
- Pacific-time semantics: all dates and countdowns are interpreted in `America/Los_Angeles`.
- Stale-data fallback: if one course scrape fails, the app keeps the last successful data for that course and reports freshness.
- Low-count protection: each scraper has a minimum expected deadline count so silent parser regressions fail loudly.
- Privacy split: public APIs expose course facts only; personal state is behind token-protected endpoints.
- No frontend build step: `public/` is plain HTML/CSS/JS.

## Quick Start

Requires Node.js 20+.

```bash
npm install
WRITE_TOKEN="$(openssl rand -base64 24)" npm start
```

Then open <http://127.0.0.1:8132>.

Common commands:

```bash
npm start          # Start the web server
npm run scrape     # Run one scrape and print counts without writing production state
npm test           # Run regression tests
```

## Data Sources

Each course combines two public sources:

| Source | Purpose |
| --- | --- |
| Course homepage HTML schedule | Lab, homework, project, and exam dates |
| Public course Google Calendar ICS | Lecture, discussion, and lab time/location |

Academic term boundaries, holidays, and final-exam group mappings are static constants in `scrapers/lib/academic.js`.

Gradescope, PrairieLearn, Ed, and bCourses require authentication and are out of scope. This project reads only public course pages and public calendars.

## Project Structure

```text
config/
  courses.js          Course config, public ICS feeds, default colors, grace periods, units
  palette.js          Berkeleytime-style color tokens
scrapers/
  cs61b.js            CS 61B HTML schedule parser
  cs61c.js            CS 61C HTML schedule parser
  cs162.js            CS 162 HTML schedule parser
  index.js            Aggregates all courses and merges HTML deadlines with ICS meetings
  lib/
    table.js          rowspan/colspan-aware table grid parser
    dates.js          Date parsing, Pacific time, DST boundaries
    ics.js            ICS fetch, RRULE expansion, section summaries
    academic.js       Berkeley term skeleton and final-exam mapping
server/
  server.js           HTTP server, API, scheduled refresh, auth
  store.js            data/ persistence and stale-data merge behavior
  diff.js             Scrape result change detection
  ics-out.js          Calendar subscription export
public/
  index.html          App shell
  style.css           Berkeleytime-style layout and components
  app.js              Calendar, list, workload, and personal annotation UI
test/
  fixtures/           Minimized parser fixtures with external URLs stripped
  *.test.js           Scraper, date, table, server, and privacy-boundary tests
deploy/
  publish.sh          rsync deploy script; requires SERVER from the environment
  schedule.service    systemd unit; reads real secrets from /etc/schedule.env
  schedule.caddy      Caddy reverse proxy config
  DEPLOY.md           Deployment guide
```

`data/` is runtime state. It can contain scrape results, snapshots, completion marks, custom events, notes, private links, and selected sections. It is ignored by git and should not be committed.

## API And Privacy Boundary

| Endpoint | Access | Returns |
| --- | --- | --- |
| `GET /api/data` | Public | Course deadlines, lectures, section list, term info, default colors |
| `GET /api/mine` | Requires `x-auth` | Selected sections, completion state, custom events, notes, private links, personal colors |
| `POST /api/*` | Requires `x-auth` | All write operations |
| `GET /api/calendar.ics` | Public | Course deadlines only |
| `GET /api/calendar.ics?t=<token>` | Token in query | Adds personal notes and custom events |

This split is intentional: the public URL is safe to share for course deadlines without publishing personal schedule choices.

## Deployment

Before the first deployment, store the real write token on the server in `/etc/schedule.env`; never commit it. See `deploy/schedule.env.example`.

```bash
SERVER=deploy@example.com ./deploy/publish.sh
```

See [deploy/DEPLOY.md](./deploy/DEPLOY.md) for the full server setup.

## Pre-Publish Security Checklist

This repository is prepared for public release with:

- `.gitignore` excluding `data/`, `.env*`, `node_modules/`, logs, caches, and temporary directories.
- `deploy/publish.sh` requiring `SERVER=user@host` from the environment instead of embedding a server IP or root login.
- `deploy/schedule.service` loading the real `WRITE_TOKEN` from `/etc/schedule.env`.
- `test/fixtures/` reduced to the schedule tables needed by parser tests, with external URL attributes removed.
- Tests that verify public APIs do not include personal state.

## Disclaimer

This is an unofficial course helper and is not affiliated with UC Berkeley or any course staff. Course websites and official LMS pages are the source of truth. Scraped data may lag behind course changes because of website updates, network failures, or parser regressions.

## License

This project is MIT licensed. UI colors and calendar layout decisions are adapted from [Berkeleytime](https://github.com/asuc-octo/berkeleytime), also MIT licensed; see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

<p align="right"><a href="#schedule-planner">Back to top</a> · <a href="#中文">中文</a></p>

<h2 id="中文">中文</h2>

Schedule Planner 是一个面向 Berkeley 课程的 deadline 聚合日历。它把 CS 61B、CS 61C、CS 162 在课程官网和公开日历里分散发布的作业、lab、project、考试和固定课程时间统一到一个网页里，并按太平洋时间展示。

线上 demo：<https://schedule.cks06971.com/>

## Demo

打开 live demo 后可以直接查看公开课程信息，不需要口令：

- `日历`：类似 Berkeleytime 的周视图，deadline 放在顶部全天条，lecture/discussion/lab 放在时间网格里。
- `清单`：按今天、本周、下周和更晚分组，显示倒计时、暂定标记、宽限期和来源链接。
- `工作量`：用学期热力图和未来三周高峰日帮助判断哪几天最忙。
- `订阅`：`/api/calendar.ics` 可以被 Google Calendar / Apple Calendar 订阅。

需要口令的功能只影响个人层：勾选完成、自定义事件、个人备注、私有链接、课程配色和 section 选择。公开页面不会暴露这些个人数据。

## 项目特点

- 多源聚合：HTML 课表提供 deadline，公开 ICS 提供 lecture/discussion/lab 时间。
- 太平洋时间锁定：所有日期和倒计时按 `America/Los_Angeles` 解释，避免跨时区访问时 deadline 偏一天。
- 失败保底：某门课抓取失败时保留上一份成功数据，页面仍可用，并显示 stale 状态。
- 静默少抓防护：每门课有最小条目数阈值，明显少抓会被判为失败。
- 隐私分层：公开 API 只返回课程事实；个人状态只通过带口令的 `/api/mine` 和写接口访问。
- 无构建前端：`public/` 是原生 HTML/CSS/JS，部署时同步文件即可。

## 快速开始

需要 Node.js 20+。

```bash
npm install
WRITE_TOKEN="$(openssl rand -base64 24)" npm start
```

然后打开 <http://127.0.0.1:8132>。

常用命令：

```bash
npm start          # 启动 Web 服务
npm run scrape     # 只跑一次抓取并打印统计，不写入生产状态
npm test           # 运行回归测试
```

## 数据来源

每门课合并两个公开来源：

| 来源 | 用途 |
| --- | --- |
| 课程主页 HTML 课表 | lab / homework / project / 考试日期 |
| 课程公开 Google Calendar ICS | lecture / discussion / lab 的时间和地点 |

学期骨架、假期和期末考试 group 映射是静态常量，见 `scrapers/lib/academic.js`。

Gradescope、PrairieLearn、Ed 和 bCourses 都需要认证，不在抓取范围内。项目只读取公开课程页面和公开日历。

## 项目结构

```text
config/
  courses.js          课程配置、公开 ICS、默认颜色、宽限期、学分
  palette.js          Berkeleytime 风格的颜色 token
scrapers/
  cs61b.js            CS 61B HTML 课表解析
  cs61c.js            CS 61C HTML 课表解析
  cs162.js            CS 162 HTML 课表解析
  index.js            聚合所有课程，合并 HTML deadline 和 ICS 课次
  lib/
    table.js          支持 rowspan/colspan 的表格网格化
    dates.js          日期解析、PT 时间、DST 边界
    ics.js            ICS 抓取、RRULE 展开、section 汇总
    academic.js       Berkeley 学期骨架和期末考试映射
server/
  server.js           HTTP 服务、API、自动刷新、鉴权
  store.js            data/ 读写、失败时保留旧数据
  diff.js             抓取结果变更检测
  ics-out.js          导出订阅用 .ics
public/
  index.html          应用壳
  style.css           Berkeleytime 风格布局和组件样式
  app.js              日历、清单、工作量和个人标注交互
test/
  fixtures/           最小化 HTML parser fixtures，发布前已去除外部 URL
  *.test.js           抓取器、日期、表格、服务端和隐私边界测试
deploy/
  publish.sh          rsync 部署脚本，要求外部传入 SERVER
  schedule.service    systemd unit，从 /etc/schedule.env 读取真实口令
  schedule.caddy      Caddy 反向代理配置
  DEPLOY.md           部署说明
```

`data/` 是运行时目录，包含抓取结果、快照、个人勾选状态、自定义事件、备注、私有链接和 section 选择。它被 `.gitignore` 排除，不应该提交。

## API 和隐私边界

| 接口 | 权限 | 内容 |
| --- | --- | --- |
| `GET /api/data` | 公开 | 课程 deadline、lecture、section 清单、学期信息、默认配色 |
| `GET /api/mine` | 需要 `x-auth` | section 选择、勾选状态、自定义事件、备注、私有链接、个人配色 |
| `POST /api/*` | 需要 `x-auth` | 所有写操作 |
| `GET /api/calendar.ics` | 公开 | 只包含课程 deadline |
| `GET /api/calendar.ics?t=<token>` | 带口令 | 额外包含个人备注和自定义事件 |

这个边界是刻意设计的：可以把公开网址发给同学看课程 deadline，但不会公开个人日程和自定义内容。

## 部署

首次部署前，把真实写入口令放在服务器上的 `/etc/schedule.env`，不要写进仓库。模板见 `deploy/schedule.env.example`。

```bash
SERVER=deploy@example.com ./deploy/publish.sh
```

完整流程见 [deploy/DEPLOY.md](./deploy/DEPLOY.md)。

## 发布前安全检查

本仓库做了这些处理：

- `.gitignore` 排除 `data/`、`.env*`、`node_modules/`、日志、缓存和临时目录。
- `deploy/publish.sh` 不再包含默认服务器 IP 或默认 root 登录；必须外部传入 `SERVER=user@host`。
- `deploy/schedule.service` 从 `/etc/schedule.env` 读取真实 `WRITE_TOKEN`。
- `test/fixtures/` 只保留解析测试需要的表格，并移除了外部 URL 属性。
- 公开 API 和个人 API 有测试覆盖，防止个人状态被塞进 `/api/data`。

## 免责声明

这是非官方课程辅助工具，不代表 UC Berkeley 或任何课程组。课程官网和官方 LMS 永远是最终依据。抓取结果可能因为课程网站改版、网络失败或课程组临时更新而延迟，重要 deadline 请以课程官方信息为准。

## License

本项目使用 MIT License。界面配色和日历布局参考了 [Berkeleytime](https://github.com/asuc-octo/berkeleytime) 的 MIT 许可代码，细节见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

<p align="right"><a href="#schedule-planner">Back to top</a> · <a href="#english">English</a></p>
