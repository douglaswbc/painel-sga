const DAY_MAP: Record<string, number> = {
  dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6,
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
}

export type RecurrenceConfig = {
  frequencia: 'daily' | 'weekly' | 'monthly' | 'yearly'
  intervalo: number
  dias: string[]
  termina?: { tipo: string; valor?: number | string | null; unidade?: string }
  expiracao?: number
  horario_geracao?: string
  horario_cobranca?: string
  intervalo_lembrete_minutos?: number
}

const defaults = (dueDate: Date): RecurrenceConfig => ({
  frequencia: 'monthly',
  intervalo: 1,
  dias: [Object.keys(DAY_MAP).filter(day => DAY_MAP[day] === dueDate.getUTCDay())[0] || 'seg'],
  termina: { tipo: 'nunca', valor: null },
  expiracao: 4,
})

/** Accept the current JSON format and the legacy labels saved by ContratoModal. */
export function parseRecurrence(raw: unknown, dueDate: Date): RecurrenceConfig {
  const base = defaults(dueDate)
  let saved: Record<string, unknown> = {}

  if (typeof raw === 'string') {
    const value = raw.trim().toLowerCase()
    if (value.startsWith('{')) {
      try {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) saved = parsed
      } catch {
        // Invalid legacy data falls back to monthly rather than stopping the run.
      }
    } else if (value.includes('quinzenal') || value.includes('biweekly')) {
      saved = { frequencia: 'weekly', intervalo: 2 }
    } else if (value.includes('semanal') || value.includes('weekly')) {
      saved = { frequencia: 'weekly', intervalo: 1 }
    } else if (value.includes('diari') || value.includes('daily')) {
      saved = { frequencia: 'daily', intervalo: 1 }
    } else if (value.includes('anual') || value.includes('yearly')) {
      saved = { frequencia: 'yearly', intervalo: 1 }
    }
    const legacyMatch = value.match(/@([a-z]{3})@([0-2]\d:[0-5]\d)$/i)
    if (legacyMatch) {
      saved.dias = [legacyMatch[1]]
      saved.horario_geracao = legacyMatch[2]
      saved.horario_cobranca = legacyMatch[2]
    }
  }

  const frequency = saved.frequencia
  const allowed = ['daily', 'weekly', 'monthly', 'yearly']
  const freq = typeof frequency === 'string' && allowed.includes(frequency)
    ? frequency as RecurrenceConfig['frequencia']
    : base.frequencia
  const interval = Number(saved.intervalo)
  const days = Array.isArray(saved.dias)
    ? saved.dias.filter((day): day is string => typeof day === 'string' && DAY_MAP[day.toLowerCase()] !== undefined)
    : base.dias

  return {
    ...base,
    ...saved,
    frequencia: freq,
    intervalo: Number.isFinite(interval) && interval > 0 ? Math.floor(interval) : 1,
    dias: days.length ? days : base.dias,
    termina: saved.termina && typeof saved.termina === 'object'
      ? saved.termina as RecurrenceConfig['termina']
      : base.termina,
    expiracao: Number(saved.expiracao) > 0 ? Number(saved.expiracao) : base.expiracao,
    horario_geracao: typeof saved.horario_geracao === 'string' ? saved.horario_geracao : typeof saved.horario === 'string' ? saved.horario : '20:00',
    horario_cobranca: typeof saved.horario_cobranca === 'string' ? saved.horario_cobranca : typeof saved.horario === 'string' ? saved.horario : '20:00',
    intervalo_lembrete_minutos: Number(saved.intervalo_lembrete_minutos) > 0 ? Number(saved.intervalo_lembrete_minutos) : 30,
  }
}

export function reminderStartAt(now: Date, time: string, pixExpiresAt?: Date, offsetMinutes: number = 0): Date {
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now)
  // São Paulo currently uses UTC-03:00 year-round; all persisted values remain absolute UTC timestamps.
  const scheduled = new Date(`${localDate}T${time}:00-03:00`)
  const base = scheduled.getTime() < now.getTime() ? now : scheduled
  const withOffset = new Date(base.getTime() + Math.max(0, offsetMinutes) * 60000)
  if (pixExpiresAt && withOffset.getTime() >= pixExpiresAt.getTime()) {
    return base.getTime() < pixExpiresAt.getTime() ? base : now
  }
  return withOffset
}

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

export function calculateNextDueDate(current: Date, config: RecurrenceConfig): Date {
  const next = new Date(current)
  const dayOfMonth = current.getUTCDate()
  const hours = current.getUTCHours()
  const minutes = current.getUTCMinutes()
  const seconds = current.getUTCSeconds()
  const interval = Math.max(1, config.intervalo || 1)

  if (config.frequencia === 'daily') {
    next.setUTCDate(next.getUTCDate() + interval)
  } else if (config.frequencia === 'monthly') {
    const targetMonth = next.getUTCMonth() + interval
    next.setUTCDate(1)
    next.setUTCMonth(targetMonth)
    next.setUTCDate(Math.min(dayOfMonth, daysInUtcMonth(next.getUTCFullYear(), next.getUTCMonth())))
  } else if (config.frequencia === 'yearly') {
    const targetYear = next.getUTCFullYear() + interval
    next.setUTCDate(1)
    next.setUTCFullYear(targetYear)
    next.setUTCDate(Math.min(dayOfMonth, daysInUtcMonth(next.getUTCFullYear(), next.getUTCMonth())))
  } else {
    const selectedDays = [...new Set(config.dias.map(day => DAY_MAP[day.toLowerCase()]).filter(day => day !== undefined))]
    if (!selectedDays.length) {
      next.setUTCDate(next.getUTCDate() + (interval * 7))
    } else {
      let crossedWeek = false
      for (let count = 0; count < 366; count++) {
        const previousDay = next.getUTCDay()
        next.setUTCDate(next.getUTCDate() + 1)
        if (!crossedWeek && previousDay > next.getUTCDay()) {
          crossedWeek = true
          if (interval > 1) next.setUTCDate(next.getUTCDate() + ((interval - 1) * 7))
        }
        if (selectedDays.includes(next.getUTCDay())) break
      }
    }
  }

  next.setUTCHours(hours, minutes, seconds, 0)
  return next
}

export function nextContractSchedule(current: Date, occurred: number | null, config: RecurrenceConfig) {
  const occurrences = (occurred || 0) + 1
  const nextDue = calculateNextDueDate(current, config)
  let status = 'ativo'

  const occurrenceLimit = Number(config.termina?.valor)
  if (config.termina?.tipo === 'ocorrencia' && Number.isFinite(occurrenceLimit) && occurrenceLimit > 0 && occurrences >= occurrenceLimit) {
    status = 'encerrado'
  } else if (config.termina?.tipo === 'data' && config.termina.valor) {
    if (nextDue > new Date(config.termina.valor)) status = 'encerrado'
  }

  return { proxima_cobranca: nextDue.toISOString(), ocorrencias_realizadas: occurrences, status }
}

/** Stable UUID-shaped key for Mercado Pago retries of this contract period. */
export async function paymentIdempotencyKey(contractId: string, dueDate: string): Promise<string> {
  const namespace = new Uint8Array([
    0x6b, 0xa7, 0xb8, 0x10, 0x9d, 0xad, 0x11, 0xd1,
    0x80, 0xb4, 0x00, 0xc0, 0x4f, 0xd4, 0x30, 0xc8,
  ])
  const name = new TextEncoder().encode(`${contractId}:${dueDate}`)
  const input = new Uint8Array(namespace.length + name.length)
  input.set(namespace)
  input.set(name, namespace.length)
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', input))
  hash[6] = (hash[6] & 0x0f) | 0x50
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = [...hash.slice(0, 16)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function billingDate(current: string | Date): string {
  return new Date(current).toISOString().slice(0, 10)
}
