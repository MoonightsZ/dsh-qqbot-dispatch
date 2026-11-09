/** Shared five-field Cron parsing, explanation, and time calculations. */
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const formatters = new Map()

function parseField(field, min, max) {
  const values = new Set()
  for (const part of String(field).split(',')) {
    if (part === '') return undefined
    const stepMatch = /^\*\/(\d+)$/.exec(part)
    if (stepMatch !== null) {
      const step = Number(stepMatch[1])
      if (!Number.isInteger(step) || step < 1) return undefined
      for (let value = min; value <= max; value += step) values.add(value)
      continue
    }
    if (part === '*') {
      for (let value = min; value <= max; value += 1) values.add(value)
      continue
    }
    const range = /^(\d+)-(\d+)$/.exec(part)
    if (range !== null) {
      const from = Number(range[1])
      const to = Number(range[2])
      if (from > to || from < min || to > max) return undefined
      for (let value = from; value <= to; value += 1) values.add(value)
      continue
    }
    const value = Number(part)
    if (!Number.isInteger(value) || value < min || value > max) return undefined
    values.add(value)
  }
  return values
}

export function parseCron(expression) {
  const fields = String(expression ?? '').trim().split(/\s+/)
  if (fields.length !== 5) return undefined
  const limits = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]]
  const sets = fields.map((field, index) => parseField(field, limits[index][0], limits[index][1]))
  if (sets.some((set) => set === undefined)) return undefined
  if (sets[4].has(7)) { sets[4].delete(7); sets[4].add(0) }
  return sets
}

export function cronRules(expression) {
  return (Array.isArray(expression) ? expression : String(expression ?? '').split(';'))
    .map((part) => String(part).trim()).filter(Boolean)
}

export function parseCronList(expression) {
  const parts = cronRules(expression)
  if (parts.length === 0) return undefined
  const list = parts.map(parseCron)
  return list.some((entry) => entry === undefined) ? undefined : list
}

function zonedParts(date, timeZone) {
  try {
    let formatter = formatters.get(timeZone)
    if (formatter === undefined) {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone, hourCycle: 'h23', minute: '2-digit', hour: '2-digit',
        day: '2-digit', month: '2-digit', weekday: 'short',
      })
      formatters.set(timeZone, formatter)
    }
    const parts = formatter.formatToParts(date)
    const value = (type) => parts.find((part) => part.type === type)?.value ?? ''
    return { minute: Number(value('minute')), hour: Number(value('hour')),
      day: Number(value('day')), month: Number(value('month')), weekday: WEEKDAYS[value('weekday')] ?? 0 }
  } catch { return undefined }
}

export function cronMatches(sets, date, timeZone) {
  if (sets === undefined) return false
  const parts = zonedParts(date, timeZone)
  return parts !== undefined && sets[0].has(parts.minute) && sets[1].has(parts.hour)
    && sets[2].has(parts.day) && sets[3].has(parts.month) && sets[4].has(parts.weekday)
}

function sorted(set) { return [...set].sort((a, b) => a - b) }
function consecutive(values) { return values.every((value, index) => index === 0 || value === values[index - 1] + 1) }
function pad(value) { return String(value).padStart(2, '0') }
function numericRange(values) { return consecutive(values) && values.length > 2 ? `${values[0]}–${values.at(-1)}` : values.join('、') }

function describeOne(sets) {
  const [minutes, hours, days, months, weekdays] = sets
  const monthText = months.size === 12 ? null : numericRange(sorted(months))
  const dateText = days.size === 31 ? null : numericRange(sorted(days))
  let weekdayText = null
  if (weekdays.size !== 7) {
    const values = sorted(weekdays)
    weekdayText = consecutive(values) && values.length > 2
      ? `${WEEKDAY_NAMES[values[0]]}至${WEEKDAY_NAMES[values.at(-1)]}`
      : values.map((value) => WEEKDAY_NAMES[value]).join('、')
  }
  const dayBase = monthText !== null
    ? dateText !== null ? `每年${monthText}月的${dateText}日` : `每年${monthText}月${weekdayText === null ? '每天' : ''}`
    : dateText !== null ? `每月${dateText}日` : weekdayText === null ? '每天' : ''
  const dayText = weekdayText === null ? dayBase
    : dayBase === '' ? weekdayText : `${dayBase}${monthText !== null && dateText === null ? '的' : '且'}${weekdayText}`
  const hourValues = sorted(hours)
  const minuteValues = sorted(minutes)
  let timeText
  if (hourValues.length === 1 && minuteValues.length === 1) timeText = `${pad(hourValues[0])}:${pad(minuteValues[0])}`
  else if (minuteValues.length === 1 && consecutive(hourValues)) {
    timeText = `${pad(hourValues[0])}:${pad(minuteValues[0])}–${pad(hourValues.at(-1))}:${pad(minuteValues[0])}，每小时`
  } else if (hours.size === 24 && minutes.size === 60) timeText = '每分钟'
  else if (hours.size === 24) timeText = `每小时的 ${minuteValues.map(pad).join('、')} 分`
  else if (minutes.size === 60) timeText = `${numericRange(hourValues)} 时，每分钟`
  else timeText = `${numericRange(hourValues)} 时的 ${minuteValues.map(pad).join('、')} 分`
  return `${dayText} ${timeText}`
}

/** Human-readable description of the exact matching rules; day and weekday use AND. */
export function describeCron(expression) {
  const list = parseCronList(expression)
  return list === undefined ? null : list.map(describeOne).join('；')
}

/** Next matching UTC instant, including annual and leap-day schedules. */
export function nextCronTime(expression, timeZone, fromMs = Date.now()) {
  const list = parseCronList(expression)
  if (list === undefined || !Number.isFinite(fromMs) || zonedParts(new Date(fromMs), timeZone) === undefined) return 0
  const hourMs = 3_600_000
  const minuteMs = 60_000
  const minuteValues = [...new Set(list.flatMap((sets) => [...sets[0]]))]
  const limit = fromMs + 4 * 366 * 24 * hourMs
  for (let hourStart = Math.floor(fromMs / hourMs) * hourMs; hourStart < limit; hourStart += hourMs) {
    const samples = [0, 30, 59].map((minute) => zonedParts(new Date(hourStart + minute * minuteMs), timeZone))
    if (!list.some((sets) => samples.some((parts) => parts !== undefined &&
      sets[1].has(parts.hour) && sets[2].has(parts.day) && sets[3].has(parts.month) && sets[4].has(parts.weekday)))) continue
    const offsets = new Set(samples.map((parts, index) => ((parts.minute - [0, 30, 59][index]) + 60) % 60))
    const candidates = new Set()
    for (const offset of offsets) for (const minute of minuteValues) candidates.add((minute - offset + 60) % 60)
    for (const minute of [...candidates].sort((a, b) => a - b)) {
      const instant = hourStart + minute * minuteMs
      if (instant > fromMs && instant < limit && list.some((sets) => cronMatches(sets, new Date(instant), timeZone))) return instant
    }
  }
  return 0
}

export function formatZonedTime(timestamp, timeZone) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '—'
  try {
    const value = new Intl.DateTimeFormat('zh-CN', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(timestamp))
    return `${value}（${timeZone}）`
  } catch { return '时区无效' }
}
