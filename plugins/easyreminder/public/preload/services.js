const fs = require('node:fs')
const path = require('node:path')
const https = require('node:https')

const STORAGE_KEY = 'easyremind_reminders'
const LOG_KEY = 'easyremind_logs'
const HOLIDAY_KEY = 'easyremind_holidays'
const HOLIDAY_API = 'https://timor.tech/api/holiday/year/'
const HOLIDAY_TIMEOUT_MS = 5000
const HOLIDAY_NEXT_YEAR_MONTH = 11 // 12 月起（getMonth()=11）进插件时顺带补次年数据
const HOLIDAY_RECHECK_MS = 60 * 60 * 1000 // 后台常驻时每小时自检一次节假日数据（跨年补数据）

// 调度自愈参数
const INIT_RETRY_MS = 300 // 宿主 API 未注入时的快速重试间隔
const INIT_FAST_TRIES = 40 // 快速重试次数（300ms × 40 ≈ 12s），之后交给看门狗慢速重试
const WATCHDOG_INTERVAL_MS = 30 * 1000 // 看门狗巡检间隔
const MISSED_FIRE_GRACE_MS = 5 * 60 * 1000 // 错过的触发在此时间内仍补发，超过则只重排不补发
const MIN_REARM_DELAY_MS = 1000 // 触发后重排的最小延迟：数据异常（如状态写不进去）时不会 0 延迟自我循环
const ERROR_BACKOFF_MS = 30 * 1000 // 触发处理抛错后的退避间隔

// ==================== 工具函数 ====================
function pad2(n) {
  return String(n).padStart(2, '0')
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// ==================== 日志 ====================
let logId = 1

function readLogs() {
  try {
    const data = window.ztools.dbStorage.getItem(LOG_KEY)
    if (!data) return []
    const raw = typeof data === 'string' ? JSON.parse(data) : data
    return Array.isArray(raw) ? raw : []
  } catch (e) {
    return []
  }
}

function writeLogs(logs) {
  try {
    window.ztools.dbStorage.setItem(LOG_KEY, JSON.stringify(logs))
  } catch (e) {}
}

function addLog(message, detail) {
  try {
    const logs = readLogs()
    const now = new Date()
    const time = pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds()) + '.' + String(now.getMilliseconds()).padStart(3, '0')
    logs.unshift({ id: logId++, time, message, detail: detail || {} })
    if (logs.length > 100) logs.length = 100
    writeLogs(logs)
  } catch (e) {}
}

// ==================== 提醒数据 ====================
// 读失败（宿主 IPC 异常）与「确实没有数据」必须区分：
// 前者要等下一轮重试，后者是合法状态（无待触发项）
let storageReadFailed = false

function readReminders() {
  try {
    const data = window.ztools.dbStorage.getItem(STORAGE_KEY)
    storageReadFailed = false
    if (!data) return []
    const raw = typeof data === 'string' ? JSON.parse(data) : data
    return Array.isArray(raw) ? raw : []
  } catch (e) {
    storageReadFailed = true
    console.error('[easyremind] readReminders error:', e)
    return []
  }
}

function writeReminders(list) {
  window.ztools.dbStorage.setItem(STORAGE_KEY, JSON.stringify(list))
}

// ==================== 法定节假日数据 ====================
// 数据源 timor.tech/api/holiday，holiday=true 放假 / false 补班（调休上班）
// 缓存结构: { years: { "2026": { "01-01": {h:0|1, n:"元旦"} } }, updatedAt: ts }

let holidayCache = null
let holidayCacheLoaded = false
let holidayUpdating = false

// 宿主 API 有可能在 preload 执行完之后才注入（见文件末尾 init 的重试逻辑），
// 所以节假日缓存改成「宿主就绪后首次使用时」读取，
// 避免模块加载那一刻读到空值并被永久缓存下来
function getHolidayCache() {
  if (holidayCacheLoaded) return holidayCache
  if (!hostReady()) return null
  holidayCache = readHolidayCache()
  holidayCacheLoaded = true
  return holidayCache
}

function readHolidayCache() {
  try {
    const data = window.ztools.dbStorage.getItem(HOLIDAY_KEY)
    if (!data) return null
    const raw = typeof data === 'string' ? JSON.parse(data) : data
    if (!raw || typeof raw !== 'object' || !raw.years) return null
    return raw
  } catch (e) {
    return null
  }
}

function writeHolidayCache(cache) {
  try {
    window.ztools.dbStorage.setItem(HOLIDAY_KEY, JSON.stringify(cache))
  } catch (e) {}
}

// 拉取某年的节假日表（次年未公布时返回空对象，视为"没有新数据"）
function fetchHolidayYear(year) {
  return new Promise((resolve) => {
    let settled = false
    const done = (val) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(val)
    }
    const req = https.get(HOLIDAY_API + year, (res) => {
      let buf = ''
      res.on('data', (c) => { buf += c })
      res.on('end', () => {
        try {
          const json = JSON.parse(buf)
          if (json.code === 0 && json.holiday && typeof json.holiday === 'object') {
            done(json.holiday)
          } else {
            done(null)
          }
        } catch (e) {
          done(null)
        }
      })
    })
    const timer = setTimeout(() => {
      req.destroy()
      done(null)
    }, HOLIDAY_TIMEOUT_MS)
    req.on('error', () => done(null))
  })
}

function normalizeHolidayYear(raw) {
  const out = {}
  for (const key of Object.keys(raw)) {
    const v = raw[key]
    if (!v || typeof v !== 'object') continue
    out[key] = { h: v.holiday ? 1 : 0, n: v.name || '' }
  }
  return out
}

// 进入插件时检查：缓存缺哪年就拉哪年，存在就不管
function holidayNeedFetch(cache) {
  const now = new Date()
  const y = now.getFullYear()
  const years = []
  if (!cache || !cache.years || !cache.years[String(y)]) years.push(y)
  // 12 月起次年被跨年调度用到，若缺则顺带补一次（次年安排此时已公布）
  if (now.getMonth() >= HOLIDAY_NEXT_YEAR_MONTH && (!cache || !cache.years || !cache.years[String(y + 1)])) years.push(y + 1)
  return { need: years.length > 0, years }
}

async function ensureHolidayData(force) {
  if (holidayUpdating) return false
  const cache = readHolidayCache()
  const plan = force
    ? { need: true, years: [new Date().getFullYear()] } // 手动更新：强制重拉当年并覆盖
    : holidayNeedFetch(cache)
  if (!plan.need) return false

  holidayUpdating = true
  try {
    const results = await Promise.all(plan.years.map((y) => fetchHolidayYear(y).then((d) => (d ? normalizeHolidayYear(d) : null))))
    const next = cache || { years: {}, updatedAt: 0 }
    let changed = false
    let anySuccess = false
    results.forEach((norm, i) => {
      if (norm === null) return // 网络/接口失败，保留缓存
      anySuccess = true
      if (Object.keys(norm).length > 0 && JSON.stringify(next.years[plan.years[i]]) !== JSON.stringify(norm)) {
        next.years[plan.years[i]] = norm
        changed = true
      }
    })
    if (anySuccess) {
      next.updatedAt = Date.now()
      writeHolidayCache(next)
      holidayCache = next
      holidayCacheLoaded = true
      if (changed) {
        addLog('[节假日] 数据已更新，覆盖: ' + Object.keys(next.years).map((y) => y + '年').join('、'))
        scheduleNext() // 数据变化后重算下次触发时间
      }
    }
    return changed
  } finally {
    holidayUpdating = false
  }
}

// 某天是工作日还是节假日（无数据时退化为自然周）
function getDayType(d) {
  const cache = getHolidayCache()
  const ym = cache && cache.years && cache.years[d.getFullYear()]
  const key = pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
  if (ym && Object.prototype.hasOwnProperty.call(ym, key)) {
    return ym[key].h === 1 ? 'holiday' : 'workday'
  }
  const wd = d.getDay()
  return wd === 0 || wd === 6 ? 'holiday' : 'workday'
}

function matchDayFilter(d, dayFilter) {
  if (!dayFilter || dayFilter === 'all') return true
  return getDayType(d) === dayFilter
}

// ==================== 触发时间计算 ====================
function getNextTriggerTime(r, atTime) {
  if (!r || !r.enabled) return null

  switch (r.type) {
    case 'once': {
      if (!r.triggerAt || r.lastTriggered !== 0) return null
      return r.triggerAt
    }
    case 'daily': {
      if (!r.weekdays || !r.weekdays.length || !r.triggerTime) return null
      return calcNextDailyTime(r, atTime)
    }
    case 'interval': {
      if (!r.schedules || !r.schedules.length) return null
      return calcNextIntervalTime(r, atTime)
    }
    default:
      return null
  }
}

// 向前找 31 天：最长法定假期 8 天左右，即使叠加「仅工作日/仅节假日」过滤也足够
function calcNextDailyTime(r, atTime) {
  const parts = (r.triggerTime || '').split(':')
  if (parts.length < 2) return null
  const h = Number(parts[0])
  const m = Number(parts[1])
  const base = new Date(atTime)

  for (let i = 0; i <= 30; i++) {
    const next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i, h, m, 0, 0)
    if (next.getTime() < atTime) continue
    if (!r.weekdays.includes(next.getDay())) continue
    if (!matchDayFilter(next, r.dayFilter)) continue
    return next.getTime()
  }
  return null
}

function calcNextIntervalTime(r, atTime) {
  const intervalMs = r.interval * 60 * 1000

  // 对齐起点模式：触发点 = 每天 startTime + k × 间隔，与创建时刻无关
  if (r.align === 'start') {
    return calcNextIntervalAligned(r, atTime)
  }

  // 随创建时间起算（旧默认）：锚点 = 上次触发时间（首次为创建时间）
  const anchor = r.lastTriggered > 0 ? r.lastTriggered : (r.createdAt || atTime)
  const elapsed = atTime - anchor
  const periods = Math.max(1, Math.ceil(elapsed / intervalMs))
  let current = anchor + periods * intervalMs

  const schedules = r.schedules
  if (!schedules.length) return null

  // 跳过不满足「工作日/节假日」过滤的整天
  for (let attempt = 0; attempt < 40; attempt++) {
    const d = new Date(current)
    if (!matchDayFilter(d, r.dayFilter)) {
      current = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime()
      continue
    }
    const day = d.getDay()
    const hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes())

    const daySchedules = schedules.filter(s => s.weekday === day).sort((a, b) => a.startTime.localeCompare(b.startTime))
    if (daySchedules.length > 0) {
      for (const s of daySchedules) {
        if (hm >= s.startTime && hm <= s.endTime) {
          return current
        }
      }
      for (const s of daySchedules) {
        if (hm < s.startTime) {
          const sp = s.startTime.split(':')
          const nextStart = new Date(d)
          nextStart.setHours(Number(sp[0]), Number(sp[1]), 0, 0)
          return nextStart.getTime()
        }
      }
    }
    current = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime()
  }
  return null
}

// 对齐起点模式：枚举每天的触发点（startTime、startTime+间隔、…、≤ endTime，含 endTime 端点），
// 返回第一个不早于 atTime 的触发点；跨天/跳过节假日由外层循环处理。
// 每次都重新对格，错过（如睡眠唤醒）不会拖累后续序列。
function calcNextIntervalAligned(r, atTime) {
  const intervalMs = r.interval * 60 * 1000
  const base = new Date(atTime)

  for (let i = 0; i <= 40; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i)
    if (!matchDayFilter(d, r.dayFilter)) continue

    const daySchedules = r.schedules.filter(s => s.weekday === d.getDay()).sort((a, b) => a.startTime.localeCompare(b.startTime))
    for (const s of daySchedules) {
      const sp = s.startTime.split(':')
      const ep = s.endTime.split(':')
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Number(sp[0]), Number(sp[1]), 0, 0).getTime()
      const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Number(ep[0]), Number(ep[1]), 0, 0).getTime()
      for (let t = start; t <= end; t += intervalMs) {
        if (t >= atTime) return t
      }
    }
  }
  return null
}

const TYPE_LABELS = { daily: '每日提醒', interval: '间隔提醒', once: '定时提醒' }

function formatTime(ts) {
  const d = new Date(ts)
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
}

// 下次触发时间的人类可读格式：今天/明天带日期词，更远的日子带月-日
function formatNextTime(ts) {
  const d = new Date(ts)
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.round((dayStart.getTime() - todayStart.getTime()) / 86400000)
  const datePart = diffDays === 0 ? '今天' : diffDays === 1 ? '明天' : pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
  return datePart + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

// ==================== 调度器 ====================
let schedulerTimer = null
let scheduledTime = null
// 连续算出「下次触发时间仍在过去」的次数：第一次立即补触发（启动时已过期的一次性提醒），
// 之后按退避间隔重试，避免异常数据把渲染进程拖进 0 延迟死循环
let overdueStreak = 0

function calcNextTick(reminders) {
  let next = null
  for (const r of reminders) {
    const t = getNextTriggerTime(r, Date.now())
    if (t !== null && (next === null || t < next)) {
      next = t
    }
  }
  return next
}

// 重排下一次触发。minDelay 用于「刚触发完」的场景，
// 保证异常数据下也不会出现 0 延迟的自我循环
function scheduleNext(minDelay) {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer)
    schedulerTimer = null
  }
  scheduledTime = null

  let next = null
  try {
    next = calcNextTick(readReminders())
  } catch (e) {
    // 计算异常等同于「暂时没有待触发项」，交给看门狗下一轮重试
    console.error('[easyremind] scheduleNext calc error:', e)
  }
  if (next === null) {
    overdueStreak = 0
    return
  }

  scheduledTime = next
  const rawDelay = next - Date.now()
  let delay
  if (rawDelay < 0) {
    delay = Math.max(minDelay || 0, overdueStreak === 0 ? 0 : ERROR_BACKOFF_MS)
    overdueStreak++
  } else {
    delay = Math.max(minDelay || 0, rawDelay)
    overdueStreak = 0
  }
  schedulerTimer = setTimeout(() => {
    // 先摘掉句柄：万一 triggerDue 抛错，看门狗才能识别出「定时器已不在」并补设
    schedulerTimer = null
    // triggerDue 里的存储写入、系统通知都可能抛错，
    // 但重排必须执行，否则一次异常就会让整条调度链永久停摆
    let errored = false
    try {
      triggerDue()
    } catch (e) {
      errored = true
      console.error('[easyremind] triggerDue error:', e)
      addLog('[异常] 触发处理失败，' + Math.round(ERROR_BACKOFF_MS / 1000) + 's 后重试：' + ((e && e.message) || String(e)))
    } finally {
      scheduleNext(errored ? ERROR_BACKOFF_MS : MIN_REARM_DELAY_MS)
    }
  }, delay)
}

function triggerDue() {
  if (scheduledTime === null) return
  const target = scheduledTime
  const reminders = readReminders()

  for (const r of reminders) {
    if (!r.enabled) continue
    const t = getNextTriggerTime(r, target)
    if (t !== null && Math.abs(t - target) < 1000) {
      // 单条提醒出错不影响同一时刻的其他提醒
      try {
        doTrigger(r, target)
      } catch (e) {
        console.error('[easyremind] doTrigger error:', r.id, e)
        addLog('[异常] 「' + (r.title || r.id) + '」触发失败：' + ((e && e.message) || String(e)), { id: r.id })
      }
    }
  }
}

// 已经发过通知的 once 提醒：状态写库失败时防止每轮重排都重复通知
const firedOnceIds = new Set()

function doTrigger(reminder, scheduled) {
  const now = Date.now()
  const reminders = readReminders()
  const target = reminders.find(r => r.id === reminder.id)
  if (!target) return

  if (target.type === 'once') {
    if (firedOnceIds.has(target.id)) {
      // 已通知过，不再重复发；但仍要重试把「已触发」状态落库，
      // 否则这条过期数据会一直占住 calcNextTick 的最小值，饿死其他提醒
      if (target.enabled || target.lastTriggered === 0) {
        target.enabled = false
        target.lastTriggered = now
        try {
          writeReminders(reminders)
        } catch (e) {
          console.error('[easyremind] writeReminders retry error:', e)
        }
      }
      return
    }
    firedOnceIds.add(target.id)
    target.enabled = false
  }
  target.lastTriggered = now
  try {
    writeReminders(reminders)
  } catch (e) {
    // 状态没写进去也要把提醒发出去，漏提醒比重复提醒更糟；
    // 下一轮重排会再试一次写入
    console.error('[easyremind] writeReminders error:', e)
    addLog('[异常] 「' + target.title + '」触发状态保存失败：' + ((e && e.message) || String(e)), { id: target.id })
  }

  const drift = now - scheduled
  addLog('[触发] ' + target.title + ' · ' + formatTime(scheduled) + (drift ? '（偏差 ' + (drift > 0 ? '+' : '') + drift + 'ms）' : '（准点）'), {
    id: target.id,
    type: target.type,
    scheduledTime: formatTime(scheduled),
    actualTime: formatTime(now)
  })

  // 发送系统通知：标题=任务名，内容=描述
  try {
    const notif = new Notification(target.title, {
      body: target.content || '提醒时间到了',
      requireInteraction: true
    })
    // 点击通知回到插件
    notif.onclick = function () {
      notif.close()
    }
  } catch (e) {
    // 降级：ztools 通知（只支持单字符串）
    if (window.ztools && window.ztools.showNotification) {
      window.ztools.showNotification(target.title + ': ' + (target.content || '提醒时间到了'))
    }
  }
}

// ==================== 启动与自愈 ====================
// ZTools 只在创建插件视图时才执行 preload.js：要么用户打开插件，
// 要么勾选「插件设置 → 跟随主程序同时启动运行」后由主程序在启动时后台预加载。
// 所以这里不能假设「模块加载即一切就绪」：宿主 API 可能尚未注入、
// 存储可能瞬时读失败、提醒数据可能稍后才落库。一次性排程只要读空一次
// 就会永久停摆，因此启动走显式 init + 快速重试，长期由看门狗兜底。
let schedulerReady = false
let watchdogTimer = null
let lastHolidayCheckAt = 0
const hostReadyAtLoad = hostReady()

function hostReady() {
  const z = window.ztools
  return !!(z && z.dbStorage && typeof z.dbStorage.getItem === 'function')
}

function init() {
  if (schedulerReady) return true
  if (!hostReady()) return false

  schedulerReady = true
  scheduleNext()
  startWatchdog()
  logSchedulerStart()
  // 节假日数据：异步拉取，成功后内部会重算调度，不阻塞启动
  ensureHolidayData(false).catch(() => {})
  return true
}

function logSchedulerStart() {
  const list = readReminders()
  const enabled = list.filter(r => r.enabled).length
  const suffix = scheduledTime
    ? ' · 下次触发 ' + formatNextTime(scheduledTime)
    : storageReadFailed
      ? ' · 存储读取失败，稍后自动重试'
      : ' · 暂无待触发项'
  addLog('[启动] 调度器已就绪 · 提醒 ' + list.length + ' 条（启用 ' + enabled + '）' + suffix, {
    hostReadyAtLoad,
    total: list.length,
    enabled,
    nextTriggerAt: scheduledTime || undefined
  })
}

// 宿主 API 还没注入时快速重试；重试窗口用尽后交给看门狗长期兜底
function requestInit(triesLeft) {
  if (init()) return
  if (triesLeft > 0) {
    setTimeout(() => requestInit(triesLeft - 1), INIT_RETRY_MS)
    return
  }
  startWatchdog()
}

function startWatchdog() {
  if (watchdogTimer) return
  watchdogTimer = setInterval(watchdogTick, WATCHDOG_INTERVAL_MS)
}

function watchdogTick() {
  try {
    if (!schedulerReady) {
      init()
      return
    }
    if (!hostReady()) return

    const now = Date.now()

    // 1. 定时器不在：上次排程读到空数据、触发链被打断、或视图被冻结后丢弃
    if (!schedulerTimer) {
      const list = readReminders()
      // 读失败 ≠ 没有提醒：等下一轮巡检，别把瞬时故障当成「无待触发项」
      if (!storageReadFailed && calcNextTick(list) !== null) {
        scheduleNext()
        if (scheduledTime !== null) {
          addLog('[自愈] 调度器已停摆，重新排程 · 下次触发 ' + formatNextTime(scheduledTime), { nextTriggerAt: scheduledTime })
        }
      }
      checkHolidayData(now)
      return
    }

    // 2. 排程时间已过却还没触发：定时器丢失、睡眠/休眠唤醒、系统时间跳变。
    //    渲染进程单线程，这里补发后再 scheduleNext（内部会 clearTimeout）
    //    就不会和原定时器重复触发
    if (scheduledTime !== null && scheduledTime <= now) {
      const missedBy = now - scheduledTime
      if (missedBy <= MISSED_FIRE_GRACE_MS) {
        addLog('[自愈] 补发错过的触发（迟到 ' + Math.round(missedBy / 1000) + 's）· ' + formatTime(scheduledTime), {
          scheduledTime: formatTime(scheduledTime),
          missedByMs: missedBy
        })
        triggerDue()
      } else {
        addLog('[自愈] 触发已过期 ' + Math.round(missedBy / 60000) + ' 分钟，跳过补发并重新排程', {
          scheduledTime: formatTime(scheduledTime),
          missedByMs: missedBy
        })
      }
      scheduleNext()
      checkHolidayData(now)
      return
    }

    // 3. 数据被外部改动（另一个插件窗口、上一次读取失败后恢复）→ 重新对齐
    const list = readReminders()
    if (storageReadFailed) {
      checkHolidayData(now)
      return
    }
    const next = calcNextTick(list)
    const mismatch = next === null ? scheduledTime !== null : scheduledTime === null || Math.abs(next - scheduledTime) > 1000
    if (mismatch) scheduleNext()

    checkHolidayData(now)
  } catch (e) {
    // 巡检自身绝不能把调度带崩
    console.error('[easyremind] watchdog error:', e)
  }
}

// 后台常驻时插件视图不会重建，节假日数据靠这里按小时自检补全（跨年、次年数据公布）
function checkHolidayData(now) {
  if (now - lastHolidayCheckAt < HOLIDAY_RECHECK_MS) return
  lastHolidayCheckAt = now
  if (!holidayNeedFetch(getHolidayCache()).need) return
  ensureHolidayData(false).catch(() => {})
}

// ==================== 暴露服务 ====================
window.services = {
  // 读文件
  readFile(file) {
    try {
      return fs.readFileSync(file, { encoding: 'utf-8' })
    } catch {
      return ''
    }
  },
  // 文本写入到下载目录
  writeTextFile(text) {
    const filePath = path.join(window.ztools.getPath('downloads'), Date.now().toString() + '.txt')
    fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
    return filePath
  },
  // 图片写入到下载目录
  writeImageFile(base64Url) {
    const matches = /^data:image\/([a-z]{1,20});base64,/i.exec(base64Url)
    if (!matches) return
    const filePath = path.join(
      window.ztools.getPath('downloads'),
      Date.now().toString() + '.' + matches[1]
    )
    fs.writeFileSync(filePath, base64Url.substring(matches[0].length), { encoding: 'base64' })
    return filePath
  },
  // 自定义标题的通知
  notify(title, body) {
    if (typeof Notification === 'undefined') return
    if (Notification.permission === 'granted') {
      new Notification(title, { body })
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(perm => {
        if (perm === 'granted') new Notification(title, { body })
      })
    }
  },
  sendNotification(title, body) {
    if (window.ztools && window.ztools.showNotification) {
      window.ztools.showNotification(title + ': ' + body)
    } else {
      this.notify(title, body)
    }
  },

  // ===== 提醒数据 CRUD =====
  getReminders() {
    return readReminders()
  },

  addReminder(formData) {
    const reminder = {
      id: generateId(),
      title: formData.title,
      content: formData.content || '',
      type: formData.type,
      schedules: formData.schedules || [],
      interval: formData.interval || 60,
      align: formData.align === 'start' ? 'start' : 'create',
      triggerAt: formData.triggerAt,
      weekdays: formData.weekdays,
      triggerTime: formData.triggerTime,
      dayFilter: formData.dayFilter || 'all',
      enabled: true,
      lastTriggered: 0,
      createdAt: Date.now()
    }
    const reminders = readReminders()
    reminders.push(reminder)
    writeReminders(reminders)
    const next = getNextTriggerTime(reminder, Date.now())
    addLog('[新建] ' + reminder.title + ' · ' + TYPE_LABELS[reminder.type] + (next ? ' · 下次触发 ' + formatNextTime(next) : ' · 当前不会触发'), {
      id: reminder.id,
      type: reminder.type,
      nextTriggerAt: next || undefined
    })
    scheduleNext()
    return reminder
  },

  updateReminder(id, formData) {
    const reminders = readReminders()
    const index = reminders.findIndex(r => r.id === id)
    if (index === -1) return false

    reminders[index] = {
      ...reminders[index],
      title: formData.title,
      content: formData.content || '',
      type: formData.type,
      schedules: formData.schedules || [],
      interval: formData.interval || 60,
      align: formData.align === 'start' ? 'start' : 'create',
      triggerAt: formData.triggerAt,
      weekdays: formData.weekdays,
      triggerTime: formData.triggerTime,
      dayFilter: formData.dayFilter || 'all'
    }
    writeReminders(reminders)
    const next = getNextTriggerTime(reminders[index], Date.now())
    addLog('[修改] ' + reminders[index].title + ' · ' + TYPE_LABELS[formData.type] + (next ? ' · 下次触发 ' + formatNextTime(next) : ' · 当前不会触发'), {
      id,
      type: formData.type,
      nextTriggerAt: next || undefined
    })
    scheduleNext()
    return true
  },

  deleteReminder(id) {
    const reminders = readReminders()
    const deleted = reminders.find(r => r.id === id)
    const filtered = reminders.filter(r => r.id !== id)
    if (filtered.length < reminders.length) {
      writeReminders(filtered)
      addLog('[删除] ' + (deleted ? deleted.title : id), { id })
      scheduleNext()
      return true
    }
    return false
  },

  toggleReminder(id) {
    const reminders = readReminders()
    const reminder = reminders.find(r => r.id === id)
    if (!reminder) return false

    reminder.enabled = !reminder.enabled
    writeReminders(reminders)
    if (reminder.enabled) {
      const next = getNextTriggerTime(reminder, Date.now())
      addLog('[启用] ' + reminder.title + (next ? ' · 下次触发 ' + formatNextTime(next) : ' · 当前不会触发'), { id, nextTriggerAt: next || undefined })
    } else {
      addLog('[停用] ' + reminder.title, { id })
    }
    scheduleNext()
    return true
  },

  // ===== 调度器控制 =====
  // 渲染层不参与调度，只在进入插件时请求一次重排（睡眠唤醒/长时间后台后立刻对齐）
  refreshScheduler() {
    scheduleNext()
  },

  // 调度状态（供 UI 展示，只读）
  getSchedulerState() {
    return {
      ready: schedulerReady,
      nextTriggerText: scheduledTime ? formatNextTime(scheduledTime) : ''
    }
  },

  // ===== 法定节假日数据 =====
  getHolidayStatus() {
    const cache = readHolidayCache()
    const years = cache && cache.years ? Object.keys(cache.years).map(Number).sort((a, b) => a - b) : []
    return {
      years,
      updatedAt: cache ? cache.updatedAt || 0 : 0,
      refreshing: holidayUpdating
    }
  },

  // 强制重新拉取（resolve 后可调 getHolidayStatus 读取最新状态）
  refreshHolidayData() {
    return ensureHolidayData(true)
  },

  // ===== 日志 =====
  getLogs() {
    return readLogs()
  },

  clearLogs() {
    window.ztools.dbStorage.setItem(LOG_KEY, JSON.stringify([]))
  }
}

// ==================== 启动调度 ====================
// 插件视图一被创建（用户打开插件，或主程序自启时后台预加载）就把内部任务调度起来。
// 宿主 API 未就绪时快速重试，重试窗口用尽后由看门狗长期兜底。
requestInit(INIT_FAST_TRIES)
