
"use client"

import { useState, useMemo, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { 
  Loader2, 
  ChevronLeft, 
  Trash2, 
  ReceiptText, 
  Search, 
  Calendar as CalendarIcon,
  ChevronRight,
  MonitorDot,
  CheckCircle2,
  Clock,
  Pencil,
  Wallet,
  Zap,
  ArrowUpRight,
  UtensilsCrossed,
  History,
  ShieldAlert,
  AlertCircle,
  XCircle,
  ArrowLeft,
  Menu,
  Scale
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { setDocumentNonBlocking } from "@/firebase/non-blocking-updates"
import { SaleOrder, POSMethod } from "@/lib/types"
import { format, parseISO, startOfMonth, endOfMonth, subMonths, addMonths, isValid } from "date-fns"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"

export default function POSBillsPage() {
  const router = useRouter()
  const { restaurant } = useActiveRestaurant()
  const db = useFirestore()
  const { toast } = useToast()
  
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [search, setSearch] = useState("")
  const [viewMode, setViewMode] = useState<"bills" | "items">("bills")

  const ordersRef = useMemoFirebase(() => 
    restaurant ? collection(db, 'restaurants', restaurant.id, 'orders') : null
  , [db, restaurant?.id]);

  const posMethodsRef = useMemoFirebase(() => 
    restaurant ? collection(db, 'restaurants', restaurant.id, 'posMethods') : null
  , [db, restaurant?.id]);

  const { data: orders, isLoading: isOrdersLoading } = useCollection<SaleOrder>(ordersRef);
  const { data: methods } = useCollection<POSMethod>(posMethodsRef);

  const filteredOrdersWithGaps = useMemo(() => {
    if (!orders) return [];
    const searchLower = search.toLowerCase();

    const groupsByDate = new Map<string, SaleOrder[]>();
    orders.forEach(o => {
      const list = groupsByDate.get(o.date) || [];
      list.push(o);
      groupsByDate.set(o.date, list);
    });

    const result: any[] = [];
    const sortedDates = Array.from(groupsByDate.keys()).sort((a, b) => b.localeCompare(a));

    sortedDates.forEach(date => {
      if (date < startDate || date > endDate) return;
      const dayOrders = groupsByDate.get(date)!;
      const sequentialOrders = dayOrders.filter(o => (o.dailySrNo || 0) > 0);
      const legacyOrders = dayOrders.filter(o => !(o.dailySrNo || 0));
      const maxSr = Math.max(...sequentialOrders.map(o => o.dailySrNo || 0), 0);

      if (maxSr > 0) {
        for (let sr = maxSr; sr >= 1; sr--) {
          const srRecords = sequentialOrders.filter(o => o.dailySrNo === sr);
          if (srRecords.length > 0) {
            srRecords.sort((a, b) => (b.updatedAt || b.time || '').localeCompare(a.updatedAt || a.time || ''));
            srRecords.forEach(rec => {
              const matchesSearch = rec.billNumber.toLowerCase().includes(searchLower) || rec.items.some(i => i.name.toLowerCase().includes(searchLower)) || rec.total.toString().includes(search) || (rec.paymentMethod || '').toLowerCase().includes(searchLower);
              if (matchesSearch) result.push({ ...rec, displaySr: sr });
            });
          } else {
            const matchesSearch = "order not matured".includes(searchLower) || "unfulfilled".includes(searchLower);
            if (matchesSearch || search === "") {
              result.push({ id: `gap-${date}-${sr}`, date, dailySrNo: sr, displaySr: sr, isGap: true, billNumber: 'N/A', items: [], total: 0, status: 'abandoned', auditStatus: 'active' });
            }
          }
        }
      }
      legacyOrders.forEach(rec => {
        const matchesSearch = rec.billNumber.toLowerCase().includes(searchLower) || rec.items.some(i => i.name.toLowerCase().includes(searchLower)) || rec.total.toString().includes(search) || (rec.paymentMethod || '').toLowerCase().includes(searchLower);
        if (matchesSearch) result.push({ ...rec, displaySr: 'LEG' });
      });
    });

    return result.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      const srA = typeof a.displaySr === 'number' ? a.displaySr : 0;
      const srB = typeof b.displaySr === 'number' ? b.displaySr : 0;
      if (srA !== srB) return srB - srA;
      return (b.time || '').localeCompare(a.time || '');
    });
  }, [orders, startDate, endDate, search]);

  const stats = useMemo(() => {
    const activeOrders = (orders || []).filter(o => o.isActive !== false && o.date >= startDate && o.date <= endDate);
    const total = activeOrders.reduce((s, o) => s + (o.total || 0), 0);
    const completedCount = activeOrders.filter(o => o.status === 'completed').length;
    const pendingCount = activeOrders.filter(o => o.status === 'pending').length;
    const methodMap = new Map<string, { name: string; amount: number }>();
    activeOrders.forEach(o => {
      if (o.status === 'completed') {
        const methodName = methods?.find(m => m.id === o.posMethodId)?.name || o.paymentMethod || 'Unknown';
        const current = methodMap.get(methodName) || { name: methodName, amount: 0 };
        methodMap.set(methodName, { name: methodName, amount: current.amount + (o.total || 0) });
      }
    });
    return { total, completed: completedCount, pending: pendingCount, methodTotals: Array.from(methodMap.values()).sort((a, b) => b.amount - a.amount) };
  }, [orders, methods, startDate, endDate]);

  const handleDeleteOrder = (id: string) => {
    if (!restaurant) return;
    if (!confirm("Void this bill? It will be marked as deleted in audit trail.")) return;
    setDocumentNonBlocking(doc(db, 'restaurants', restaurant.id, 'orders', id), { isActive: false, auditStatus: 'deleted', updatedAt: format(new Date(), 'yyyy-MM-dd HH:mm:ss') }, { merge: true });
    toast({ title: "Order Voided" });
  };

  const handleMonthShift = (months: number) => {
    const baseDate = parseISO(startDate);
    if (!isValid(baseDate)) return;
    const newBase = months > 0 ? addMonths(baseDate, months) : subMonths(baseDate, Math.abs(months));
    setStartDate(format(startOfMonth(newBase), 'yyyy-MM-dd'));
    setEndDate(format(endOfMonth(newBase), 'yyyy-MM-dd'));
  };

  const getSettlementStatus = (o: any) => {
    if (o.isGap) return { label: 'Unfulfilled', class: 'bg-slate-100 text-slate-400 border-dashed border-slate-300' };
    if (o.isActive === false) return { label: o.auditStatus === 'deleted' ? 'Deleted' : 'Edited', class: 'bg-slate-200 text-slate-500 border-transparent italic' };
    const settled = o.settledAmount || 0;
    if (settled < 0.01) return { label: 'Staged', class: 'bg-muted text-muted-foreground border-transparent' };
    if (settled >= (o.total - 0.01)) return { label: 'Settled', class: 'bg-emerald-500 text-white border-transparent' };
    return { label: 'Partial', class: 'bg-amber-500 text-white border-transparent' };
  };

  if (!restaurant) return null;

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20 -m-2 md:-m-4 lg:-m-6 h-screen flex flex-col bg-[#f8f9fa] overflow-hidden">
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
              <DropdownMenuItem className="rounded-xl h-11 cursor-pointer font-bold gap-3 focus:bg-primary/10 focus:text-primary">
                <History className="size-4 text-primary" /> Sequential Log
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push('/revenue')} className="rounded-xl h-11 cursor-pointer font-bold gap-3">
                <Scale className="size-4" /> Settlement
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="flex items-center gap-2 bg-white p-2 rounded-xl border shadow-sm h-10">
            <div className="flex flex-col"><Label className="text-[8px] uppercase font-black text-muted-foreground mb-0.5">Audit Period</Label>
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
        <div className="space-y-6 pt-4 pb-12">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <Card className="bg-primary/5 border-primary/20 shadow-none py-3 px-4"><p className="text-[9px] font-black uppercase text-primary tracking-widest mb-1">Total Sales</p><div className="text-lg font-black text-primary">₹{stats.total.toLocaleString('en-IN')}</div></Card>
            <Card className="bg-emerald-50 border-emerald-100 shadow-none py-3 px-4"><p className="text-[9px] font-black uppercase text-emerald-700 tracking-widest mb-1">Fulfilled</p><div className="text-lg font-black text-emerald-700">{stats.completed}</div></Card>
            <Card className={cn("shadow-none py-3 px-4", stats.pending > 0 ? "bg-amber-50 border-amber-100" : "bg-muted/30 border-muted-foreground/10")}><p className={cn("text-[9px] font-black uppercase tracking-widest mb-1", stats.pending > 0 ? "text-amber-700" : "text-muted-foreground")}>Staged/Pending</p><div className={cn("text-lg font-black", stats.pending > 0 ? "text-amber-700" : "text-muted-foreground")}>{stats.pending}</div></Card>
            {stats.methodTotals.map((m) => (
              <Card key={m.name} className="bg-white border-slate-100 shadow-none py-3 px-4"><p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest mb-1 truncate">{m.name}</p><div className="text-lg font-black text-slate-900">₹{m.amount.toLocaleString('en-IN')}</div></Card>
            ))}
          </div>

          <Tabs value={viewMode} onValueChange={(v: any) => setViewMode(v)} className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-3 rounded-2xl border shadow-sm">
              <TabsList className="bg-muted/50 h-10 p-1 rounded-xl">
                <TabsTrigger value="bills" className="gap-2 font-bold text-xs rounded-lg"><History className="size-3.5" /> Sequential Audit</TabsTrigger>
                <TabsTrigger value="items" className="gap-2 font-bold text-xs rounded-lg"><UtensilsCrossed className="size-3.5" /> Item Summary</TabsTrigger>
              </TabsList>
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-2.5 size-3.5 text-muted-foreground" />
                <Input placeholder={viewMode === 'bills' ? "Search Sr #, Bill #, or Item..." : "Filter items..."} className="pl-9 h-9 text-xs rounded-xl" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>

            <TabsContent value="bills" className="mt-0">
              <Card className="shadow-sm border-none overflow-hidden rounded-2xl">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead className="pl-6 w-[80px] text-[10px] uppercase font-black text-center">Sr #</TableHead>
                      <TableHead className="w-[120px] text-[10px] uppercase font-black">Date & Time</TableHead>
                      <TableHead className="text-[10px] uppercase font-black">Bill # (Fulfillment)</TableHead>
                      <TableHead className="text-[10px] uppercase font-black">Method</TableHead>
                      <TableHead className="text-[10px] uppercase font-black min-w-[200px]">Menu Items</TableHead>
                      <TableHead className="text-right text-[10px] uppercase font-black">Total</TableHead>
                      <TableHead className="text-center text-[10px] uppercase font-black w-[100px]">Status</TableHead>
                      <TableHead className="w-[80px] pr-6"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOrdersWithGaps.map((o) => {
                      const status = getSettlementStatus(o);
                      const isVoided = o.isActive === false;
                      const isGap = o.isGap;
                      return (
                        <TableRow key={o.id} className={cn("group transition-colors", isVoided && "opacity-50 grayscale bg-muted/20", isGap && "bg-slate-50/50 border-dashed")}>
                          <TableCell className="pl-6 text-center font-black text-xs"><Badge variant="outline" className={cn("font-black h-5 border-slate-200", o.displaySr === 'LEG' && "text-muted-foreground")}>{o.displaySr === 'LEG' ? 'LEG' : `#${o.displaySr}`}</Badge></TableCell>
                          <TableCell><div className="text-xs font-black">{format(parseISO(o.date), 'dd MMM yy')}</div>{!isGap && <div className="text-[9px] opacity-60 flex items-center gap-1 font-bold"><Clock className="size-2" /> {o.time}</div>}</TableCell>
                          <TableCell><div className={cn("flex items-center gap-1.5 font-bold text-xs", isGap ? "text-slate-300" : "text-slate-900")}>{isGap ? <XCircle className="size-2.5" /> : <ReceiptText className="size-2.5 text-primary" />}{o.billNumber}</div></TableCell>
                          <TableCell>{!isGap && <Badge variant="secondary" className="text-[8px] font-black uppercase tracking-tight px-1.5 py-0">{methods?.find(m => m.id === o.posMethodId)?.name || o.paymentMethod}</Badge>}{isGap && <span className="text-[10px] text-slate-300 italic">Abandoned</span>}</TableCell>
                          <TableCell>{isGap ? <div className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-400 py-3"><AlertCircle className="size-3" /> Order not matured or fulfilled</div> : <div className="flex flex-col gap-1 py-2">{o.items.map((item: any, i: number) => (<div key={i} className="text-[10px] font-bold text-slate-700 whitespace-nowrap flex items-center gap-1.5"><span className="text-primary font-black">{item.quantity}x</span><span className="truncate max-w-[180px]">{item.name}</span></div>))}</div>}</TableCell>
                          <TableCell className="text-right font-black text-slate-900 text-xs">{isGap ? '-' : `₹${o.total.toLocaleString('en-IN')}`}</TableCell>
                          <TableCell className="text-center"><Badge variant="outline" className={cn("text-[8px] font-black uppercase px-2 h-5 tracking-widest", status.class)}>{status.label}</Badge></TableCell>
                          <TableCell className="text-right pr-6">{!isVoided && !isGap && (<div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity"><Button variant="ghost" size="icon" className="size-7" onClick={() => router.push(`/pos?edit=${o.id}`)}><Pencil className="size-3" /></Button><Button variant="ghost" size="icon" className="size-7 text-destructive" onClick={() => handleDeleteOrder(o.id)}><Trash2 className="size-3" /></Button></div>)}{isVoided && (<div className="flex justify-end"><ShieldAlert className="size-3.5 text-slate-400" /></div>)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </div>
  )
}
