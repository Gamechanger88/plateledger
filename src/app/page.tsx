"use client"

import { useState, useMemo, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TrendingUp, TrendingDown, LayoutDashboard, Loader2, ArrowRightCircle, ArrowLeftCircle, Wallet, History } from "lucide-react"
import { useDateContext } from "@/contexts/date-context"
import { Button } from "@/components/ui/button"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Bar, BarChart, XAxis, YAxis, CartesianGrid, Cell } from "recharts"
import { useActiveRestaurant } from "@/hooks/use-active-restaurant"
import { useCollection, useMemoFirebase, useFirestore } from "@/firebase"
import { collection } from "firebase/firestore"
import { SalePayment, Expense, SalesAccount, Staff, Party, DayStatus, MonthlyBalance, Transfer } from "@/lib/types"
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, subDays } from "date-fns"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { setDocumentNonBlocking, deleteDocumentNonBlocking } from "@/firebase/non-blocking-updates"
import { doc } from "firebase/firestore"
import { getSettlementDate } from "@/lib/utils"

export default function DashboardPage() {
  const router = useRouter()
  const { restaurant } = useActiveRestaurant()
  const db = useFirestore()
  const { activeMonth: currentMonth, monthStr, today } = useDateContext()

  const [activeTab, setActiveTab] = useState("overview")
  const [reconcileMonth, setReconcileMonth] = useState(monthStr)

  const paymentsRef = useMemoFirebase(() => 
    restaurant ? collection(db, 'restaurants', restaurant.id, 'salePayments') : null
  , [db, restaurant?.id]);
  
  const expensesRef = useMemoFirebase(() => 
    restaurant ? collection(db, 'restaurants', restaurant.id, 'expenses') : null
  , [db, restaurant?.id]);

  const accountsRef = useMemoFirebase(() => 
    restaurant ? collection(db, 'restaurants', restaurant.id, 'salesAccounts') : null
  , [db, restaurant?.id]);

  const staffRef = useMemoFirebase(() => 
    restaurant ? collection(db, 'restaurants', restaurant.id, 'staff') : null
  , [db, restaurant?.id]);

  const partiesRef = useMemoFirebase(() => 
    restaurant ? collection(db, 'restaurants', restaurant.id, 'parties') : null
  , [db, restaurant?.id]);

  const dayStatusesRef = useMemoFirebase(() => 
    restaurant ? collection(db, 'restaurants', restaurant.id, 'dayStatuses') : null
  , [db, restaurant?.id]);

  const monthlyBalancesRef = useMemoFirebase(() => 
    restaurant ? collection(db, 'restaurants', restaurant.id, 'monthlyBalances') : null
  , [db, restaurant?.id]);

  const transfersRef = useMemoFirebase(() => 
    restaurant ? collection(db, 'restaurants', restaurant.id, 'transfers') : null
  , [db, restaurant?.id]);

  const { data: payments } = useCollection<SalePayment>(paymentsRef);
  const { data: expenses } = useCollection<Expense>(expensesRef);
  const { data: accounts } = useCollection<SalesAccount>(accountsRef);
  const { data: staff } = useCollection<Staff>(staffRef);
  const { data: parties } = useCollection<Party>(partiesRef);
  const { data: dayStatuses } = useCollection<DayStatus>(dayStatusesRef);
  const { data: monthlyBalances } = useCollection<MonthlyBalance>(monthlyBalancesRef);
  const { data: transfers } = useCollection<Transfer>(transfersRef);

  const monthRange = useMemo(() => {
    if (!currentMonth) return null;
    return {
      start: startOfMonth(currentMonth),
      end: endOfMonth(currentMonth)
    };
  }, [currentMonth]);


  const dayStatusMap = useMemo(() => {
    const map = new Map<string, boolean>();
    dayStatuses?.forEach(ds => map.set(ds.id, ds.isClosed));
    return map;
  }, [dayStatuses]);

  const masterPayments = useMemo(() => {
    // First pass: accumulate imported entries per key (exclude manual daily_rev_ entries)
    const amountMap = new Map<string, number>();
    const refMap = new Map<string, SalePayment>();
    payments?.forEach(p => {
      const bizDate = p.businessDate || p.paymentDate;
      if (bizDate && p.salesAccountId && !p.id.startsWith('daily_rev_')) {
        const key = `${bizDate}_${p.salesAccountId}`;
        amountMap.set(key, (amountMap.get(key) || 0) + (Number(p.amount) || 0));
        if (!refMap.has(key)) refMap.set(key, p);
      }
    });
    // Second pass: manual daily_rev_ entries override imported sums entirely
    payments?.forEach(p => {
      const bizDate = p.businessDate || p.paymentDate;
      if (bizDate && p.salesAccountId && p.id.startsWith('daily_rev_')) {
        const key = `${bizDate}_${p.salesAccountId}`;
        amountMap.set(key, Number(p.amount) || 0);
        refMap.set(key, p);
      }
    });
    const map = new Map<string, SalePayment>();
    amountMap.forEach((total, key) => {
      const ref = refMap.get(key)!;
      map.set(key, { ...ref, amount: total });
    });
    return map;
  }, [payments]);

  const masterAccruals = useMemo(() => {
    const map = new Map<string, number>();
    expenses?.filter(e => e.isAccrual).forEach(e => {
      const date = e.invoiceDate;
      const entityId = e.partyId || e.staffId;
      if (date && entityId) {
        const key = `${date}_${entityId}`;
        const isSystemGenerated = e.id.startsWith('staff_accrual_') || e.id.startsWith('vendor_bill_');
        if (isSystemGenerated || !map.has(key)) {
          map.set(key, Number(e.amount) || 0);
        }
      }
    });
    return map;
  }, [expenses]);

  const plChartData = useMemo(() => {
    if (!monthRange || !today) return [];
    const days = eachDayOfInterval({ start: monthRange.start, end: monthRange.end });
    return days.map(day => {
      const dayStr = format(day, 'yyyy-MM-dd');
      const isClosed = !!dayStatusMap.get(dayStr);
      
      let dailySales = 0;
      if (!isClosed) {
        accounts?.forEach(acc => {
          dailySales += masterPayments.get(`${dayStr}_${acc.id}`)?.amount || 0;
        });
      }

      let dailyBills = 0;
      const dayGST = isClosed ? 0 : Math.round(dailySales / 21);
      dailyBills += dayGST;

      staff?.forEach(s => {
        const manual = masterAccruals.get(`${dayStr}_${s.id}`);
        if (manual !== undefined) {
          dailyBills += manual;
        } else if (dayStr < today) {
          const isEmployed = (!s.joiningDate || dayStr >= s.joiningDate) && (!s.lastWorkingDate || dayStr <= s.lastWorkingDate);
          if (isEmployed) dailyBills += Math.round((s.monthlySalary || 0) / 30);
        }
      });

      parties?.forEach(p => {
        const manual = masterAccruals.get(`${dayStr}_${p.id}`);
        if (manual !== undefined) {
          dailyBills += manual;
        } else if (!isClosed && dayStr < today && (p.monthlyAmount || 0) > 0) {
          dailyBills += Math.round((p.monthlyAmount || 0) / 30);
        }
      });

      return { 
        name: format(day, 'd'), 
        fullDate: dayStr,
        sales: dailySales, 
        bills: dailyBills 
      };
    });
  }, [masterPayments, masterAccruals, monthRange, accounts, staff, parties, today, dayStatusMap]);

  const cashflowChartData = useMemo(() => {
    if (!monthRange) return [];
    const days = eachDayOfInterval({ start: monthRange.start, end: monthRange.end });
    // Build account type map for T+1 settlement logic
    const accountTypeMap: Record<string, string> = {};
    accounts?.forEach(a => { accountTypeMap[a.id] = a.type; });

    return days.map(day => {
      const dayStr = format(day, 'yyyy-MM-dd');
      
      let settledIn = 0;
      Array.from(masterPayments.values()).forEach(p => {
        // Non-Cash (Bank/Online) payment-in settles T+1 at 03:30
        const accType = accountTypeMap[p.salesAccountId] || 'Cash';
        const { date: settlementDate } = getSettlementDate(p.paymentDate, accType);
        if (settlementDate === dayStr) {
          settledIn += (Number(p.amount) || 0);
        }
      });

      let payoutsOut = 0;
      expenses?.filter(e => !e.isAccrual && e.paymentDate === dayStr).forEach(e => {
        payoutsOut += (Number(e.amount) || 0);
      });

      return { 
        name: format(day, 'd'), 
        fullDate: dayStr,
        in: settledIn, 
        out: payoutsOut 
      };
    });
  }, [masterPayments, expenses, monthRange]);

  const monthStats = useMemo(() => {
    let sales = 0, bills = 0, inflow = 0, outflow = 0;
    plChartData.forEach(d => { sales += d.sales; bills += d.bills; });
    cashflowChartData.forEach(d => { inflow += d.in; outflow += d.out; });
    return { sales, bills, in: inflow, out: outflow };
  }, [plChartData, cashflowChartData]);

  const getExpectedAccountBalance = (accountId: string, monthStr: string) => {
    let baselineMonthStr = "";
    let baselineAmount = 0;
    const accBalances = (monthlyBalances || [])
      .filter((mb: any) => mb.accountId === accountId && mb.entityType !== 'party' && mb.monthStr < monthStr)
      .sort((a: any, b: any) => b.monthStr.localeCompare(a.monthStr));
    const acc = accounts?.find(a => a.id === accountId);
    
    if (accBalances.length > 0) {
      baselineMonthStr = accBalances[0].monthStr;
      baselineAmount = accBalances[0].actualOpeningBalance;
    } else {
      if (!acc || !acc.openingBalanceDate || acc.openingBalanceDate >= `${monthStr}-01`) return 0;
      baselineAmount = Number(acc.balance) || 0;
    }

    const startCalcDate = baselineMonthStr ? `${baselineMonthStr}-01` : (acc?.openingBalanceDate || '2000-01-01');
    const endCalcDate = format(subDays(parseISO(`${monthStr}-01`), 1), 'yyyy-MM-dd');
    if (startCalcDate > endCalcDate) return baselineAmount;

    const settledPayments = payments?.filter(p => p.salesAccountId === accountId && p.paymentDate >= startCalcDate && p.paymentDate <= endCalcDate) || [];
    const accountExpenses = expenses?.filter(e => e.accountId === accountId && !e.isAccrual && e.paymentDate >= startCalcDate && e.paymentDate <= endCalcDate) || [];
    const transfersIn = transfers?.filter((t: any) => t.toAccountId === accountId && t.date >= startCalcDate && t.date <= endCalcDate) || [];
    const transfersOut = transfers?.filter((t: any) => t.fromAccountId === accountId && t.date >= startCalcDate && t.date <= endCalcDate) || [];

    const totalRevenue = settledPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const totalExpenses = accountExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const totalTransfersIn = transfersIn.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const totalTransfersOut = transfersOut.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    return baselineAmount + totalRevenue - totalExpenses + totalTransfersIn - totalTransfersOut;
  };

  const getExpectedPartyBalance = (partyId: string, monthStr: string) => {
    let baselineMonthStr = "";
    let baselineAmount = 0;
    const partyBalances = (monthlyBalances || [])
      .filter((mb: any) => mb.accountId === partyId && mb.entityType === 'party' && mb.monthStr < monthStr)
      .sort((a: any, b: any) => b.monthStr.localeCompare(a.monthStr));
    const party = parties?.find(p => p.id === partyId);
    
    if (partyBalances.length > 0) {
      baselineMonthStr = partyBalances[0].monthStr;
      baselineAmount = partyBalances[0].actualOpeningBalance;
    } else {
      if (!party || !party.openingBalanceDate || party.openingBalanceDate >= `${monthStr}-01`) return 0;
      baselineAmount = Number(party.openingBalance) || 0;
      if (party.balanceType === 'Receivable') baselineAmount = -baselineAmount; // We treat positive as Payable/Liability internally here
    }

    const startCalcDate = baselineMonthStr ? `${baselineMonthStr}-01` : (party?.openingBalanceDate || '2000-01-01');
    const endCalcDate = format(subDays(parseISO(`${monthStr}-01`), 1), 'yyyy-MM-dd');
    if (startCalcDate > endCalcDate) return baselineAmount;

    const partyAccruals = expenses?.filter(e => e.partyId === partyId && e.isAccrual && e.invoiceDate && e.invoiceDate >= startCalcDate && e.invoiceDate <= endCalcDate) || [];
    const partyPayouts = expenses?.filter(e => e.partyId === partyId && !e.isAccrual && e.paymentDate >= startCalcDate && e.paymentDate <= endCalcDate) || [];

    const totalAccruals = partyAccruals.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const totalPayouts = partyPayouts.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    return baselineAmount + totalAccruals - totalPayouts;
  };

  const handleUpdateMonthlyBalance = (idVal: string, val: string, type: 'account' | 'party') => {
    if (!restaurant) return;
    const amount = parseFloat(val);
    const dbId = `${idVal}_${reconcileMonth}`;
    if (isNaN(amount) || val === '') {
      deleteDocumentNonBlocking(doc(db, 'restaurants', restaurant.id, 'monthlyBalances', dbId));
      return;
    }
    setDocumentNonBlocking(doc(db, 'restaurants', restaurant.id, 'monthlyBalances', dbId), {
      id: dbId,
      restaurantId: restaurant.id,
      accountId: idVal,
      entityType: type,
      monthStr: reconcileMonth,
      actualOpeningBalance: amount,
      restaurantMembers: restaurant.members
    }, { merge: true });
  };

  const handleChartClick = (data: any) => {
    if (data && data.fullDate) {
      router.push(`/reports?date=${data.fullDate}`);
    }
  };

  if (!restaurant) return null;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-white border shadow-sm h-12 px-1">
          <TabsTrigger value="overview" className="gap-2 font-black text-xs h-10 data-[state=active]:bg-primary data-[state=active]:text-white">
            <LayoutDashboard className="size-4" /> Overview
          </TabsTrigger>
          <TabsTrigger value="reconciliation" className="gap-2 font-black text-xs h-10 data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
            <History className="size-4" /> Month-End Checking
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-8 animate-in fade-in duration-500">
          <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
            <Card className="border-l-4 border-l-primary shadow-sm"><CardHeader className="pb-2"><CardTitle className="text-[10px] font-bold uppercase text-muted-foreground">Monthly Sales</CardTitle></CardHeader><CardContent><div className="text-lg md:text-xl lg:text-2xl font-bold">₹{monthStats.sales.toLocaleString('en-IN')}</div></CardContent></Card>
            <Card className="border-l-4 border-l-destructive shadow-sm"><CardHeader className="pb-2"><CardTitle className="text-[10px] font-bold uppercase text-muted-foreground">Monthly Bills</CardTitle></CardHeader><CardContent><div className="text-lg md:text-xl lg:text-2xl font-bold">₹{monthStats.bills.toLocaleString('en-IN')}</div></CardContent></Card>
            <Card className="border-l-4 border-l-accent shadow-sm bg-accent/5"><CardHeader className="pb-2"><CardTitle className="text-[10px] font-bold uppercase text-muted-foreground">Settled In</CardTitle></CardHeader><CardContent><div className="text-lg md:text-xl lg:text-2xl font-bold text-accent">₹{monthStats.in.toLocaleString('en-IN')}</div></CardContent></Card>
            <Card className="border-l-4 border-l-orange-500 shadow-sm"><CardHeader className="pb-2"><CardTitle className="text-[10px] font-bold uppercase text-muted-foreground">Payouts Out</CardTitle></CardHeader><CardContent><div className="text-lg md:text-xl lg:text-2xl font-bold text-orange-600">₹{monthStats.out.toLocaleString('en-IN')}</div></CardContent></Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
        <Card className="shadow-md border-none bg-card/50 overflow-visible">
          <CardHeader className="pb-4 border-b">
            <div className="flex items-center justify-between">
              <div><CardTitle className="text-lg">Daily Performance (P&L)</CardTitle><p className="text-xs text-muted-foreground">Earned Sales vs Accrued Costs (Rent, Salaries, Bills)</p></div>
              <div className="flex gap-4">
                <div className="flex items-center gap-1.5"><div className="size-2 rounded-full bg-primary" /><span className="text-[9px] font-bold text-muted-foreground uppercase">Sales</span></div>
                <div className="flex items-center gap-1.5"><div className="size-2 rounded-full bg-destructive" /><span className="text-[9px] font-bold text-muted-foreground uppercase">Bills</span></div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="w-full">
              <div className="min-w-[800px] h-[300px] p-6">
                <ChartContainer className="h-full w-full" config={{ sales: { label: "Sales", color: "hsl(var(--primary))" }, bills: { label: "Bills", color: "hsl(var(--destructive))" } }}>
                  <BarChart data={plChartData} margin={{ top: 10, right: 40, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted)/0.5)" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} fontSize={10} />
                    <YAxis axisLine={false} tickLine={false} fontSize={10} tickFormatter={(v) => `₹${v >= 1000 ? v/1000 + 'k' : v}`} />
                    <ChartTooltip 
                      allowEscapeViewBox={{ x: true, y: true }}
                      content={<ChartTooltipContent indicator="dot" />} 
                    />
                    <Bar 
                      dataKey="sales" 
                      fill="var(--color-sales)" 
                      radius={[2, 2, 0, 0]} 
                      onClick={handleChartClick}
                      className="cursor-pointer hover:opacity-80 transition-opacity"
                    />
                    <Bar 
                      dataKey="bills" 
                      fill="var(--color-bills)" 
                      radius={[2, 2, 0, 0]} 
                      onClick={handleChartClick}
                      className="cursor-pointer hover:opacity-80 transition-opacity"
                    />
                  </BarChart>
                </ChartContainer>
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="shadow-md border-none bg-card/50 overflow-visible">
          <CardHeader className="pb-4 border-b">
            <div className="flex items-center justify-between">
              <div><CardTitle className="text-lg">Daily Cashflow Health</CardTitle><p className="text-xs text-muted-foreground">Actual Bank/Cash Settlements vs Payouts</p></div>
              <div className="flex gap-4">
                <div className="flex items-center gap-1.5"><div className="size-2 rounded-full bg-accent" /><span className="text-[9px] font-bold text-muted-foreground uppercase">Inflow</span></div>
                <div className="flex items-center gap-1.5"><div className="size-2 rounded-full bg-orange-500" /><span className="text-[9px] font-bold text-muted-foreground uppercase">Outflow</span></div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="w-full">
              <div className="min-w-[800px] h-[300px] p-6">
                <ChartContainer className="h-full w-full" config={{ in: { label: "Inflow", color: "hsl(var(--accent))" }, out: { label: "Outflow", color: "orange" } }}>
                  <BarChart data={cashflowChartData} margin={{ top: 10, right: 40, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted)/0.5)" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} fontSize={10} />
                    <YAxis axisLine={false} tickLine={false} fontSize={10} tickFormatter={(v) => `₹${v >= 1000 ? v/1000 + 'k' : v}`} />
                    <ChartTooltip 
                      allowEscapeViewBox={{ x: true, y: true }}
                      content={<ChartTooltipContent indicator="dot" />} 
                    />
                    <Bar 
                      dataKey="in" 
                      fill="var(--color-in)" 
                      radius={[2, 2, 0, 0]} 
                      onClick={handleChartClick}
                      className="cursor-pointer hover:opacity-80 transition-opacity"
                    />
                    <Bar 
                      dataKey="out" 
                      fill="var(--color-out)" 
                      radius={[2, 2, 0, 0]} 
                      onClick={handleChartClick}
                      className="cursor-pointer hover:opacity-80 transition-opacity"
                    />
                  </BarChart>
                </ChartContainer>
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </CardContent>
        </Card>
          </div>
        </TabsContent>

        <TabsContent value="reconciliation" className="space-y-8 animate-in fade-in duration-500 pb-12">
          <Card className="border-none shadow-xl overflow-hidden bg-white/80">
            <div className="bg-emerald-600/10 px-6 py-4 border-b flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <History className="size-5 text-emerald-600" />
                  Month-End Financial Position
                </CardTitle>
                <p className="text-xs text-muted-foreground font-medium">Select a month and enter the physical balance for each account to track untracked money.</p>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-[10px] uppercase font-bold tracking-widest text-emerald-700 bg-emerald-100 px-2 py-1 rounded-md">Reconcile Month</Label>
                <Input type="month" value={reconcileMonth} onChange={(e) => setReconcileMonth(e.target.value)} className="h-9 w-[150px] font-black bg-white shadow-sm" />
              </div>
            </div>

            {/* Instruction Banner */}
            <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 flex items-start gap-3">
              <span className="text-amber-600 text-lg leading-none">💡</span>
              <div>
                <p className="text-xs font-black text-amber-800 uppercase tracking-wider">How to use</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  For each account/vendor below, type the <strong>physically confirmed balance</strong> in the blue input box and press Tab or click away to save. 
                  When you have data from previous months, the system auto-calculates the expected balance.
                  <strong> For first-time use</strong>: just enter your physical count to start tracking.
                </p>
              </div>
            </div>

            {/* Accounts Table */}
            <div className="bg-muted/30 px-6 py-2 border-b">
              <h3 className="text-sm font-black text-foreground uppercase tracking-wider">1. Cash & Bank Accounts</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-0 text-sm">
                <thead className="bg-white">
                  <tr>
                    <th className="px-6 py-3 text-left font-black text-[10px] uppercase text-muted-foreground border-b border-r">Account</th>
                    <th className="px-6 py-3 text-right font-black text-[10px] uppercase text-emerald-700 border-b border-r">Expected Opening</th>
                    <th className="px-6 py-3 text-right font-black text-[10px] uppercase text-primary border-b border-r">Actual Confirmed</th>
                    <th className="px-6 py-3 text-right font-black text-[10px] uppercase text-muted-foreground border-b">Untracked Leakage</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts?.map((acc, idx) => {
                    const expected = getExpectedAccountBalance(acc.id, reconcileMonth);
                    const recordedDoc = monthlyBalances?.find((mb: any) => mb.accountId === acc.id && mb.entityType !== 'party' && mb.monthStr === reconcileMonth);
                    const actual = recordedDoc ? recordedDoc.actualOpeningBalance : expected;
                    const diff = actual - expected;
                    const isRecorded = !!recordedDoc;
                    return (
                      <tr key={acc.id} className={idx % 2 === 0 ? "bg-white" : "bg-muted/10 hover:bg-muted/20"}>
                        <td className="px-6 py-3 border-b border-r font-bold">{acc.name}</td>
                        <td className="px-6 py-3 border-b border-r text-right font-medium text-emerald-700/80">₹{expected.toLocaleString('en-IN')}</td>
                        <td className="px-6 py-2 border-b border-r text-right">
                          <Input type="number" className={`h-9 w-[160px] ml-auto text-right text-sm font-black transition-all border-2 ${isRecorded ? 'bg-emerald-50 border-emerald-400 text-emerald-900' : 'border-primary/40 bg-primary/5 placeholder:text-muted-foreground/60'}`} value={recordedDoc ? recordedDoc.actualOpeningBalance : ""} placeholder="Enter balance" onChange={(e) => handleUpdateMonthlyBalance(acc.id, e.target.value, 'account')} onWheel={(e) => e.currentTarget.blur()} />
                        </td>
                        <td className="px-6 py-3 border-b text-right font-black">
                          {diff === 0 ? <span className="text-muted-foreground/30">—</span> : diff > 0 ? <span className="text-emerald-600">+₹{diff.toLocaleString('en-IN')}</span> : <span className="text-destructive">-₹{Math.abs(diff).toLocaleString('en-IN')}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Vendor/Parties Table */}
            <div className="bg-muted/30 px-6 py-2 border-b border-t mt-4">
              <h3 className="text-sm font-black text-foreground uppercase tracking-wider">2. Pending Vendors & Expenses (Payables)</h3>
              <p className="text-[10px] text-muted-foreground uppercase opacity-70">Positive = We Owe Them. Negative = Advance Given.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-0 text-sm">
                <thead className="bg-white">
                  <tr>
                    <th className="px-6 py-3 text-left font-black text-[10px] uppercase text-muted-foreground border-b border-r">Vendor Name</th>
                    <th className="px-6 py-3 text-right font-black text-[10px] uppercase text-destructive border-b border-r">Expected Pending</th>
                    <th className="px-6 py-3 text-right font-black text-[10px] uppercase text-primary border-b border-r">Actual Confirmed</th>
                    <th className="px-6 py-3 text-right font-black text-[10px] uppercase text-muted-foreground border-b">Adjustment Needed</th>
                  </tr>
                </thead>
                <tbody>
                  {parties?.map((party, idx) => {
                    const expected = getExpectedPartyBalance(party.id, reconcileMonth);
                    const recordedDoc = monthlyBalances?.find((mb: any) => mb.accountId === party.id && mb.entityType === 'party' && mb.monthStr === reconcileMonth);
                    const actual = recordedDoc ? recordedDoc.actualOpeningBalance : expected;
                    const diff = actual - expected;
                    const isRecorded = !!recordedDoc;
                    return (
                      <tr key={party.id} className={idx % 2 === 0 ? "bg-white" : "bg-muted/10 hover:bg-muted/20"}>
                        <td className="px-6 py-3 border-b border-r font-bold">{party.name}</td>
                        <td className="px-6 py-3 border-b border-r text-right font-medium text-destructive/80">₹{expected.toLocaleString('en-IN')}</td>
                        <td className="px-6 py-2 border-b border-r text-right">
                          <Input type="number" className={`h-9 w-[160px] ml-auto text-right text-sm font-black transition-all border-2 ${isRecorded ? 'bg-orange-50 border-orange-400 text-orange-900' : 'border-orange-300 bg-orange-50/50 placeholder:text-muted-foreground/60'}`} value={recordedDoc ? recordedDoc.actualOpeningBalance : ""} placeholder="Enter pending amount" onChange={(e) => handleUpdateMonthlyBalance(party.id, e.target.value, 'party')} onWheel={(e) => e.currentTarget.blur()} />
                        </td>
                        <td className="px-6 py-3 border-b text-right font-black">
                          {diff === 0 ? <span className="text-muted-foreground/30">—</span> : diff > 0 ? <span className="text-destructive">+₹{diff.toLocaleString('en-IN')} (More Dept)</span> : <span className="text-emerald-600">-₹{Math.abs(diff).toLocaleString('en-IN')} (Less Debt)</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Combined Total Summary */}
            <div className="bg-slate-900 text-white p-6 mt-8">
              <h3 className="text-lg font-black uppercase tracking-widest mb-4 flex items-center gap-2 text-slate-300">Net Business Position <span className="text-[10px] bg-slate-800 px-2 py-1 rounded font-normal text-slate-400">Total Cash - Total Debt</span></h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {(() => {
                  const totalExpectedAcc = accounts?.reduce((s, a) => s + getExpectedAccountBalance(a.id, reconcileMonth), 0) || 0;
                  const totalExpectedParty = parties?.reduce((s, a) => s + getExpectedPartyBalance(a.id, reconcileMonth), 0) || 0;
                  const expectedNet = totalExpectedAcc - totalExpectedParty;

                  const totalActualAcc = accounts?.reduce((s, a) => {
                    const doc = monthlyBalances?.find((mb: any) => mb.accountId === a.id && mb.entityType !== 'party' && mb.monthStr === reconcileMonth);
                    return s + (doc ? doc.actualOpeningBalance : getExpectedAccountBalance(a.id, reconcileMonth));
                  }, 0) || 0;
                  
                  const totalActualParty = parties?.reduce((s, a) => {
                    const doc = monthlyBalances?.find((mb: any) => mb.accountId === a.id && mb.entityType === 'party' && mb.monthStr === reconcileMonth);
                    return s + (doc ? doc.actualOpeningBalance : getExpectedPartyBalance(a.id, reconcileMonth));
                  }, 0) || 0;
                  
                  const actualNet = totalActualAcc - totalActualParty;
                  const netDiff = actualNet - expectedNet;

                  return (
                    <>
                      <div className="bg-slate-800 p-4 rounded-xl">
                        <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Expected Asset Position</p>
                        <p className="text-2xl font-black">₹{expectedNet.toLocaleString('en-IN')}</p>
                      </div>
                      <div className="bg-emerald-900/50 p-4 rounded-xl border border-emerald-800">
                        <p className="text-[10px] text-emerald-400 font-bold uppercase mb-1">Confirmed Asset Position</p>
                        <p className="text-2xl font-black text-emerald-400">₹{actualNet.toLocaleString('en-IN')}</p>
                      </div>
                      <div className="bg-slate-800 p-4 rounded-xl md:col-span-2 flex flex-col justify-center">
                        <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Overall Untracked Balance</p>
                        <p className="text-xl font-black">
                          {netDiff === 0 ? <span className="text-slate-500">Perfectly Balanced</span> : 
                           netDiff > 0 ? <span className="text-emerald-400">+₹{netDiff.toLocaleString('en-IN')} Surplus</span> : 
                           <span className="text-destructive">-₹{Math.abs(netDiff).toLocaleString('en-IN')} Leakage</span>}
                        </p>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
