
"use client"

import { useState, useMemo, useEffect } from "react"
import { useDateContext } from "@/contexts/date-context"
import { useSearchParams, useRouter } from "next/navigation"
import Image from "next/image"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Loader2, Clock, Trash2, Link as LinkIcon, Info, Pencil, Wallet, ArrowRight, XCircle, MessageSquare, MonitorDot, ReceiptText, Calendar, Landmark } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useActiveRestaurant } from "@/hooks/use-active-restaurant"
import { useCollection, useMemoFirebase, useFirestore } from "@/firebase"
import { collection, getDocs, doc } from "firebase/firestore"
import { deleteDocumentNonBlocking, setDocumentNonBlocking } from "@/firebase/non-blocking-updates"
import { SalePayment, Expense, SalesAccount, Transfer } from "@/lib/types"
import { format, parseISO } from "date-fns"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { getSettlementDate } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"

function InlineRemark({ 
  initialValue, 
  onSave 
}: { 
  initialValue: string; 
  onSave: (val: string) => void 
}) {
  const [value, setValue] = useState(initialValue);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  if (isEditing) {
    return (
      <Input
        value={value}
        autoFocus
        className="h-8 text-[11px] font-black"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          setIsEditing(false);
          if (value !== initialValue) onSave(value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            setIsEditing(false);
            if (value !== initialValue) onSave(value);
          }
          if (e.key === 'Escape') {
            setIsEditing(false);
            setValue(initialValue);
          }
        }}
      />
    );
  }

  return (
    <div 
      className="text-[11px] text-muted-foreground font-black cursor-pointer hover:bg-muted/50 p-1.5 rounded min-h-[32px] flex items-center group transition-colors"
      onClick={(e) => {
        e.stopPropagation();
        setIsEditing(true);
      }}
    >
      {value ? (
        <span className="break-words line-clamp-2">{value}</span>
      ) : (
        <span className="opacity-0 group-hover:opacity-100 italic text-[9px] flex items-center gap-1">
          <MessageSquare className="size-2.5" /> Add Remark
        </span>
      )}
    </div>
  );
}

export default function ReportsPage() {
  const searchParams = useSearchParams()
  const { restaurant, userId } = useActiveRestaurant()
  const db = useFirestore()
  const { toast } = useToast()
  
  const [reportBasis, setReportBasis] = useState<"P&L" | "Cashflow">("Cashflow")
  const [activeTab, setActiveTab] = useState("transactions")
  
  const [activeAccountFilter, setActiveAccountFilter] = useState<string | null>(null)
  const [activeTypeFilter, setActiveTypeFilter] = useState<string | null>(null)

  const [editingTransaction, setEditingTransaction] = useState<any>(null)
  const [showEditDialog, setShowEditDialog] = useState(false)

  const { startDate: ctxStart, endDate: ctxEnd } = useDateContext()

  useEffect(() => {
    const acc = searchParams.get('account')
    const type = searchParams.get('type')
    if (acc) setActiveAccountFilter(acc)
    if (type) setActiveTypeFilter(type)
  }, [searchParams])

  const paymentsRef = useMemoFirebase(() => restaurant ? collection(db, 'restaurants', restaurant.id, 'salePayments') : null, [db, restaurant?.id]);
  const expensesRef = useMemoFirebase(() => restaurant ? collection(db, 'restaurants', restaurant.id, 'expenses') : null, [db, restaurant?.id]);
  const accountsRef = useMemoFirebase(() => restaurant ? collection(db, 'restaurants', restaurant.id, 'salesAccounts') : null, [db, restaurant?.id]);
  const transfersRef = useMemoFirebase(() => restaurant ? collection(db, 'restaurants', restaurant.id, 'transfers') : null, [db, restaurant?.id]);

  const { data: payments, isLoading: isPaymentsLoading } = useCollection<SalePayment>(paymentsRef);
  const { data: expenses, isLoading: isExpensesLoading } = useCollection<Expense>(expensesRef);
  const { data: accounts } = useCollection<SalesAccount>(accountsRef);
  const { data: transfers } = useCollection<Transfer>(transfersRef);

  const combinedData = useMemo(() => {
    if (!ctxStart || !ctxEnd) return [];

    // Build an accountType lookup map for quick reference
    const accountTypeMap: Record<string, string> = {};
    (accounts || []).forEach(a => { accountTypeMap[a.id] = a.type; });

    let p = (payments || []).map(pay => {
      let displayDate: string;
      let displayTime: string;

      if (reportBasis === "P&L") {
        // P&L always uses business date (accrual date)
        displayDate = (pay as any).businessDate || pay.paymentDate;
        displayTime = pay.paymentTime || '03:30';
      } else {
        // Cashflow: non-Cash accounts settle T+1 at 03:30
        const accType = accountTypeMap[pay.salesAccountId];
        const settlement = getSettlementDate(pay.paymentDate, accType);
        displayDate = settlement.date;
        displayTime = settlement.time;
      }

      return {
        ...pay,
        type: 'Revenue' as const,
        displayDate,
        displayTime,
        accountId: pay.salesAccountId,
        description: (pay as any).description || 'Daily Revenue',
        remark: (pay as any).remark || '',
        isLinked: pay.id.startsWith('daily_rev_') || !!(pay as any).businessDate,
        originalCollection: 'salePayments'
      };
    });
    
    let e = (expenses || [])
      .filter(exp => {
        if (reportBasis === "Cashflow") return !exp.isAccrual;
        return exp.isAccrual;
      })
      .map(exp => ({
        ...exp,
        type: 'Expense' as const,
        displayDate: reportBasis === "P&L" ? exp.invoiceDate : exp.paymentDate,
        displayTime: reportBasis === "P&L" ? exp.invoiceTime : exp.paymentTime,
        accountId: exp.accountId,
        description: exp.description,
        remark: (exp as any).remark || '',
        isLinked: exp.id.startsWith('staff_accrual_') || exp.id.startsWith('vendor_bill_') || !!exp.invoiceDate,
        originalCollection: 'expenses',
        isAccrual: exp.isAccrual,
        invoiceDate: exp.invoiceDate
      }));

    let t: any[] = [];
    if (reportBasis === "Cashflow" && transfers) {
      transfers.forEach(transfer => {
        const note = (transfer as any).remark || (transfer.description !== 'Internal Transfer' ? transfer.description : '');
        
        if (activeAccountFilter) {
          if (transfer.fromAccountId === activeAccountFilter) {
            t.push({
              ...transfer,
              type: 'Transfer' as const,
              displayDate: transfer.date,
              displayTime: transfer.time || '12:00',
              accountId: transfer.fromAccountId,
              description: `Transfer to ${accounts?.find(a => a.id === transfer.toAccountId)?.name}`,
              remark: note,
              isLinked: false,
              direction: 'out',
              originalCollection: 'transfers'
            });
          }
          if (transfer.toAccountId === activeAccountFilter) {
            t.push({
              ...transfer,
              type: 'Transfer' as const,
              displayDate: transfer.date,
              displayTime: transfer.time || '12:00',
              accountId: transfer.toAccountId,
              description: `Transfer from ${accounts?.find(a => a.id === transfer.fromAccountId)?.name}`,
              remark: note,
              isLinked: false,
              direction: 'in',
              originalCollection: 'transfers'
            });
          }
        } else {
          t.push({
            ...transfer,
            type: 'Transfer' as const,
            displayDate: transfer.date,
            displayTime: transfer.time || '12:00',
            accountId: null,
            description: `Transfer: ${accounts?.find(a => a.id === transfer.fromAccountId)?.name} → ${accounts?.find(a => a.id === transfer.toAccountId)?.name}`,
            remark: note,
            isLinked: false,
            direction: 'neutral',
            originalCollection: 'transfers'
          });
        }
      });
    }

    let combined = [...p, ...e, ...t];
    combined = combined.filter(item => (item.amount || 0) !== 0);
    combined = combined.filter(item => item.displayDate && item.displayDate >= ctxStart && item.displayDate <= ctxEnd);

    if (activeAccountFilter) combined = combined.filter(item => item.accountId === activeAccountFilter);
    if (activeTypeFilter) combined = combined.filter(item => item.type.includes(activeTypeFilter));

    return combined.sort((a, b) => (b.displayDate || "").localeCompare(a.displayDate || "") || (b.displayTime || "").localeCompare(a.displayTime || ""));
  }, [payments, expenses, transfers, reportBasis, activeAccountFilter, activeTypeFilter, ctxStart, ctxEnd, accounts]);

  const stats = useMemo(() => {
    const rev = combinedData.filter(t => t.type === 'Revenue' || (t.type === 'Transfer' && t.direction === 'in')).reduce((s, p) => s + (p.amount || 0), 0);
    const exp = combinedData.filter(t => t.type === 'Expense' || (t.type === 'Transfer' && t.direction === 'out')).reduce((s, e) => s + (e.amount || 0), 0);
    return { revenue: rev, expenses: exp, net: rev - exp };
  }, [combinedData]);

  const handleDeleteTransaction = (id: string, collectionName: string) => {
    if (!restaurant) return;
    deleteDocumentNonBlocking(doc(db, 'restaurants', restaurant.id, collectionName, id));
    toast({ title: "Transaction Deleted" });
  };

  const handleUpdateRemark = (id: string, collectionName: string, remark: string) => {
    if (!restaurant) return;
    setDocumentNonBlocking(doc(db, 'restaurants', restaurant.id, collectionName, id), { remark }, { merge: true });
  };

  const handleSaveEdit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!restaurant || !editingTransaction) return;

    const formData = new FormData(e.currentTarget);
    const amount = parseFloat(formData.get('amount') as string);
    const description = formData.get('description') as string;
    const remark = formData.get('remark') as string;
    const date = formData.get('date') as string;
    const time = formData.get('time') as string;

    const collectionName = editingTransaction.originalCollection;
    const docRef = doc(db, 'restaurants', restaurant.id, collectionName, editingTransaction.id);

    let updateData: any = { amount, description, remark };
    if (collectionName === 'salePayments') {
      updateData.paymentDate = date;
      updateData.paymentTime = time;
      updateData.salesAccountId = formData.get('accountId');
    } else if (collectionName === 'expenses') {
      if (editingTransaction.isAccrual) {
        updateData.invoiceDate = date;
        updateData.invoiceTime = time;
      } else {
        updateData.paymentDate = date;
        updateData.paymentTime = time;
        updateData.accountId = formData.get('accountId');
        updateData.invoiceDate = formData.get('invoiceDate');
      }
    } else if (collectionName === 'transfers') {
      updateData.date = date;
      updateData.time = time;
      updateData.fromAccountId = formData.get('fromAccountId');
      updateData.toAccountId = formData.get('toAccountId');
    }

    setDocumentNonBlocking(docRef, updateData, { merge: true });
    setShowEditDialog(false);
    setEditingTransaction(null);
    toast({ title: "Updated successfully" });
  };

  if (!restaurant) return null;

  return (
    <div className="space-y-8 pb-20">
      <div className="grid gap-6 md:grid-cols-3">
        <Card className="bg-primary/5 border-primary/20">
          <CardHeader className="pb-1"><CardTitle className="text-[10px] uppercase font-black text-primary">Ledger Revenue</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-black text-primary">₹{stats.revenue.toLocaleString('en-IN')}</div></CardContent>
        </Card>
        <Card className="bg-destructive/5 border-destructive/20">
          <CardHeader className="pb-1"><CardTitle className="text-[10px] uppercase font-black text-destructive">Ledger Expenses</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-black text-destructive">₹{stats.expenses.toLocaleString('en-IN')}</div></CardContent>
        </Card>
        <Card className="bg-accent/5 border-accent/20">
          <CardHeader className="pb-1"><CardTitle className="text-[10px] uppercase font-black text-accent">Net Balance</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-black text-accent">₹{stats.net.toLocaleString('en-IN')}</div></CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-white border shadow-sm h-12 px-1">
          <TabsTrigger value="transactions" className="gap-2 font-black text-xs h-10 data-[state=active]:bg-primary data-[state=active]:text-white">
            <Wallet className="size-4" /> Account Transactions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="transactions">
          <div className="flex justify-end mb-4">
            <Tabs value={reportBasis} onValueChange={(v) => setReportBasis(v as any)}>
              <TabsList className="bg-muted/50 border h-9">
                <TabsTrigger value="P&L" className="text-[10px] font-black uppercase h-7">Audit (P&L)</TabsTrigger>
                <TabsTrigger value="Cashflow" className="text-[10px] font-black uppercase h-7">Cash Flow</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <Card className="shadow-sm border-none overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead className="pl-6 w-[160px]">Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="min-w-[200px]">Remark</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="w-[100px] text-center pr-6">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {combinedData.map((t, idx) => {
                  const isPayout = t.type === 'Expense' && !t.isAccrual;
                  const linkedDate = isPayout && t.invoiceDate && t.invoiceDate !== t.paymentDate ? t.invoiceDate : null;
                  const acc = accounts?.find(a => a.id === t.accountId);
                  
                  return (
                    <TableRow key={`${t.id}-${idx}`} className="group">
                      <TableCell className="pl-6">
                        <div className="text-sm font-black">{t.displayDate ? format(parseISO(t.displayDate), 'dd MMM yy') : 'N/A'}</div>
                        <div className="text-[10px] opacity-60 flex items-center gap-1 font-bold"><Clock className="size-2.5" /> {t.displayTime}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={t.type === 'Revenue' ? 'default' : (t.type === 'Expense' ? 'destructive' : 'outline')} className="text-[9px] font-black uppercase">
                          {t.type} {t.direction === 'in' ? 'In' : (t.direction === 'out' ? 'Out' : '')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-2">
                            <div className="font-black text-sm">{t.description}</div>
                            {t.isLinked && <LinkIcon className="size-3 text-primary" />}
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-bold">
                              {acc?.logoUrl ? (
                                <Image src={acc.logoUrl} alt="" width={16} height={16} className="object-contain" />
                              ) : (
                                <Landmark className="size-3" />
                              )}
                              {acc?.name || 'Internal'}
                            </div>
                            {linkedDate && (
                              <Badge variant="outline" className="h-4 px-1.5 gap-1 text-[8px] border-primary/20 text-primary font-bold">
                                <Calendar className="size-2" /> Paid for {format(parseISO(linkedDate), 'dd MMM')} bill
                              </Badge>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell><InlineRemark initialValue={t.remark || ''} onSave={(val) => handleUpdateRemark(t.id, t.originalCollection, val)} /></TableCell>
                      <TableCell className={cn("text-right font-black", (t.type === 'Revenue' || t.direction === 'in') ? 'text-primary' : 'text-destructive')}>
                        {(t.direction === 'neutral') ? '' : (t.type === 'Revenue' || t.direction === 'in' ? '+' : '-')}₹{(t.amount || 0).toLocaleString('en-IN')}
                      </TableCell>
                      <TableCell className="text-center pr-6">
                        <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="icon" className="size-8" onClick={() => { setEditingTransaction(t); setShowEditDialog(true); }}><Pencil className="size-4" /></Button>
                          <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => handleDeleteTransaction(t.id, t.originalCollection)}><Trash2 className="size-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit {editingTransaction?.type}</DialogTitle></DialogHeader>
          <form onSubmit={handleSaveEdit} className="space-y-4 py-2">
            <div className="space-y-2"><Label>Description</Label><Input name="description" defaultValue={editingTransaction?.description} required /></div>
            <div className="space-y-2"><Label>Remark</Label><Input name="remark" defaultValue={editingTransaction?.remark} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Amount (₹)</Label><Input type="number" name="amount" defaultValue={editingTransaction?.amount} required /></div>
              <div className="space-y-2"><Label>Date</Label><Input type="date" name="date" defaultValue={editingTransaction?.displayDate} required /></div>
            </div>
            {editingTransaction?.type === 'Expense' && !editingTransaction?.isAccrual && (
              <div className="space-y-2">
                <Label>Linked Bill Date</Label>
                <Input type="date" name="invoiceDate" defaultValue={editingTransaction?.invoiceDate} />
                <p className="text-[10px] text-muted-foreground italic">Use this to track which day's bill this payment belongs to.</p>
              </div>
            )}
            <DialogFooter><Button type="submit">Save Changes</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
