"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { useActiveRestaurant } from "@/hooks/use-active-restaurant"
import { useCollection, useMemoFirebase, useFirestore } from "@/firebase"
import { collection, doc } from "firebase/firestore"
import { SalesAccount, SalePayment, Expense, Transfer, Party, Staff } from "@/lib/types"
import { format, eachDayOfInterval, startOfMonth, endOfMonth, subDays } from "date-fns"
import { useDateContext } from "@/contexts/date-context"
import {
  BookOpen, Wallet, ArrowUpRight, ArrowDownRight,
  AlertTriangle, CheckCircle2, Edit3, X, ArrowLeftRight, Receipt, ShoppingCart,
  Banknote, Clock, Tag, User, Store, ChevronDown
} from "lucide-react"
import { cn } from "@/lib/utils"
import { getSettlementDate } from "@/lib/utils"
import { setDocumentNonBlocking, deleteDocumentNonBlocking } from "@/firebase/non-blocking-updates"

// ─── Transaction Detail Panel ────────────────────────────────────────────────

type DayLedgerEntry = {
  date: Date
  dayStr: string
  dayName: string
  openingBalance: number
  openingIsConfirmed: boolean
  cashIn: number; txIn: number; totalIn: number
  cashOut: number; txOut: number; totalOut: number
  closingBalance: number
  physicalBalance: number | null
  difference: number | null
  hasActivity: boolean
  isToday: boolean; isFuture: boolean; isPast: boolean
  paymentsList: SalePayment[]
  expensesList: Expense[]
  transfersInList: any[]
  transfersOutList: any[]
}

function TransactionDetailPanel({
  panel, onClose, accounts, parties, staff, showAccountName,
}: {
  panel: { type: 'in' | 'out'; day: DayLedgerEntry } | null
  onClose: () => void
  accounts: SalesAccount[] | undefined
  parties: Party[] | undefined
  staff: Staff[] | undefined
  showAccountName?: boolean
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  if (!panel) return null

  const { type, day } = panel
  const isIn = type === 'in'
  const total = isIn ? day.totalIn : day.totalOut

  const accountName = (id: string) => accounts?.find(a => a.id === id)?.name ?? id
  const partyName = (id?: string) => id ? parties?.find(p => p.id === id)?.name : undefined
  const staffName = (id?: string) => id ? staff?.find(s => s.id === id)?.name : undefined

  type TxItem =
    | { kind: 'payment'; data: SalePayment }
    | { kind: 'expense'; data: Expense }
    | { kind: 'transfer-in'; data: any }
    | { kind: 'transfer-out'; data: any }

  const items: TxItem[] = isIn
    ? [
        ...day.paymentsList.map(d => ({ kind: 'payment' as const, data: d })),
        ...day.transfersInList.map(d => ({ kind: 'transfer-in' as const, data: d })),
      ]
    : [
        ...day.expensesList.map(d => ({ kind: 'expense' as const, data: d })),
        ...day.transfersOutList.map(d => ({ kind: 'transfer-out' as const, data: d })),
      ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      {/* Blur overlay */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className={cn(
          "relative w-full sm:max-w-md mx-4 mb-0 sm:mb-0 rounded-t-3xl sm:rounded-3xl overflow-hidden",
          "shadow-2xl ring-1 ring-black/10",
          "animate-in slide-in-from-bottom-8 duration-300 ease-out",
          "flex flex-col max-h-[85vh]"
        )}
        onClick={e => e.stopPropagation()}
      >
        {/* Glass header */}
        <div className={cn(
          "px-5 pt-5 pb-4 flex-shrink-0",
          isIn
            ? "bg-gradient-to-br from-emerald-500 to-emerald-600"
            : "bg-gradient-to-br from-red-500 to-rose-600"
        )}>
          {/* Pull handle */}
          <div className="w-10 h-1 bg-white/30 rounded-full mx-auto mb-4 sm:hidden" />

          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="size-7 rounded-xl bg-white/20 flex items-center justify-center">
                  {isIn
                    ? <ArrowUpRight className="size-4 text-white" />
                    : <ArrowDownRight className="size-4 text-white" />}
                </div>
                <span className="text-white/80 text-xs font-bold uppercase tracking-widest">
                  {isIn ? 'Cash In' : 'Cash Out'}
                </span>
              </div>
              <p className="text-white font-black text-xl leading-tight">
                {format(day.date, 'EEEE')}
              </p>
              <p className="text-white/70 text-sm font-medium">
                {format(day.date, 'dd MMMM yyyy')}
              </p>
            </div>
            <div className="text-right">
              <p className="text-white/60 text-[10px] font-bold uppercase tracking-widest mb-0.5">
                {items.length} transaction{items.length !== 1 ? 's' : ''}
              </p>
              <p className="text-white font-black text-2xl">
                ₹{total.toLocaleString('en-IN')}
              </p>
            </div>
          </div>
        </div>

        {/* Transaction list */}
        <div className="flex-1 overflow-y-auto bg-white/95 backdrop-blur-2xl divide-y divide-slate-100/80">
          {items.length === 0 ? (
            <div className="py-12 flex flex-col items-center gap-3 text-muted-foreground">
              <Wallet className="size-10 opacity-20" />
              <p className="text-xs font-bold uppercase tracking-widest opacity-40">No transactions</p>
            </div>
          ) : items.map((item, i) => {
            if (item.kind === 'payment') {
              const p = item.data
              return (
                <div key={i} className="flex items-start gap-3 px-5 py-3.5 hover:bg-emerald-50/50 transition-colors">
                  <div className="size-9 rounded-2xl bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Banknote className="size-4 text-emerald-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">
                      {p.description || 'Sale Payment'}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {showAccountName && p.salesAccountId && (
                        <span className="text-[10px] bg-slate-100 text-slate-600 font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                          <Store className="size-2.5" />{accountName(p.salesAccountId)}
                        </span>
                      )}
                      {p.paymentMethod && (
                        <span className="text-[10px] bg-emerald-100 text-emerald-700 font-bold px-1.5 py-0.5 rounded-full">
                          {p.paymentMethod}
                        </span>
                      )}
                      {p.paymentTime && (
                        <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                          <Clock className="size-2.5" />{p.paymentTime}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-emerald-700 font-black text-sm flex-shrink-0">
                    +₹{Number(p.amount).toLocaleString('en-IN')}
                  </span>
                </div>
              )
            }

            if (item.kind === 'expense') {
              const e = item.data
              const name = e.description || partyName(e.partyId) || staffName(e.staffId) || e.vendor || 'Expense'
              const sub = e.category || e.subCategory
              return (
                <div key={i} className="flex items-start gap-3 px-5 py-3.5 hover:bg-red-50/50 transition-colors">
                  <div className="size-9 rounded-2xl bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <ShoppingCart className="size-4 text-red-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">{name}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {showAccountName && e.accountId && (
                        <span className="text-[10px] bg-slate-100 text-slate-600 font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                          <Store className="size-2.5" />{accountName(e.accountId)}
                        </span>
                      )}
                      {sub && (
                        <span className="text-[10px] bg-red-100 text-red-600 font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                          <Tag className="size-2.5" />{sub}
                        </span>
                      )}
                      {e.paymentTime && (
                        <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                          <Clock className="size-2.5" />{e.paymentTime}
                        </span>
                      )}
                      {partyName(e.partyId) && e.description && (
                        <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                          <Store className="size-2.5" />{partyName(e.partyId)}
                        </span>
                      )}
                      {staffName(e.staffId) && (
                        <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                          <User className="size-2.5" />{staffName(e.staffId)}
                          {e.staffEntryType && ` · ${e.staffEntryType}`}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-red-600 font-black text-sm flex-shrink-0">
                    −₹{Number(e.amount).toLocaleString('en-IN')}
                  </span>
                </div>
              )
            }

            if (item.kind === 'transfer-in') {
              const t = item.data
              return (
                <div key={i} className="flex items-start gap-3 px-5 py-3.5 hover:bg-blue-50/50 transition-colors">
                  <div className="size-9 rounded-2xl bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <ArrowLeftRight className="size-4 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">
                      {t.description || 'Transfer In'}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      From: {accountName(t.fromAccountId)}
                    </p>
                  </div>
                  <span className="text-blue-600 font-black text-sm flex-shrink-0">
                    +₹{Number(t.amount).toLocaleString('en-IN')}
                  </span>
                </div>
              )
            }

            if (item.kind === 'transfer-out') {
              const t = item.data
              return (
                <div key={i} className="flex items-start gap-3 px-5 py-3.5 hover:bg-orange-50/50 transition-colors">
                  <div className="size-9 rounded-2xl bg-orange-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <ArrowLeftRight className="size-4 text-orange-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">
                      {t.description || 'Transfer Out'}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      To: {accountName(t.toAccountId)}
                    </p>
                  </div>
                  <span className="text-orange-600 font-black text-sm flex-shrink-0">
                    −₹{Number(t.amount).toLocaleString('en-IN')}
                  </span>
                </div>
              )
            }

            return null
          })}
        </div>

        {/* Sticky footer */}
        <div className="flex-shrink-0 px-5 py-4 bg-white/95 backdrop-blur-2xl border-t border-slate-100 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              {isIn ? 'Total Received' : 'Total Paid Out'}
            </p>
            <p className={cn(
              "text-xl font-black",
              isIn ? "text-emerald-600" : "text-red-600"
            )}>
              {isIn ? '+' : '−'}₹{total.toLocaleString('en-IN')}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="h-9 px-4 rounded-xl font-bold text-xs gap-1.5"
          >
            <X className="size-3.5" /> Close
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Per-account opening balance helper ───────────────────────────────────────

function getAccountOpeningBalance(
  accountId: string,
  accounts: SalesAccount[],
  payments: SalePayment[] | undefined,
  expenses: Expense[] | undefined,
  transfers: any[] | undefined,
  monthlyBalances: any[] | undefined,
  monthStr: string,
  currentMonth: Date
): number {
  const acc = accounts.find(a => a.id === accountId)
  if (!acc) return 0

  const savedRecord = (monthlyBalances || []).find((mb: any) =>
    mb.accountId === accountId && mb.entityType !== 'party' && mb.monthStr === monthStr
  )
  const prevBalances = (monthlyBalances || [])
    .filter((mb: any) => mb.accountId === accountId && mb.entityType !== 'party' && mb.monthStr < monthStr)
    .sort((a: any, b: any) => b.monthStr.localeCompare(a.monthStr))

  let baselineDate = acc.openingBalanceDate || '2000-01-01'
  let baselineAmount = Number(acc.balance) || 0

  if (prevBalances.length > 0) {
    baselineDate = `${prevBalances[0].monthStr}-01`
    baselineAmount = prevBalances[0].actualOpeningBalance
  } else {
    if (savedRecord) return savedRecord.actualOpeningBalance
  }

  const endCalcDate = format(subDays(startOfMonth(currentMonth), 1), 'yyyy-MM-dd')
  if (baselineDate > endCalcDate) return baselineAmount

  const accType = acc.type || 'Cash'
  const totalIn = (payments || [])
    .filter(p => {
      if (p.salesAccountId !== accountId) return false
      const { date: effectiveDate } = getSettlementDate(p.paymentDate, accType)
      return effectiveDate >= baselineDate && effectiveDate <= endCalcDate
    })
    .reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const totalOut = (expenses || [])
    .filter(e => e.accountId === accountId && !e.isAccrual && e.paymentDate >= baselineDate && e.paymentDate <= endCalcDate)
    .reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const txIn = (transfers || [])
    .filter((t: any) => t.toAccountId === accountId && t.date >= baselineDate && t.date <= endCalcDate)
    .reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0)
  const txOut = (transfers || [])
    .filter((t: any) => t.fromAccountId === accountId && t.date >= baselineDate && t.date <= endCalcDate)
    .reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0)

  return baselineAmount + totalIn - totalOut + txIn - txOut
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BalancePage() {
  const { restaurant } = useActiveRestaurant()
  const db = useFirestore()

  const { activeMonth: currentMonth } = useDateContext()
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([])
  const [accountPickerOpen, setAccountPickerOpen] = useState(false)
  const [editingPhysical, setEditingPhysical] = useState<string | null>(null)
  const [physicalInputValue, setPhysicalInputValue] = useState("")
  const [editingOpening, setEditingOpening] = useState(false)
  const [openingInputValue, setOpeningInputValue] = useState("")
  const [detailPanel, setDetailPanel] = useState<{ type: 'in' | 'out'; day: DayLedgerEntry } | null>(null)
  const physicalInputRef = useRef<HTMLInputElement>(null)
  const openingInputRef = useRef<HTMLInputElement>(null)

  const paymentsRef = useMemoFirebase(() =>
    restaurant ? collection(db, 'restaurants', restaurant.id, 'salePayments') : null
  , [db, restaurant?.id])
  const expensesRef = useMemoFirebase(() =>
    restaurant ? collection(db, 'restaurants', restaurant.id, 'expenses') : null
  , [db, restaurant?.id])
  const accountsRef = useMemoFirebase(() =>
    restaurant ? collection(db, 'restaurants', restaurant.id, 'salesAccounts') : null
  , [db, restaurant?.id])
  const transfersRef = useMemoFirebase(() =>
    restaurant ? collection(db, 'restaurants', restaurant.id, 'transfers') : null
  , [db, restaurant?.id])
  const monthlyBalancesRef = useMemoFirebase(() =>
    restaurant ? collection(db, 'restaurants', restaurant.id, 'monthlyBalances') : null
  , [db, restaurant?.id])
  const dailyPhysicalRef = useMemoFirebase(() =>
    restaurant ? collection(db, 'restaurants', restaurant.id, 'dailyPhysicalBalances') : null
  , [db, restaurant?.id])
  const partiesRef = useMemoFirebase(() =>
    restaurant ? collection(db, 'restaurants', restaurant.id, 'parties') : null
  , [db, restaurant?.id])
  const staffRef = useMemoFirebase(() =>
    restaurant ? collection(db, 'restaurants', restaurant.id, 'staff') : null
  , [db, restaurant?.id])

  const { data: accounts } = useCollection<SalesAccount>(accountsRef)
  const { data: payments } = useCollection<SalePayment>(paymentsRef)
  const { data: expenses } = useCollection<Expense>(expensesRef)
  const { data: transfers } = useCollection<any>(transfersRef)
  const { data: monthlyBalances } = useCollection<any>(monthlyBalancesRef)
  const { data: dailyPhysicals } = useCollection<any>(dailyPhysicalRef)
  const { data: parties } = useCollection<Party>(partiesRef)
  const { data: staff } = useCollection<Staff>(staffRef)

  // Init to all accounts; prune stale IDs if accounts list changes
  useEffect(() => {
    if (!accounts || accounts.length === 0) return
    if (selectedAccountIds.length === 0) {
      setSelectedAccountIds(accounts.map(a => a.id))
      return
    }
    const valid = selectedAccountIds.filter(id => accounts.some(a => a.id === id))
    if (valid.length !== selectedAccountIds.length) {
      setSelectedAccountIds(valid.length > 0 ? valid : accounts.map(a => a.id))
    }
  }, [accounts])

  useEffect(() => {
    if (editingPhysical && physicalInputRef.current) {
      physicalInputRef.current.focus()
      physicalInputRef.current.select()
    }
  }, [editingPhysical])

  useEffect(() => {
    if (editingOpening && openingInputRef.current) {
      openingInputRef.current.focus()
      openingInputRef.current.select()
    }
  }, [editingOpening])

  const isMultiAccount = selectedAccountIds.length !== 1
  // For single-account mode, which account is selected
  const selectedAccountId = !isMultiAccount ? selectedAccountIds[0] : ''
  const selectedAccount = useMemo(() =>
    !isMultiAccount ? accounts?.find(a => a.id === selectedAccountIds[0]) : undefined
  , [accounts, selectedAccountIds, isMultiAccount])

  const monthStr = useMemo(() =>
    currentMonth ? format(startOfMonth(currentMonth), 'yyyy-MM') : ''
  , [currentMonth])

  const savedOpeningRecord = useMemo(() =>
    isMultiAccount ? null :
    (monthlyBalances || []).find((mb: any) =>
      mb.accountId === selectedAccountIds[0] && mb.entityType !== 'party' && mb.monthStr === monthStr
    )
  , [monthlyBalances, selectedAccountIds, monthStr, isMultiAccount])

  const monthOpeningBalance = useMemo(() => {
    if (!currentMonth || !accounts || accounts.length === 0 || selectedAccountIds.length === 0) return 0
    const p = payments ?? undefined
    const e = expenses ?? undefined
    const t = transfers ?? undefined
    const mb = monthlyBalances ?? undefined
    return selectedAccountIds.reduce((sum, id) =>
      sum + getAccountOpeningBalance(id, accounts, p, e, t, mb, monthStr, currentMonth)
    , 0)
  }, [selectedAccountIds, currentMonth, accounts, payments, expenses, transfers, monthlyBalances, monthStr])

  const dailyLedger = useMemo((): DayLedgerEntry[] => {
    if (!currentMonth || selectedAccountIds.length === 0) return []
    const days = eachDayOfInterval({ start: startOfMonth(currentMonth), end: endOfMonth(currentMonth) })
    let runningBalance = monthOpeningBalance
    const todayStr = format(new Date(), 'yyyy-MM-dd')

    if (isMultiAccount) {
      // Combined view: aggregate selected accounts
      // Transfers between selected accounts cancel out — only count cross-group transfers
      const idSet = new Set(selectedAccountIds)
      return days.map(day => {
        const dayStr = format(day, 'yyyy-MM-dd')
        const openingBalance = runningBalance

        const paymentsList = (payments || []).filter(p => {
          if (!idSet.has(p.salesAccountId)) return false
          const acc = accounts?.find(a => a.id === p.salesAccountId)
          const accType = acc?.type || 'Cash'
          const { date: effectiveDate } = getSettlementDate(p.paymentDate, accType)
          return effectiveDate === dayStr
        })
        const cashIn = paymentsList.reduce((s, p) => s + (Number(p.amount) || 0), 0)

        const expensesList = (expenses || []).filter(
          e => !!e.accountId && idSet.has(e.accountId) && !e.isAccrual && e.paymentDate === dayStr
        )
        const cashOut = expensesList.reduce((s, e) => s + (Number(e.amount) || 0), 0)

        // Transfers coming in from outside the selected group
        const transfersInList = (transfers || []).filter(
          (t: any) => idSet.has(t.toAccountId) && !idSet.has(t.fromAccountId) && t.date === dayStr
        )
        const txIn = transfersInList.reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0)

        // Transfers going out to accounts outside the selected group
        const transfersOutList = (transfers || []).filter(
          (t: any) => idSet.has(t.fromAccountId) && !idSet.has(t.toAccountId) && t.date === dayStr
        )
        const txOut = transfersOutList.reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0)

        const totalIn = cashIn + txIn
        const totalOut = cashOut + txOut
        const closingBalance = openingBalance + totalIn - totalOut
        runningBalance = closingBalance

        return {
          date: day, dayStr, dayName: format(day, 'EEE'),
          openingBalance, openingIsConfirmed: false,
          cashIn, txIn, totalIn,
          cashOut, txOut, totalOut,
          closingBalance, physicalBalance: null, difference: null,
          hasActivity: totalIn > 0 || totalOut > 0,
          isToday: dayStr === todayStr,
          isFuture: dayStr > todayStr,
          isPast: dayStr < todayStr,
          paymentsList, expensesList, transfersInList, transfersOutList,
        }
      })
    }

    // Single-account view
    const accType = selectedAccount?.type || 'Cash'
    return days.map(day => {
      const dayStr = format(day, 'yyyy-MM-dd')
      const openingBalance = runningBalance

      const paymentsList = (payments || []).filter(p => {
        if (p.salesAccountId !== selectedAccountId) return false
        const { date: effectiveDate } = getSettlementDate(p.paymentDate, accType)
        return effectiveDate === dayStr
      })
      const cashIn = paymentsList.reduce((s, p) => s + (Number(p.amount) || 0), 0)

      const transfersInList = (transfers || []).filter(
        (t: any) => t.toAccountId === selectedAccountId && t.date === dayStr
      )
      const txIn = transfersInList.reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0)

      const expensesList = (expenses || []).filter(
        e => e.accountId === selectedAccountId && !e.isAccrual && e.paymentDate === dayStr
      )
      const cashOut = expensesList.reduce((s, e) => s + (Number(e.amount) || 0), 0)

      const transfersOutList = (transfers || []).filter(
        (t: any) => t.fromAccountId === selectedAccountId && t.date === dayStr
      )
      const txOut = transfersOutList.reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0)

      const totalIn = cashIn + txIn
      const totalOut = cashOut + txOut
      const closingBalance = openingBalance + totalIn - totalOut

      const physicalDoc = (dailyPhysicals || []).find(
        (d: any) => d.accountId === selectedAccountId && d.date === dayStr
      )
      const physicalBalance: number | null = physicalDoc ? Number(physicalDoc.physicalBalance) : null
      const difference = physicalBalance !== null ? physicalBalance - closingBalance : null

      runningBalance = physicalBalance !== null ? physicalBalance : closingBalance

      return {
        date: day, dayStr, dayName: format(day, 'EEE'),
        openingBalance, openingIsConfirmed: false,
        cashIn, txIn, totalIn,
        cashOut, txOut, totalOut,
        closingBalance, physicalBalance, difference,
        hasActivity: totalIn > 0 || totalOut > 0,
        isToday: dayStr === todayStr,
        isFuture: dayStr > todayStr,
        isPast: dayStr < todayStr,
        paymentsList, expensesList, transfersInList, transfersOutList,
      }
    })
    .map((day, idx, arr) => ({
      ...day,
      openingIsConfirmed: idx > 0 && arr[idx - 1].physicalBalance !== null,
    }))
  }, [currentMonth, selectedAccountIds, isMultiAccount, monthOpeningBalance, payments, expenses, transfers, dailyPhysicals, selectedAccount, accounts])

  const monthlySummary = useMemo(() => {
    const totalIn = dailyLedger.reduce((s, d) => s + d.totalIn, 0)
    const totalOut = dailyLedger.reduce((s, d) => s + d.totalOut, 0)
    const openingBalance = dailyLedger[0]?.openingBalance || 0
    const closingBalance = dailyLedger[dailyLedger.length - 1]?.closingBalance || 0
    const daysWithDiscrepancy = dailyLedger.filter(d => d.difference !== null && d.difference !== 0).length
    return { totalIn, totalOut, openingBalance, closingBalance, daysWithDiscrepancy }
  }, [dailyLedger])

  const handleSavePhysical = (dayStr: string, val: string) => {
    if (!restaurant || isMultiAccount || !selectedAccountId) return
    const docId = `${selectedAccountId}_${dayStr}`
    const amount = parseFloat(val)
    if (isNaN(amount) || val.trim() === '') {
      deleteDocumentNonBlocking(doc(db, 'restaurants', restaurant.id, 'dailyPhysicalBalances', docId))
    } else {
      setDocumentNonBlocking(doc(db, 'restaurants', restaurant.id, 'dailyPhysicalBalances', docId), {
        id: docId, restaurantId: restaurant.id, accountId: selectedAccountId,
        date: dayStr, physicalBalance: amount, restaurantMembers: restaurant.members
      }, {})
    }
    setEditingPhysical(null)
  }

  const handleSaveOpening = (val: string) => {
    if (!restaurant || isMultiAccount || !selectedAccountId || !monthStr) return
    const docId = `${selectedAccountId}_${monthStr}`
    const amount = parseFloat(val)
    if (isNaN(amount) || val.trim() === '') {
      deleteDocumentNonBlocking(doc(db, 'restaurants', restaurant.id, 'monthlyBalances', docId))
    } else {
      setDocumentNonBlocking(doc(db, 'restaurants', restaurant.id, 'monthlyBalances', docId), {
        id: docId, restaurantId: restaurant.id, accountId: selectedAccountId,
        entityType: 'account', monthStr, actualOpeningBalance: amount,
        restaurantMembers: restaurant.members
      }, { merge: true })
    }
    setEditingOpening(false)
  }

  if (!restaurant) return null

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-500">
      {/* Transaction Detail Panel */}
      <TransactionDetailPanel
        panel={detailPanel}
        onClose={() => setDetailPanel(null)}
        accounts={accounts ?? undefined}
        parties={parties ?? undefined}
        staff={staff ?? undefined}
        showAccountName={isMultiAccount}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
        </div>
        {/* Multi-account selector */}
        {(() => {
          const allIds = accounts?.map(a => a.id) ?? []
          const cashIds = accounts?.filter(a => a.type === 'Cash').map(a => a.id) ?? []
          const bankIds = accounts?.filter(a => a.type !== 'Cash').map(a => a.id) ?? []
          const allSelected = allIds.length > 0 && selectedAccountIds.length === allIds.length
          const cashOnly = cashIds.length > 0 && selectedAccountIds.length === cashIds.length && cashIds.every(id => selectedAccountIds.includes(id))
          const bankOnly = bankIds.length > 0 && selectedAccountIds.length === bankIds.length && bankIds.every(id => selectedAccountIds.includes(id))
          const triggerLabel = allSelected ? '🏛️ All Accounts' :
            cashOnly ? '💵 Cash Only' :
            bankOnly ? '🏦 Bank / Online' :
            !isMultiAccount ? `${selectedAccount?.type === 'Cash' ? '💵' : '🏦'} ${selectedAccount?.name ?? ''}` :
            `${selectedAccountIds.length} Accounts`

          const toggle = (id: string) => {
            setSelectedAccountIds(prev =>
              prev.includes(id) ? (prev.length > 1 ? prev.filter(x => x !== id) : prev) : [...prev, id]
            )
          }

          return (
            <Popover open={accountPickerOpen} onOpenChange={setAccountPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="h-10 px-4 font-black bg-white shadow-sm border-primary/20 gap-2 min-w-[180px] justify-between">
                  <span className="truncate">{triggerLabel}</span>
                  <ChevronDown className="size-3.5 opacity-60 flex-shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-3 space-y-3">
                {/* Presets */}
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1.5">Quick Select</p>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant={allSelected ? "default" : "outline"}
                      className="h-7 text-xs font-bold px-2.5"
                      onClick={() => setSelectedAccountIds(allIds)}>
                      🏛️ All
                    </Button>
                    {cashIds.length > 0 && (
                      <Button size="sm" variant={cashOnly ? "default" : "outline"}
                        className="h-7 text-xs font-bold px-2.5"
                        onClick={() => setSelectedAccountIds(cashIds)}>
                        💵 Cash
                      </Button>
                    )}
                    {bankIds.length > 0 && (
                      <Button size="sm" variant={bankOnly ? "default" : "outline"}
                        className="h-7 text-xs font-bold px-2.5"
                        onClick={() => setSelectedAccountIds(bankIds)}>
                        🏦 Bank
                      </Button>
                    )}
                  </div>
                </div>
                {/* Individual accounts */}
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1.5">Individual</p>
                  <div className="space-y-1.5">
                    {accounts?.map(acc => (
                      <label key={acc.id} className="flex items-center gap-2.5 cursor-pointer rounded-lg px-2 py-1.5 hover:bg-muted/50 transition-colors">
                        <Checkbox
                          checked={selectedAccountIds.includes(acc.id)}
                          onCheckedChange={() => toggle(acc.id)}
                        />
                        <span className="text-sm font-bold flex-1 truncate">
                          {acc.type === 'Cash' ? '💵' : '🏦'} {acc.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground font-medium">{acc.type}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )
        })()}
      </div>

      {selectedAccountIds.length > 0 && (
        <>
          {/* Multi-account info banner */}
          {isMultiAccount && (
            <Card className="border-none shadow-sm bg-gradient-to-r from-primary/5 to-blue-50">
              <CardContent className="p-4 flex items-center gap-3">
                <Store className="size-4 text-primary" />
                <p className="text-xs font-black text-primary uppercase tracking-widest">
                  Combined view across {selectedAccountIds.length} account{selectedAccountIds.length !== 1 ? 's' : ''} · Internal transfers excluded
                </p>
              </CardContent>
            </Card>
          )}
          {/* Opening Balance Override — single account only */}
          {!isMultiAccount && <Card className="border-none shadow-sm bg-white">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    Month Opening Balance — {format(currentMonth, 'MMMM yyyy')}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Calculated from history:{" "}
                    <span className="font-bold text-foreground">₹{monthlySummary.openingBalance.toLocaleString('en-IN')}</span>
                    {savedOpeningRecord && (
                      <span className="ml-2 text-primary font-bold">
                        · Confirmed: ₹{Number(savedOpeningRecord.actualOpeningBalance).toLocaleString('en-IN')}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {editingOpening ? (
                    <>
                      <Input
                        ref={openingInputRef}
                        type="number"
                        value={openingInputValue}
                        onChange={e => setOpeningInputValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleSaveOpening(openingInputValue)
                          if (e.key === 'Escape') setEditingOpening(false)
                        }}
                        onBlur={() => handleSaveOpening(openingInputValue)}
                        className="h-8 w-36 font-bold text-right"
                        placeholder="Enter amount"
                      />
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditingOpening(false)}>
                        <X className="size-4" />
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline" size="sm"
                      className="h-8 text-xs font-bold gap-1.5"
                      onClick={() => {
                        setOpeningInputValue(savedOpeningRecord
                          ? String(savedOpeningRecord.actualOpeningBalance)
                          : String(monthlySummary.openingBalance))
                        setEditingOpening(true)
                      }}
                    >
                      <Edit3 className="size-3" />
                      {savedOpeningRecord ? 'Edit Opening' : 'Set Opening'}
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>}

          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="border-l-4 border-l-slate-400">
              <CardHeader className="pb-1 pt-4 px-4">
                <CardTitle className="text-[10px] font-bold uppercase text-muted-foreground">Opening Balance</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="text-lg md:text-xl lg:text-2xl font-bold text-slate-700">
                  ₹{monthlySummary.openingBalance.toLocaleString('en-IN')}
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">Start of {format(currentMonth, 'MMMM')}</p>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-emerald-500">
              <CardHeader className="pb-1 pt-4 px-4">
                <CardTitle className="text-[10px] font-bold uppercase text-emerald-700">Total In</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="text-lg md:text-xl lg:text-2xl font-bold text-emerald-700">
                  ₹{monthlySummary.totalIn.toLocaleString('en-IN')}
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">Revenue + Transfers In</p>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-destructive">
              <CardHeader className="pb-1 pt-4 px-4">
                <CardTitle className="text-[10px] font-bold uppercase text-destructive">Total Out</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="text-lg md:text-xl lg:text-2xl font-bold text-destructive">
                  ₹{monthlySummary.totalOut.toLocaleString('en-IN')}
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">Expenses + Transfers Out</p>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-primary">
              <CardHeader className="pb-1 pt-4 px-4">
                <CardTitle className="text-[10px] font-bold uppercase text-primary">Closing Balance</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="text-lg md:text-xl lg:text-2xl font-bold text-primary">
                  ₹{monthlySummary.closingBalance.toLocaleString('en-IN')}
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {monthlySummary.daysWithDiscrepancy > 0 ? (
                    <span className="text-amber-600 font-bold flex items-center gap-1">
                      <AlertTriangle className="size-3" />
                      {monthlySummary.daysWithDiscrepancy} day{monthlySummary.daysWithDiscrepancy > 1 ? 's' : ''} with discrepancy
                    </span>
                  ) : ('End of ' + format(currentMonth, 'MMMM'))}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Daily Ledger Table */}
          <Card className="border-none shadow-xl overflow-hidden">
            <div className="bg-primary/5 px-4 py-3 border-b flex items-center justify-between">
              <div>
                <h2 className="text-sm font-black uppercase tracking-wider text-primary">
                  {isMultiAccount
                    ? (selectedAccountIds.length === accounts?.length ? 'All Accounts' : `${selectedAccountIds.length} Accounts`)
                    : selectedAccount?.name
                  } — Daily Ledger — {format(currentMonth, 'MMMM yyyy')}
                </h2>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Click <span className="text-emerald-600 font-bold">In</span> or <span className="text-red-500 font-bold">Out</span> cells to see transaction details
                  {!isMultiAccount && ' · Click Physical to enter actual count'}
                </p>
              </div>
              <Badge variant="outline" className="font-black text-[10px]">
                {isMultiAccount ? `🏛️ ${selectedAccountIds.length} Accounts` : selectedAccount?.type === 'Cash' ? '💵 Cash' : '🏦 Bank'}
              </Badge>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm border-separate border-spacing-0">
                <thead>
                  <tr className="bg-muted/30">
                    <th className="px-3 py-3 text-left font-black text-[10px] uppercase text-muted-foreground border-b w-[60px]">Day</th>
                    <th className="px-3 py-3 text-left font-black text-[10px] uppercase text-muted-foreground border-b">Date</th>
                    <th className="px-4 py-3 text-right font-black text-[10px] uppercase text-slate-500 border-b border-l">Opening</th>
                    <th className="px-4 py-3 text-right font-black text-[10px] uppercase text-emerald-600 border-b border-l">In ↗</th>
                    <th className="px-4 py-3 text-right font-black text-[10px] uppercase text-destructive border-b border-l">Out ↙</th>
                    <th className="px-4 py-3 text-right font-black text-[10px] uppercase text-primary border-b border-l">Closing</th>
                    {!isMultiAccount && <th className="px-4 py-3 text-right font-black text-[10px] uppercase text-blue-600 border-b border-l bg-blue-50/50">Physical</th>}
                    {!isMultiAccount && <th className="px-4 py-3 text-right font-black text-[10px] uppercase text-amber-600 border-b border-l bg-amber-50/50">Diff</th>}
                  </tr>
                </thead>
                <tbody>
                  {dailyLedger.map((day, idx) => (
                    <tr
                      key={day.dayStr}
                      className={cn(
                        "transition-colors",
                        day.isToday && "bg-primary/5 ring-1 ring-inset ring-primary/20",
                        day.isFuture && "opacity-40",
                        !day.isToday && !day.isFuture && day.hasActivity && "bg-emerald-50/40",
                        !day.isToday && !day.isFuture && !day.hasActivity && (idx % 2 === 0 ? "bg-white" : "bg-muted/10"),
                        "hover:bg-muted/20"
                      )}
                    >
                      {/* Day name */}
                      <td className="px-3 py-2.5 border-b">
                        <div className="flex flex-col items-start">
                          <span className={cn(
                            "text-[10px] font-black uppercase tracking-wider",
                            day.isToday ? "text-primary" : "text-muted-foreground"
                          )}>{day.dayName}</span>
                          {day.isToday && <span className="text-[8px] text-primary font-bold bg-primary/10 px-1 rounded">TODAY</span>}
                        </div>
                      </td>

                      {/* Date */}
                      <td className="px-3 py-2.5 border-b font-bold text-xs">
                        {format(day.date, 'dd MMM')}
                      </td>

                      {/* Opening */}
                      <td className="px-4 py-2.5 border-b border-l text-right text-xs">
                        <span className={cn("font-medium", day.openingIsConfirmed ? "text-blue-700 font-black" : "text-slate-600")}>
                          ₹{day.openingBalance.toLocaleString('en-IN')}
                        </span>
                        {day.openingIsConfirmed && (
                          <div className="text-[8px] text-blue-500 font-bold uppercase tracking-wide">confirmed</div>
                        )}
                      </td>

                      {/* Cash In — clickable */}
                      <td className="px-4 py-2.5 border-b border-l text-right text-xs">
                        {day.totalIn > 0 ? (
                          <button
                            onClick={() => !day.isFuture && setDetailPanel({ type: 'in', day })}
                            className={cn(
                              "font-black text-emerald-700 flex items-center justify-end gap-1 w-full",
                              "rounded-lg px-2 py-1 -mx-2 transition-all",
                              !day.isFuture && "hover:bg-emerald-100 hover:scale-105 cursor-pointer active:scale-95"
                            )}
                          >
                            <ArrowUpRight className="size-3" />
                            ₹{day.totalIn.toLocaleString('en-IN')}
                          </button>
                        ) : (
                          <span className="text-muted-foreground/30">—</span>
                        )}
                      </td>

                      {/* Cash Out — clickable */}
                      <td className="px-4 py-2.5 border-b border-l text-right text-xs">
                        {day.totalOut > 0 ? (
                          <button
                            onClick={() => !day.isFuture && setDetailPanel({ type: 'out', day })}
                            className={cn(
                              "font-black text-destructive flex items-center justify-end gap-1 w-full",
                              "rounded-lg px-2 py-1 -mx-2 transition-all",
                              !day.isFuture && "hover:bg-red-100 hover:scale-105 cursor-pointer active:scale-95"
                            )}
                          >
                            <ArrowDownRight className="size-3" />
                            ₹{day.totalOut.toLocaleString('en-IN')}
                          </button>
                        ) : (
                          <span className="text-muted-foreground/30">—</span>
                        )}
                      </td>

                      {/* Calculated Closing */}
                      <td className={cn(
                        "px-4 py-2.5 border-b border-l text-right font-black text-xs",
                        day.isFuture ? "text-muted-foreground" :
                        day.closingBalance < 0 ? "text-destructive" :
                        day.closingBalance > day.openingBalance ? "text-emerald-700" : "text-primary"
                      )}>
                        ₹{day.closingBalance.toLocaleString('en-IN')}
                      </td>

                      {/* Physical Balance (single account only) */}
                      {!isMultiAccount && (
                        <td className="px-3 py-2 border-b border-l bg-blue-50/30 text-right">
                          {editingPhysical === day.dayStr ? (
                            <Input
                              ref={physicalInputRef}
                              type="number"
                              value={physicalInputValue}
                              onChange={e => setPhysicalInputValue(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleSavePhysical(day.dayStr, physicalInputValue)
                                if (e.key === 'Escape') setEditingPhysical(null)
                              }}
                              onBlur={() => handleSavePhysical(day.dayStr, physicalInputValue)}
                              className="h-7 w-28 text-right text-xs font-bold ml-auto"
                              placeholder="0"
                            />
                          ) : (
                            <button
                              className={cn(
                                "flex items-center justify-end gap-1 w-full text-xs font-bold rounded px-2 py-1 transition-colors",
                                day.isFuture ? "cursor-not-allowed opacity-30" : "hover:bg-blue-100 cursor-pointer",
                                day.physicalBalance !== null ? "text-blue-700" : "text-muted-foreground/40"
                              )}
                              disabled={day.isFuture}
                              onClick={() => {
                                if (day.isFuture) return
                                setPhysicalInputValue(day.physicalBalance !== null ? String(day.physicalBalance) : '')
                                setEditingPhysical(day.dayStr)
                              }}
                            >
                              {day.physicalBalance !== null
                                ? <>₹{day.physicalBalance.toLocaleString('en-IN')}</>
                                : <><Edit3 className="size-3 opacity-50" /> Enter</>}
                            </button>
                          )}
                        </td>
                      )}

                      {/* Difference (single account only) */}
                      {!isMultiAccount && (
                        <td className="px-4 py-2.5 border-b border-l bg-amber-50/20 text-right text-xs">
                          {day.difference === null ? (
                            <span className="text-muted-foreground/30">—</span>
                          ) : day.difference === 0 ? (
                            <span className="flex items-center justify-end gap-1 text-emerald-600 font-black">
                              <CheckCircle2 className="size-3" /> Balanced
                            </span>
                          ) : day.difference > 0 ? (
                            <span className="flex items-center justify-end gap-1 text-emerald-700 font-black">
                              <ArrowUpRight className="size-3" />
                              +₹{day.difference.toLocaleString('en-IN')}
                              <span className="text-[9px] text-emerald-600 font-medium">(extra)</span>
                            </span>
                          ) : (
                            <span className="flex items-center justify-end gap-1 text-destructive font-black">
                              <AlertTriangle className="size-3" />
                              ₹{Math.abs(day.difference).toLocaleString('en-IN')}
                              <span className="text-[9px] text-destructive/70 font-medium">(missing)</span>
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-900 text-white">
                    <td colSpan={2} className="px-3 py-3 font-black text-[11px] uppercase tracking-wider text-slate-300">Month Total</td>
                    <td className="px-4 py-3 text-right font-black text-slate-300 text-xs">₹{monthlySummary.openingBalance.toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3 text-right font-black text-emerald-400 text-xs">+₹{monthlySummary.totalIn.toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3 text-right font-black text-red-400 text-xs">−₹{monthlySummary.totalOut.toLocaleString('en-IN')}</td>
                    <td className={cn("px-4 py-3 text-right font-black text-white", isMultiAccount && "rounded-br-xl")} colSpan={isMultiAccount ? 1 : 1}>
                      ₹{monthlySummary.closingBalance.toLocaleString('en-IN')}
                    </td>
                    {!isMultiAccount && (
                      <td colSpan={2} className="px-4 py-3 text-right text-slate-400 text-[10px] font-bold">
                        {monthlySummary.daysWithDiscrepancy > 0 ? (
                          <span className="text-amber-400 flex items-center justify-end gap-1">
                            <AlertTriangle className="size-3" />
                            {monthlySummary.daysWithDiscrepancy} day{monthlySummary.daysWithDiscrepancy > 1 ? 's' : ''} unbalanced
                          </span>
                        ) : (
                          <span className="text-emerald-400 flex items-center justify-end gap-1">
                            <CheckCircle2 className="size-3" /> All verified
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </>
      )}

      {selectedAccountIds.length === 0 && (
        <Card className="border-dashed border-2">
          <CardContent className="flex flex-col items-center justify-center py-20 gap-4 text-muted-foreground">
            <Wallet className="size-12 opacity-20" />
            <p className="text-sm font-black uppercase tracking-widest opacity-40">
              Select an account above to see its daily cashbook
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
