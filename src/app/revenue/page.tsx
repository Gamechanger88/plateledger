
"use client"

import { useState, useMemo } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Banknote, Landmark, Loader2, Calendar as CalendarIcon, ChevronLeft, ChevronRight, Clock, MonitorDot, Info, MessageSquare, Lock, ArrowUpRight, CheckCircle2, Zap, History, ArrowRight, ArrowLeft, Menu, ReceiptText, Scale } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import { useActiveRestaurant } from "@/hooks/use-active-restaurant"
import { useCollection, useMemoFirebase, useFirestore } from "@/firebase"
import { collection, doc } from "firebase/firestore"
import { setDocumentNonBlocking, deleteDocumentNonBlocking } from "@/firebase/non-blocking-updates"
import { SalePayment, SalesAccount, SaleOrder, POSMethod } from "@/lib/types"
import { format, startOfMonth, endOfMonth, eachDayOfInterval, subMonths, addMonths, addDays, parseISO, isSameDay } from "date-fns"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useToast } from "@/hooks/use-toast"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"

export default function RevenuePage() {
  const router = useRouter()
  const { restaurant } = useActiveRestaurant()
  const db = useFirestore()
  const { toast } = useToast()
  
  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'))
  
  const [savingId, setSavingId] = useState<string | null>(null)
  const [settleAmounts, setSettleAmounts] = useState<Record<string, string>>({})

  const salesRef = useMemoFirebase(() => restaurant ? collection(db, 'restaurants', restaurant.id, 'salePayments') : null, [db, restaurant?.id]);
  const accountsRef = useMemoFirebase(() => restaurant ? collection(db, 'restaurants', restaurant.id, 'salesAccounts') : null, [db, restaurant?.id]);
  const ordersRef = useMemoFirebase(() => restaurant ? collection(db, 'restaurants', restaurant.id, 'orders') : null, [db, restaurant?.id]);
  const posMethodsRef = useMemoFirebase(() => restaurant ? collection(db, 'restaurants', restaurant.id, 'posMethods') : null, [db, restaurant?.id]);

  const { data: accounts } = useCollection<SalesAccount>(accountsRef);
  const { data: payments } = useCollection<SalePayment>(salesRef);
  const { data: orders } = useCollection<SaleOrder>(ordersRef);
  const { data: posMethods } = useCollection<POSMethod>(posMethodsRef);

  const daysInRange = useMemo(() => {
    try {
      return eachDayOfInterval({ start: parseISO(startDate), end: parseISO(endDate) });
    } catch (e) {
      return [];
    }
  }, [startDate, endDate]);

  const stagedSummaryMap = useMemo(() => {
    const map = new Map<string, { total: number; settled: number; remaining: number }>();
    orders?.filter(o => o.isActive !== false).forEach(o => {
      if (o.date && o.posMethodId) {
        const key = `${o.date}_${o.posMethodId}`;
        const current = map.get(key) || { total: 0, settled: 0, remaining: 0 };
        const sAmount = o.settledAmount || 0;
        const oTotal = o.total || 0;
        map.set(key, { total: current.total + oTotal, settled: current.settled + sAmount, remaining: Math.max(0, (current.total + oTotal) - (current.settled + sAmount)) });
      }
    });
    return map;
  }, [orders]);

  const handleSettlePOS = (businessDay: Date, method: POSMethod) => {
    if (!restaurant || !salesRef || !method.linkedAccountId || !orders) return;
    const ds = format(businessDay, 'yyyy-MM-dd');
    const key = `${ds}_${method.id}`;
    const staged = stagedSummaryMap.get(key);
    if (!staged || staged.remaining < 0.01) return;
    const inputValue = settleAmounts[key];
    const amountToSettle = (inputValue === "" || inputValue === undefined) ? staged.remaining : parseFloat(inputValue);
    if (isNaN(amountToSettle) || amountToSettle <= 0 || amountToSettle > (staged.remaining + 0.1)) {
      toast({ variant: "destructive", title: "Invalid Amount", description: `Max ₹${staged.remaining.toLocaleString()}` });
      return;
    }
    const linkedAcc = accounts?.find(a => a.id === method.linkedAccountId);
    const settlementId = doc(salesRef).id;
    setSavingId(key);
    const settleDate = linkedAcc?.type === 'Cash' ? businessDay : addDays(businessDay, 1);
    setDocumentNonBlocking(doc(salesRef, settlementId), { id: settlementId, restaurantId: restaurant.id, salesAccountId: method.linkedAccountId, amount: amountToSettle, paymentDate: format(settleDate, 'yyyy-MM-dd'), paymentTime: format(new Date(), 'HH:mm'), paymentMethod: method.name, description: `POS Settlement: ${method.name}`, restaurantMembers: restaurant.members, saleTransactionId: 'pos-staged-batch', businessDate: ds, remark: `Batch settlement` }, { merge: true });
    const dayOrders = orders.filter(o => o.isActive !== false && o.date === ds && o.posMethodId === method.id && (o.settledAmount || 0) < o.total).sort((a, b) => (a.time || '').localeCompare(b.time || '') || a.id.localeCompare(b.id));
    let pool = amountToSettle;
    dayOrders.forEach(o => {
      if (pool <= 0.01) return;
      const current = o.settledAmount || 0;
      const rem = o.total - current;
      let apply = pool >= (rem - 0.01) ? rem : pool;
      setDocumentNonBlocking(doc(db, 'restaurants', restaurant.id, 'orders', o.id), { settledAmount: current + apply, isSettled: (current + apply) >= (o.total - 0.01), accountId: method.linkedAccountId }, { merge: true });
      pool -= apply;
    });
    toast({ title: "Settlement Recorded" });
    setSettleAmounts(prev => ({ ...prev, [key]: "" }));
    setTimeout(() => setSavingId(null), 800);
  };

  const handleMonthShift = (months: number) => {
    const baseDate = parseISO(startDate);
    if (!isValid(baseDate)) return;
    const newBase = months > 0 ? addMonths(baseDate, months) : subMonths(baseDate, Math.abs(months));
    setStartDate(format(startOfMonth(newBase), 'yyyy-MM-dd'));
    setEndDate(format(endOfMonth(newBase), 'yyyy-MM-dd'));
  };

  if (!restaurant) return null;

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20 -m-2 md:-m-4 lg:-m-6 h-screen flex flex-col bg-[#f8f9fa] overflow-hidden">
      <header className="shrink-0 bg-white border-b px-4 md:px-8 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={() => router.push('/pos')} className="h-10 gap-2 border-primary text-primary font-black uppercase text-[10px] rounded-xl hover:bg-primary/5">
            <ArrowLeft className="size-4" /> Back to Billing
          </Button>
        </div>
        
        <div className="flex items-center gap-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-10 gap-2 border-primary text-primary font-black uppercase text-[10px] rounded-xl hover:bg-primary/5">
                <Menu className="size-4" />
                Console Menu
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 rounded-2xl p-2 shadow-2xl border-primary/10">
              <DropdownMenuLabel className="text-[9px] font-black uppercase text-muted-foreground tracking-widest px-2 py-1.5">Switch View</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => router.push('/pos')} className="rounded-xl h-11 cursor-pointer font-bold gap-3">
                <ReceiptText className="size-4" /> Billing Console
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push('/pos/bills')} className="rounded-xl h-11 cursor-pointer font-bold gap-3">
                <History className="size-4" /> Sequential Log
              </DropdownMenuItem>
              <DropdownMenuItem className="rounded-xl h-11 cursor-pointer font-bold gap-3 focus:bg-primary/10 focus:text-primary">
                <Scale className="size-4 text-primary" /> Settlement
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="flex items-center gap-2 bg-white p-2 rounded-xl border shadow-sm h-10">
            <div className="flex flex-col"><Label className="text-[8px] uppercase font-black text-muted-foreground mb-0.5">Period</Label>
              <div className="flex items-center gap-1">
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-7 text-[10px] w-[110px] font-black px-1 border-none shadow-none focus-visible:ring-0" />
                <span className="text-muted-foreground text-[10px] font-bold">to</span>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-7 text-[10px] w-[110px] font-black px-1 border-none shadow-none focus-visible:ring-0" />
              </div>
            </div>
            <div className="flex items-center border rounded-md overflow-hidden h-7">
               <Button variant="ghost" size="icon" onClick={() => handleMonthShift(-1)} className="h-6 w-6 rounded-none border-r"><ChevronLeft className="size-3" /></Button>
               <Button variant="ghost" size="icon" onClick={() => handleMonthShift(1)} className="h-6 w-6 rounded-none"><ChevronRight className="size-3" /></Button>
            </div>
          </div>
        </div>
      </header>

      <ScrollArea className="flex-1 px-4 md:px-8">
        <Tabs defaultValue="active" className="space-y-6 pt-4 pb-12">
          <TabsContent value="active" className="space-y-6">
            <div className="grid gap-6">
              {daysInRange.map((day) => {
                const ds = format(day, 'yyyy-MM-dd');
                const dayMethods = posMethods?.filter(m => { const staged = stagedSummaryMap.get(`${ds}_${m.id}`); return staged && (ds === format(new Date(), 'yyyy-MM-dd') || staged.remaining > 0.01); }) || [];
                if (dayMethods.length === 0) return null;
                return (
                  <Card key={ds} className="border-none shadow-md overflow-hidden rounded-2xl">
                    <div className="bg-muted/30 px-6 py-4 border-b flex items-center justify-between">
                      <div className="flex flex-col"><span className="text-lg font-black">{format(day, 'dd MMM yyyy')}</span><span className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">{format(day, 'EEEE')}</span></div>
                      <div className="text-right"><p className="text-[10px] uppercase font-black text-muted-foreground">Day's Sales</p><p className="text-xl font-black text-primary">₹{(posMethods?.reduce((sum, m) => sum + (stagedSummaryMap.get(`${ds}_${m.id}`)?.total || 0), 0) || 0).toLocaleString()}</p></div>
                    </div>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader className="bg-muted/10"><TableRow><TableHead className="pl-6 font-black text-[10px] uppercase">POS Method</TableHead><TableHead className="font-black text-[10px] uppercase text-center">Total</TableHead><TableHead className="font-black text-[10px] uppercase text-center">Remaining</TableHead><TableHead className="font-black text-[10px] uppercase">Ledger Account</TableHead><TableHead className="text-right pr-6 font-black text-[10px] uppercase">Settle (₹)</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {dayMethods.map((method) => {
                            const staged = stagedSummaryMap.get(`${ds}_${method.id}`) || { total: 0, settled: 0, remaining: 0 };
                            const linkedAcc = accounts?.find(a => a.id === method.linkedAccountId);
                            return (
                              <TableRow key={method.id}>
                                <TableCell className="pl-6 font-bold"><div className="flex items-center gap-3"><div className="size-10 shrink-0 flex items-center justify-center overflow-hidden rounded-xl bg-white border">{method.logoUrl ? <Image src={method.logoUrl} alt="" width={32} height={32} className="object-contain" /> : <MonitorDot className="size-5 text-muted-foreground" />}</div>{method.name}</div></TableCell>
                                <TableCell className="text-center font-bold text-slate-500">₹{staged.total.toLocaleString()}</TableCell>
                                <TableCell className={cn("text-center font-black", staged.remaining > 0.01 ? "text-amber-700" : "text-emerald-600 opacity-40")}>{staged.remaining > 0.01 ? `₹${staged.remaining.toLocaleString()}` : 'Balanced'}</TableCell>
                                <TableCell><div className="flex items-center gap-2 text-xs font-medium">{linkedAcc?.logoUrl ? <Image src={linkedAcc.logoUrl} alt="" width={24} height={24} className="object-contain" /> : <Landmark className="size-5 text-muted-foreground" />}{linkedAcc?.name || 'Not Linked'}</div></TableCell>
                                <TableCell className="text-right pr-6"><div className="flex items-center justify-end gap-2">{staged.remaining > 0.01 ? <><Input type="number" placeholder={String(staged.remaining)} className="w-32 h-9 text-right font-black text-sm rounded-xl" value={settleAmounts[`${ds}_${method.id}`] || ""} onChange={(e) => setSettleAmounts(prev => ({ ...prev, [`${ds}_${method.id}`]: e.target.value }))} /><Button size="sm" className="h-9 gap-2 font-bold bg-primary rounded-xl text-white min-w-[100px]" onClick={() => handleSettlePOS(day, method)} disabled={savingId === `${ds}_${method.id}`}>{savingId === `${ds}_${method.id}` ? <Loader2 className="size-3 animate-spin" /> : <Zap className="size-3" />}Settle</Button></> : <Badge variant="outline" className="gap-1.5 border-emerald-200 text-emerald-700 bg-emerald-50 h-9 px-4 rounded-xl"><CheckCircle2 className="size-3" /> Balanced</Badge>}</div></TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>
      </ScrollArea>
    </div>
  )
}
