
"use client"

import { useState, useMemo, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { User, Loader2, ArrowDownLeft, ArrowUpRight, Calculator, CheckCircle2, AlertCircle, Clock, History, ReceiptText } from "lucide-react"
import { useActiveRestaurant } from "@/hooks/use-active-restaurant"
import { useCollection, useMemoFirebase, useFirestore } from "@/firebase"
import { collection, query, where } from "firebase/firestore"
import { Expense, Party, Staff } from "@/lib/types"
import { format, parseISO } from "date-fns"
import { cn } from "@/lib/utils"

export default function EntityLedgerPage() {
  const searchParams = useSearchParams()
  const { restaurant, isLoading: isRestLoading } = useActiveRestaurant()
  const db = useFirestore()

  const [selectedId, setSelectedId] = useState<string>("")
  const [selectedType, setSelectedType] = useState<"staff" | "party">("staff")
  const [viewMode, setViewMode] = useState<"reconciliation" | "history">("reconciliation")

  const partiesRef = useMemoFirebase(() => 
    restaurant ? collection(db, 'restaurants', restaurant.id, 'parties') : null
  , [db, restaurant?.id]);

  const staffRef = useMemoFirebase(() => 
    restaurant ? collection(db, 'restaurants', restaurant.id, 'staff') : null
  , [db, restaurant?.id]);

  const expensesRef = useMemoFirebase(() => 
    restaurant ? collection(db, 'restaurants', restaurant.id, 'expenses') : null
  , [db, restaurant?.id]);

  const { data: parties } = useCollection<Party>(partiesRef);
  const { data: staff } = useCollection<Staff>(staffRef);

  const entityQuery = useMemoFirebase(() => {
    if (!expensesRef || !selectedId) return null;
    return query(expensesRef, where(selectedType === 'staff' ? 'staffId' : 'partyId', '==', selectedId));
  }, [expensesRef, selectedId, selectedType]);

  const { data: allTransactions, isLoading: isDataLoading } = useCollection<Expense>(entityQuery);

  useEffect(() => {
    const p = searchParams.get('party')
    const s = searchParams.get('staff')
    if (p) { setSelectedId(p); setSelectedType('party'); }
    else if (s) { setSelectedId(s); setSelectedType('staff'); }
  }, [searchParams])

  const reconciliationData = useMemo(() => {
    if (!allTransactions) return [];

    // Grouping by Invoice Date to track specific bill clearance
    const groups = new Map<string, { billed: number; paid: number; transactions: Expense[] }>();

    allTransactions.forEach(tx => {
      const dateKey = tx.invoiceDate || tx.paymentDate;
      if (!dateKey) return;

      const group = groups.get(dateKey) || { billed: 0, paid: 0, transactions: [] };
      
      if (tx.isAccrual) {
        group.billed += (Number(tx.amount) || 0);
       group.transactions.push(tx);
      } else {
        group.paid += (Number(tx.amount) || 0);
        // Note: Payouts are linked via the invoiceDate field set during transaction entry
        group.transactions.push(tx);
      }
      
      groups.set(dateKey, group);
    });

    return Array.from(groups.entries())
      .map(([date, data]) => ({
        date,
        ...data,
        balance: data.billed - data.paid,
        status: data.billed === 0 ? 'Payment Only' : 
                (data.paid >= data.billed ? 'Cleared' : 
                (data.paid > 0 ? 'Partial' : 'Pending'))
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [allTransactions]);

  const chronologicalLedger = useMemo(() => {
    if (!allTransactions) return [];
    
    const sorted = [...allTransactions].sort((a, b) => {
      const dateA = a.paymentDate || a.invoiceDate;
      const dateB = b.paymentDate || b.invoiceDate;
      if (dateA !== dateB) return b.localeCompare(a); // Latest first
      return (b.paymentTime || "").localeCompare(a.paymentTime || "");
    });

    return sorted;
  }, [allTransactions]);

  const stats = useMemo(() => {
    const totalAccrued = allTransactions?.filter(t => t.isAccrual).reduce((s, t) => s + (Number(t.amount) || 0), 0) || 0;
    const totalPaid = allTransactions?.filter(t => !t.isAccrual).reduce((s, t) => s + (Number(t.amount) || 0), 0) || 0;
    return { totalAccrued, totalPaid, balance: totalAccrued - totalPaid };
  }, [allTransactions]);

  if (isRestLoading) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
        </div>
        <div className="flex gap-2">
          <Select value={selectedType} onValueChange={(v: any) => { setSelectedType(v); setSelectedId(""); }}>
            <SelectTrigger className="w-[120px] h-10 font-bold bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="staff">Staff</SelectItem>
              <SelectItem value="party">Vendor</SelectItem>
            </SelectContent>
          </Select>
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger className="w-[240px] h-10 border-primary/20 font-bold bg-white">
              <SelectValue placeholder={`Select ${selectedType === 'staff' ? 'Staff' : 'Vendor'}`} />
            </SelectTrigger>
            <SelectContent>
              {selectedType === 'staff' 
                ? staff?.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)
                : parties?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)
              }
            </SelectContent>
          </Select>
        </div>
      </div>

      {!selectedId ? (
        <Card className="border-dashed border-2 py-24 text-center bg-muted/10">
          <User className="size-16 mx-auto text-muted-foreground/20 mb-4" />
          <p className="text-muted-foreground font-bold text-lg">Select an entity to audit records.</p>
          <p className="text-muted-foreground/60 text-sm mt-1">View bill-by-bill clearance and payment status.</p>
        </Card>
      ) : (
        <>
          <div className="grid gap-6 md:grid-cols-3">
            <Card className="bg-primary/5 border-primary/20 shadow-sm">
              <CardHeader className="pb-2"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-primary">Total Bills (Accrued)</CardTitle></CardHeader>
              <CardContent><div className="text-3xl font-black text-primary">₹{stats.totalAccrued.toLocaleString('en-IN')}</div></CardContent>
            </Card>
            <Card className="bg-destructive/5 border-destructive/20 shadow-sm">
              <CardHeader className="pb-2"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-destructive">Total Paid (Payouts)</CardTitle></CardHeader>
              <CardContent><div className="text-3xl font-black text-destructive">₹{stats.totalPaid.toLocaleString('en-IN')}</div></CardContent>
            </Card>
            <Card className={cn("border-2 shadow-md", stats.balance > 0 ? "bg-accent/5 border-accent/20" : "bg-primary/5 border-primary/20")}>
              <CardHeader className="pb-2">
                <CardTitle className={cn("text-[10px] font-black uppercase tracking-widest flex items-center gap-2", stats.balance > 0 ? "text-accent" : "text-primary")}>
                  {stats.balance > 0 ? <AlertCircle className="size-3" /> : <CheckCircle2 className="size-3" />}
                  Current Outstanding
                </CardTitle>
              </CardHeader>
              <CardContent><div className={cn("text-3xl font-black", stats.balance > 0 ? "text-accent" : "text-primary")}>₹{stats.balance.toLocaleString('en-IN')}</div></CardContent>
            </Card>
          </div>

          <Tabs value={viewMode} onValueChange={(v: any) => setViewMode(v)} className="space-y-6">
            <TabsList className="bg-white border shadow-sm p-1 h-12">
              <TabsTrigger value="reconciliation" className="gap-2 font-black text-xs h-10 px-6 data-[state=active]:bg-primary data-[state=active]:text-white">
                <ReceiptText className="size-4" /> Bill Clearance Logic
              </TabsTrigger>
              <TabsTrigger value="history" className="gap-2 font-black text-xs h-10 px-6 data-[state=active]:bg-primary data-[state=active]:text-white">
                <History className="size-4" /> Chronological History
              </TabsTrigger>
            </TabsList>

            <TabsContent value="reconciliation">
              <Card className="shadow-lg border-none overflow-hidden bg-white">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead className="pl-6 w-[180px] font-black text-[10px] uppercase">Invoice Date</TableHead>
                      <TableHead className="font-black text-[10px] uppercase">Status</TableHead>
                      <TableHead className="text-right font-black text-[10px] uppercase">Bill Amount</TableHead>
                      <TableHead className="text-right font-black text-[10px] uppercase">Paid Amount</TableHead>
                      <TableHead className="text-right pr-6 font-black text-[10px] uppercase">Invoice Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reconciliationData.map((row) => (
                      <TableRow key={row.date} className="hover:bg-muted/5 group transition-colors">
                        <TableCell className="pl-6 font-black text-sm">{format(parseISO(row.date), 'dd MMM yyyy')}</TableCell>
                        <TableCell>
                          <Badge 
                            variant={row.status === 'Cleared' ? 'default' : 'outline'} 
                            className={cn(
                              "text-[9px] font-black uppercase px-2 py-0.5",
                              row.status === 'Cleared' && "bg-primary text-white border-none",
                              row.status === 'Partial' && "border-accent text-accent bg-accent/5",
                              row.status === 'Pending' && "border-destructive text-destructive bg-destructive/5",
                              row.status === 'Payment Only' && "border-muted-foreground text-muted-foreground"
                            )}
                          >
                            {row.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-bold text-slate-600">
                          ₹{row.billed.toLocaleString('en-IN')}
                        </TableCell>
                        <TableCell className="text-right font-bold text-primary">
                          ₹{row.paid.toLocaleString('en-IN')}
                        </TableCell>
                        <TableCell className={cn("text-right pr-6 font-black text-lg", row.balance > 0 ? "text-accent" : "text-primary opacity-40")}>
                          ₹{row.balance.toLocaleString('en-IN')}
                        </TableCell>
                      </TableRow>
                    ))}
                    {reconciliationData.length === 0 && (
                      <TableRow><TableCell colSpan={5} className="h-48 text-center text-muted-foreground italic font-medium">No invoice data available for this entity.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </Card>
            </TabsContent>

            <TabsContent value="history">
              <Card className="shadow-lg border-none overflow-hidden bg-white">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead className="pl-6 w-[180px] font-black text-[10px] uppercase">Entry Date</TableHead>
                      <TableHead className="font-black text-[10px] uppercase">Type</TableHead>
                      <TableHead className="font-black text-[10px] uppercase">Description / Link</TableHead>
                      <TableHead className="text-right pr-6 font-black text-[10px] uppercase">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {chronologicalLedger.map((tx) => (
                      <TableRow key={tx.id} className="hover:bg-muted/5">
                        <TableCell className="pl-6">
                          <div className="font-black text-sm">{format(parseISO(tx.paymentDate || tx.invoiceDate), 'dd MMM yyyy')}</div>
                          <div className="text-[10px] text-muted-foreground flex items-center gap-1 font-bold">
                            <Clock className="size-2.5" /> {tx.paymentTime || '12:00'}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={tx.isAccrual ? "outline" : "destructive"} className={cn("text-[9px] font-black uppercase", tx.isAccrual ? "border-slate-300 text-slate-600" : "bg-destructive text-white border-none")}>
                            {tx.isAccrual ? 'Accrual / Bill' : 'Payout'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <div className="text-xs font-bold">{tx.description}</div>
                            {tx.remark && <div className="text-[10px] text-muted-foreground italic">"{tx.remark}"</div>}
                            {!tx.isAccrual && tx.invoiceDate && tx.invoiceDate !== tx.paymentDate && (
                              <div className="flex items-center gap-1.5 mt-1">
                                <Badge variant="outline" className="h-4 text-[8px] font-black text-primary border-primary/20 uppercase tracking-tighter">
                                  Linked to {format(parseISO(tx.invoiceDate), 'dd MMM')} Bill
                                </Badge>
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className={cn("text-right pr-6 font-black", tx.isAccrual ? "text-slate-900" : "text-destructive")}>
                          {tx.isAccrual ? '+' : '-'}₹{(Number(tx.amount) || 0).toLocaleString('en-IN')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}
