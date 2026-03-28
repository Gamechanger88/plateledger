"use client"

import { createContext, useContext, useState, useMemo, ReactNode } from "react"
import { format, startOfMonth, endOfMonth, subMonths, addMonths, subDays, startOfWeek } from "date-fns"

export type DateMode = 'today' | 'yesterday' | 'thisweek' | 'monthly' | 'quarterly' | 'halfyear' | 'yearly' | 'financialyear' | 'custom'

function getQuarterDates(year: number, q: number) {
  const s = (q - 1) * 3
  return {
    start: format(new Date(year, s, 1), 'yyyy-MM-dd'),
    end: format(endOfMonth(new Date(year, s + 2, 1)), 'yyyy-MM-dd'),
  }
}

function getHalfDates(year: number, h: number) {
  return h === 1
    ? { start: format(new Date(year, 0, 1), 'yyyy-MM-dd'), end: format(endOfMonth(new Date(year, 5, 1)), 'yyyy-MM-dd') }
    : { start: format(new Date(year, 6, 1), 'yyyy-MM-dd'), end: format(endOfMonth(new Date(year, 11, 1)), 'yyyy-MM-dd') }
}

interface DateContextValue {
  mode: DateMode
  activeMonth: Date
  activeYear: number
  activeQuarter: number
  activeHalf: number
  customStart: string
  customEnd: string
  // Derived
  startDate: string
  endDate: string
  monthStr: string
  today: string
  displayLabel: string
  // Actions
  setMode: (mode: DateMode) => void
  setActiveMonth: (d: Date) => void
  setActiveYear: (y: number) => void
  setActiveQuarter: (q: number) => void
  setActiveHalf: (h: number) => void
  setCustomRange: (start: string, end: string) => void
  prevPeriod: () => void
  nextPeriod: () => void
  // Backward compat
  prevMonth: () => void
  nextMonth: () => void
}

const DateContext = createContext<DateContextValue | null>(null)

export function DateProvider({ children }: { children: ReactNode }) {
  const now = new Date()
  const [mode, setMode] = useState<DateMode>('monthly')
  const [activeMonth, setActiveMonth] = useState<Date>(now)
  const [activeYear, setActiveYear] = useState(now.getFullYear())
  const [activeQuarter, setActiveQuarter] = useState(Math.ceil((now.getMonth() + 1) / 3))
  const [activeHalf, setActiveHalf] = useState(now.getMonth() < 6 ? 1 : 2)
  const [customStart, setCustomStart] = useState(format(startOfMonth(now), 'yyyy-MM-dd'))
  const [customEnd, setCustomEnd] = useState(format(endOfMonth(now), 'yyyy-MM-dd'))

  const todayStr = format(now, 'yyyy-MM-dd')

  const value = useMemo<DateContextValue>(() => {
    let startDate: string
    let endDate: string
    let displayLabel: string

    switch (mode) {
      case 'today':
        startDate = endDate = todayStr
        displayLabel = `Today, ${format(now, 'd MMM')}`
        break
      case 'yesterday': {
        const y = subDays(now, 1)
        startDate = endDate = format(y, 'yyyy-MM-dd')
        displayLabel = `Yesterday, ${format(y, 'd MMM')}`
        break
      }
      case 'thisweek':
        startDate = format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd')
        endDate = todayStr
        displayLabel = 'This Week'
        break
      case 'quarterly': {
        const d = getQuarterDates(activeYear, activeQuarter)
        startDate = d.start; endDate = d.end
        displayLabel = `Q${activeQuarter} ${activeYear}`
        break
      }
      case 'halfyear': {
        const d = getHalfDates(activeYear, activeHalf)
        startDate = d.start; endDate = d.end
        displayLabel = `H${activeHalf} ${activeYear}`
        break
      }
      case 'yearly':
        startDate = format(new Date(activeYear, 0, 1), 'yyyy-MM-dd')
        endDate = format(new Date(activeYear, 11, 31), 'yyyy-MM-dd')
        displayLabel = `Year ${activeYear}`
        break
      case 'financialyear':
        startDate = format(new Date(activeYear, 3, 1), 'yyyy-MM-dd')
        endDate = format(new Date(activeYear + 1, 2, 31), 'yyyy-MM-dd')
        displayLabel = `FY ${activeYear}-${(activeYear + 1).toString().slice(2)}`
        break
      case 'custom':
        startDate = customStart || format(startOfMonth(now), 'yyyy-MM-dd')
        endDate = customEnd || format(endOfMonth(now), 'yyyy-MM-dd')
        displayLabel = customStart && customEnd
          ? `${format(new Date(customStart + 'T00:00:00'), 'd MMM')} – ${format(new Date(customEnd + 'T00:00:00'), 'd MMM yy')}`
          : 'Custom'
        break
      case 'monthly':
      default:
        startDate = format(startOfMonth(activeMonth), 'yyyy-MM-dd')
        endDate = format(endOfMonth(activeMonth), 'yyyy-MM-dd')
        displayLabel = format(activeMonth, 'MMMM yyyy')
        break
    }

    const prevPeriod = () => {
      switch (mode) {
        case 'monthly': setActiveMonth(m => subMonths(m, 1)); break
        case 'quarterly':
          if (activeQuarter === 1) { setActiveYear(y => y - 1); setActiveQuarter(4) }
          else setActiveQuarter(q => q - 1)
          break
        case 'halfyear':
          if (activeHalf === 1) { setActiveYear(y => y - 1); setActiveHalf(2) }
          else setActiveHalf(1)
          break
        case 'yearly':
        case 'financialyear':
          setActiveYear(y => y - 1); break
        default: break
      }
    }

    const nextPeriod = () => {
      switch (mode) {
        case 'monthly': setActiveMonth(m => addMonths(m, 1)); break
        case 'quarterly':
          if (activeQuarter === 4) { setActiveYear(y => y + 1); setActiveQuarter(1) }
          else setActiveQuarter(q => q + 1)
          break
        case 'halfyear':
          if (activeHalf === 2) { setActiveYear(y => y + 1); setActiveHalf(1) }
          else setActiveHalf(2)
          break
        case 'yearly':
        case 'financialyear':
          setActiveYear(y => y + 1); break
        default: break
      }
    }

    return {
      mode, activeMonth, activeYear, activeQuarter, activeHalf,
      customStart, customEnd,
      startDate, endDate,
      monthStr: format(startOfMonth(activeMonth), 'yyyy-MM'),
      today: todayStr,
      displayLabel,
      setMode,
      setActiveMonth,
      setActiveYear,
      setActiveQuarter,
      setActiveHalf,
      setCustomRange: (s: string, e: string) => { setCustomStart(s); setCustomEnd(e) },
      prevPeriod,
      nextPeriod,
      prevMonth: () => setActiveMonth(m => subMonths(m, 1)),
      nextMonth: () => setActiveMonth(m => addMonths(m, 1)),
    }
  }, [mode, activeMonth, activeYear, activeQuarter, activeHalf, customStart, customEnd, todayStr])

  return <DateContext.Provider value={value}>{children}</DateContext.Provider>
}

export function useDateContext() {
  const ctx = useContext(DateContext)
  if (!ctx) throw new Error('useDateContext must be used within DateProvider')
  return ctx
}
