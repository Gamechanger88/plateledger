"use client"

import { useState, useMemo, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useDateContext } from "@/contexts/date-context"
import Image from "next/image"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Wallet, Banknote, Landmark, History, Loader2, Calendar as CalendarIcon, TrendingUp, TrendingDown, ArrowLeftRight, Pencil, Trash2, MessageSquare, X, ChevronLeft, ChevronRight, ArrowRight, Info, Upload, CheckCircle2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { useActiveRestaurant } from "@/hooks/use-active-restaurant"
import { useCollection, useMemoFirebase, useFirestore } from "@/firebase"
import { collection, doc } from "firebase/firestore"
import { setDocumentNonBlocking, deleteDocumentNonBlocking } from "@/firebase/non-blocking-updates"
import { SalesAccount, SalePayment, Expense, Transfer } from "@/lib/types"
import { format, addDays, parseISO, subDays } from "date-fns"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

interface BulkTransferRow {
  id: string;
  amount: string;
  date: string;
  description: string;
}

export default function AccountsPage() {
  const router = useRouter()
  const { restaurant, isLoading: isRestLoading, userId } = useActiveRestaurant()
  const db = useFirestore()
  
  const [showAdd, setShowAdd] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)
  const [editingAccount, setEditingAccount] = useState<SalesAccount | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)

  const { startDate: summaryStartDate, endDate: summaryEndDate } = useDateContext()

  // Bulk Transfer State
  const [fromAccountId, setFromAccountId] = useState("")
  const [toAccountId, setToAccountId] = useState("")
  const [transferRows, setTransferRows] = useState<BulkTransferRow[]>([
    { id: '1', amount: '', date: format(new Date(), 'yyyy-MM-dd'), description: '' }
  ])

  const accountsRef = useMemoFirebase(() => 
    restaurant ? collection(db, 'restaurants', restaurant.id, 'salesAccounts') : null
  , [db, restaurant?.id]);

  const paymentsRef = useMemoFirebase(() => 
    restaurant ? collection(db, 'restaurants', restaurant.id, 'salePayments') : null
  , [db, restaurant?.id]);

  const expensesRef = useMemoFirebase(() => 
    restaurant ? collection(db, 'restaurants', restaurant.id, 'expenses') : null
  , [db, restaurant?.id]);

  const transfersRef = useMemoFirebase(() => 
    restaurant ? collection(db, 'restaurants', restaurant.id, 'transfers') : null
  , [db, restaurant?.id]);

  const { data: accounts, isLoading: isAccountsLoading } = useCollection<SalesAccount>(accountsRef);
  const { data: payments } = useCollection<SalePayment>(paymentsRef);
  const { data: expenses } = useCollection<Expense>(expensesRef);
  const { data: transfers } = useCollection<Transfer>(transfersRef);

  useEffect(() => {
    if (editingAccount) {
      setLogoPreview(editingAccount.logoUrl || null);
    } else {
      setLogoPreview(null);
    }
  }, [editingAccount]);

  const accountsWithLiveBalance = useMemo(() => {
    if (!accounts) return [];
    const now = new Date();
    const todayStr = format(now, 'yyyy-MM-dd');
    const nowTimeStr = format(now, 'HH:mm');

    return accounts.map(acc => {
      const startBalance = (acc.openingBalanceDate && acc.openingBalanceDate <= todayStr) 
        ? (Number(acc.balance) || 0) 
        : 0;

      // Only count revenue that has actually been settled
      const settledPayments = payments?.filter(p => {
        if (p.salesAccountId !== acc.id) return false;
        if (p.paymentDate < todayStr) return true;
        if (p.paymentDate === todayStr && (p.paymentTime || '00:00') <= nowTimeStr) return true;
        return false;
      }) || [];

      // CRITICAL FIX: Only count ACTUAL PAYOUTS, ignore ACCRUALS (Bills)
      const accountExpenses = expenses?.filter(e => {
        if (e.accountId !== acc.id) return false;
        if (e.isAccrual) return false; // EXCLUDE UNPAID BILLS FROM BALANCE
        if (e.paymentDate < todayStr) return true;
        if (e.paymentDate === todayStr && (e.paymentTime || '00:00') <= nowTimeStr) return true;
        return false;
      }) || [];

      const transfersIn = transfers?.filter(t => t.toAccountId === acc.id && t.date <= todayStr) || [];
      const transfersOut = transfers?.filter(t => t.fromAccountId === acc.id && t.date <= todayStr) || [];
      
      const totalRevenue = settledPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
      const totalExpenses = accountExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
      const totalTransfersIn = transfersIn.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
      const totalTransfersOut = transfersOut.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
      
      return {
        ...acc,
        liveBalance: startBalance + totalRevenue - totalExpenses + totalTransfersIn - totalTransfersOut,
        totalRevenue,
        totalExpenses,
        startBalance
      };
    });
  }, [accounts, payments, expenses, transfers]);

  const netFlows = useMemo(() => {
    if (!transfers || !accounts) return [];
    
    const flows = new Map<string, number>();

    transfers.forEach(t => {
      if (t.date >= summaryStartDate && t.date <= summaryEndDate) {
        const key = `${t.fromAccountId}-${t.toAccountId}`;
        flows.set(key, (flows.get(key) || 0) + (Number(t.amount) || 0));
      }
    });

    const result: { from: string; to: string; amount: number }[] = [];
    const processedPairs = new Set<string>();

    accounts.forEach(acc1 => {
      accounts.forEach(acc2 => {
        if (acc1.id === acc2.id) return;
        
        const pairKey = [acc1.id, acc2.id].sort().join('-');
        if (processedPairs.has(pairKey)) return;
        processedPairs.add(pairKey);

        const aToB = flows.get(`${acc1.id}-${acc2.id}`) || 0;
        const bToA = flows.get(`${acc2.id}-${acc1.id}`) || 0;
        const net = aToB - bToA;

        if (net > 0) {
          result.push({ from: acc1.name, to: acc2.name, amount: net });
        } else if (net < 0) {
          result.push({ from: acc2.name, to: acc1.name, amount: Math.abs(net) });
        }
      });
    });

    return result.sort((a, b) => b.amount - a.amount);
  }, [transfers, accounts, summaryStartDate, summaryEndDate]);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 100 * 1024) {
        alert("Logo size must be less than 100KB. Use a small PNG/JPG.");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setLogoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveAccount = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!restaurant || !userId || !accountsRef) return;

    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const type = formData.get('type') as any;
    const balance = parseFloat(formData.get('balance') as string) || 0;
    const openingBalanceDate = formData.get('openingDate') as string;

    setIsSubmitting(true);
    const accountId = editingAccount ? editingAccount.id : doc(accountsRef).id;
    
    setDocumentNonBlocking(doc(accountsRef, accountId), {
      id: accountId,
      restaurantId: restaurant.id,
      name,
      type,
      balance,
      openingBalanceDate,
      logoUrl: logoPreview || "",
      restaurantMembers: restaurant.members
    }, { merge: true });

    setIsSubmitting(false);
    setShowAdd(false);
    setEditingAccount(null);
    setLogoPreview(null);
  };

  const handleAddTransferRow = () => {
    const lastRow = transferRows[transferRows.length - 1];
    const newDate = lastRow ? lastRow.date : format(new Date(), 'yyyy-MM-dd');
    setTransferRows([
      ...transferRows,
      { id: Date.now().toString(), amount: '', date: newDate, description: '' }
    ])
  }

  const handleRemoveTransferRow = (id: string) => {
    if (transferRows.length <= 1) return;
    setTransferRows(transferRows.filter(row => row.id !== id))
  }

  const handleUpdateRow = (id: string, field: keyof BulkTransferRow, value: string) => {
    setTransferRows(transferRows.map(row => 
      row.id === id ? { ...row, [field]: value } : row
    ))
  }

  const handleStepDate = (id: string, days: number) => {
    setTransferRows(transferRows.map(row => {
      if (row.id === id) {
        try {
          const currentDate = parseISO(row.date);
          const newDate = addDays(currentDate, days);
          return { ...row, date: format(newDate, 'yyyy-MM-dd') };
        } catch (e) {
          return row;
        }
      }
      return row;
    }))
  }

  const handleBulkTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!restaurant || !transfersRef || !fromAccountId || !toAccountId) return;
    if (fromAccountId === toAccountId) return;

    setIsSubmitting(true);
    
    transferRows.forEach(row => {
      const amount = parseFloat(row.amount);
      if (isNaN(amount) || amount <= 0) return;

      const transferId = doc(transfersRef).id;
      setDocumentNonBlocking(doc(transfersRef, transferId), {
        id: transferId,
        restaurantId: restaurant.id,
        fromAccountId: fromAccountId,
        toAccountId: toAccountId,
        amount,
        date: row.date,
        time: format(new Date(), 'HH:mm'),
        description: `Internal Transfer`,
        remark: row.description || '', // Save user note to remark field
        restaurantMembers: restaurant.members
      }, { merge: true });
    });

    setIsSubmitting(false);
    setShowTransfer(false);
    setTransferRows([{ id: '1', amount: '', date: format(new Date(), 'yyyy-MM-dd'), description: '' }]);
    setFromAccountId("");
    setToAccountId("");
  };

  const handleDeleteAccount = (id: string) => {
    if (!accountsRef || !confirm("Delete this account? This will also remove its history from balances.")) return;
    deleteDocumentNonBlocking(doc(accountsRef, id));
  };

  if (isRestLoading || isAccountsLoading) {
    return <div className="flex h-[80vh] items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>
  }

  if (!restaurant) return null;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowTransfer(true)} className="gap-2 font-bold border-primary text-primary hover:bg-primary/5 shadow-sm">
            <ArrowLeftRight className="size-4" />
            Bulk Transfer
          </Button>
          <Button onClick={() => { setEditingAccount(null); setShowAdd(true); }} className="gap-2 font-bold shadow-md">
            <Plus className="size-4" />
            Add Account
          </Button>
        </div>
      </div>

      <Dialog open={showAdd} onOpenChange={(open) => { setShowAdd(open); if(!open) setEditingAccount(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingAccount ? 'Edit Account' : 'Register New Account'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveAccount} className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Account Logo</Label>
              <div className="flex items-center gap-4">
                {logoPreview ? (
                  <div className="relative size-16 rounded-lg overflow-hidden border bg-muted">
                    <Image src={logoPreview} alt="Logo Preview" fill className="object-contain p-1" />
                    <Button 
                      type="button" 
                      variant="destructive" 
                      size="icon" 
                      className="absolute -top-1 -right-1 size-5 rounded-full"
                      onClick={() => setLogoPreview(null)}
                    >
                      <X className="size-3" />
                    </Button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center size-16 border-2 border-dashed rounded-lg cursor-pointer bg-muted/30 hover:bg-muted/50 transition-colors">
                    <Upload className="size-5 text-muted-foreground" />
                    <input type="file" className="hidden" accept="image/*" onChange={handleLogoChange} />
                  </label>
                )}
                <div className="flex-1">
                  <p className="text-[10px] text-muted-foreground font-medium">Upload Bank Logo or Cash Icon (Max 100KB)</p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Account Name</Label>
              <Input id="name" name="name" defaultValue={editingAccount?.name} placeholder="e.g. Axis Main Bank" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="type">Account Type</Label>
              <Select name="type" defaultValue={editingAccount?.type || "Bank Account"}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Cash">Cash Account (Drawer)</SelectItem>
                  <SelectItem value="Online Payment Gateway">Online Gateway</SelectItem>
                  <SelectItem value="Bank Account">Bank Account</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="balance">Opening Balance (₹)</Label>
                <Input type="number" name="balance" className="font-bold" defaultValue={editingAccount?.balance} placeholder="0.00" onWheel={(e) => e.currentTarget.blur()} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="openingDate">As Of Date</Label>
                <Input type="date" name="openingDate" defaultValue={editingAccount?.openingBalanceDate || format(new Date(), 'yyyy-MM-dd')} required />
              </div>
            </div>
            <DialogFooter className="pt-4">
              <Button variant="outline" type="button" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button type="submit" className="font-bold" disabled={isSubmitting}>
                {editingAccount ? 'Update Account' : 'Create Account'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>


      <Dialog open={showTransfer} onOpenChange={setShowTransfer}>
        <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Bulk Internal Transfer</DialogTitle>
            <CardDescription>Select accounts and add multiple amounts to record transfers in bulk.</CardDescription>
          </DialogHeader>
          <form onSubmit={handleBulkTransfer} className="space-y-6 py-4 flex-1 flex flex-col overflow-hidden">
            <div className="grid grid-cols-2 gap-8 p-4 bg-muted/20 rounded-xl shrink-0">
              <div className="space-y-2">
                <Label className="font-bold">Source Account (From)</Label>
                <Select value={fromAccountId} onValueChange={setFromAccountId} required>
                  <SelectTrigger className="h-12 text-lg font-bold">
                    <SelectValue placeholder="Select Source" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts?.map(acc => (
                      <SelectItem key={acc.id} value={acc.id}>
                        <div className="flex items-center gap-2">
                          {acc.logoUrl ? <Image src={acc.logoUrl} alt="" width={16} height={16} className="object-contain" /> : null}
                          {acc.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="font-bold">Target Account (To)</Label>
                <Select value={toAccountId} onValueChange={setToAccountId} required>
                  <SelectTrigger className="h-12 text-lg font-bold">
                    <SelectValue placeholder="Select Target" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts?.map(acc => (
                      <SelectItem key={acc.id} value={acc.id}>
                        <div className="flex items-center gap-2">
                          {acc.logoUrl ? <Image src={acc.logoUrl} alt="" width={16} height={16} className="object-contain" /> : null}
                          {acc.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <ScrollArea className="flex-1 max-h-[400px] min-h-[150px] pr-4">
              <div className="space-y-3 pb-4">
                {transferRows.map((row) => (
                  <div key={row.id} className="grid grid-cols-[120px_180px_1fr_40px] gap-3 items-end animate-in fade-in slide-in-from-top-1">
                    <div className="space-y-1.5">
                      <Label className="text-[10px] uppercase font-bold text-muted-foreground">Amount (₹)</Label>
                      <Input 
                        type="number" 
                        value={row.amount}
                        onChange={(e) => handleUpdateRow(row.id, 'amount', e.target.value)}
                        onWheel={(e) => e.currentTarget.blur()}
                        placeholder="0.00" 
                        className="font-bold h-9" 
                        required 
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[10px] uppercase font-bold text-muted-foreground">Date</Label>
                      <div className="flex items-center gap-1">
                        <Button 
                          type="button" 
                          variant="ghost" 
                          size="icon" 
                          className="h-9 w-6 shrink-0 text-muted-foreground hover:text-primary"
                          onClick={() => handleStepDate(row.id, -1)}
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </Button>
                        <Input 
                          type="date" 
                          value={row.date}
                          onChange={(e) => handleUpdateRow(row.id, 'date', e.target.value)}
                          className="h-9 text-xs px-1" 
                          required 
                        />
                        <Button 
                          type="button" 
                          variant="ghost" 
                          size="icon" 
                          className="h-9 w-6 shrink-0 text-muted-foreground hover:text-primary"
                          onClick={() => handleStepDate(row.id, 1)}
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[10px] uppercase font-bold text-muted-foreground">Reason / Comment</Label>
                      <div className="relative">
                        <MessageSquare className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                        <Input 
                          value={row.description}
                          onChange={(e) => handleUpdateRow(row.id, 'description', e.target.value)}
                          className="pl-8 h-9 text-xs" 
                          placeholder="e.g. End of day cash deposit" 
                        />
                      </div>
                    </div>
                    <Button 
                      type="button" 
                      variant="ghost" 
                      size="icon" 
                      className="h-9 w-9 text-destructive hover:bg-destructive/10"
                      onClick={() => handleRemoveTransferRow(row.id)}
                      disabled={transferRows.length <= 1}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <div className="shrink-0 space-y-4">
              <Button 
                type="button" 
                variant="outline" 
                onClick={handleAddTransferRow}
                className="w-full border-dashed border-2 py-6 hover:bg-primary/5 hover:text-primary hover:border-primary/30"
              >
                <Plus className="size-4 mr-2" /> Add Another Entry
              </Button>

              <DialogFooter className="pt-4 border-t">
                <Button variant="outline" type="button" onClick={() => setShowTransfer(false)}>Cancel</Button>
                <Button type="submit" className="font-bold min-w-[150px]" disabled={isSubmitting || !fromAccountId || !toAccountId || fromAccountId === toAccountId}>
                  {isSubmitting ? <Loader2 className="animate-spin mr-2" /> : <ArrowLeftRight className="size-4 mr-2" />}
                  Confirm {transferRows.length} Transfer{transferRows.length > 1 ? 's' : ''}
                </Button>
              </DialogFooter>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <div className="grid gap-6 lg:grid-cols-2">
        {accountsWithLiveBalance.map((acc) => (
          <Card key={acc.id} className="hover:border-primary/50 transition-all shadow-md overflow-hidden bg-white/50 backdrop-blur-sm border-none">
            <div className={`h-1.5 w-full ${acc.type === 'Cash' ? 'bg-amber-500' : 'bg-blue-600'}`} />
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "p-4 rounded-2xl flex items-center justify-center size-16 shrink-0 overflow-hidden",
                    acc.type === 'Cash' ? 'bg-amber-100 text-amber-700' : 'bg-blue-50 text-blue-700'
                  )}>
                    {acc.logoUrl ? (
                      <Image src={acc.logoUrl} alt={acc.name} width={40} height={40} className="object-contain" />
                    ) : (
                      acc.type === 'Cash' ? <Banknote className="size-8" /> : <Landmark className="size-8" />
                    )}
                  </div>
                  <div>
                    <h3 className="font-bold text-xl tracking-tight">{acc.name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="secondary" className="text-[9px] font-black uppercase tracking-wider h-4">{acc.type}</Badge>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="size-6 text-muted-foreground hover:text-primary"
                        onClick={() => { setEditingAccount(acc); setShowAdd(true); }}
                      >
                        <Pencil className="size-3" />
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest mb-1">Settled Balance</p>
                  <p className={`text-3xl font-black tabular-nums ${acc.liveBalance >= 0 ? 'text-accent' : 'text-destructive'}`}>
                    ₹{(acc.liveBalance || 0).toLocaleString('en-IN')}
                  </p>
                </div>
              </div>
              
              <div className="mt-8 grid grid-cols-3 gap-4 border-t pt-6 bg-muted/10 -mx-6 px-6">
                <div>
                  <p className="text-[9px] font-bold text-muted-foreground uppercase mb-1">Opening</p>
                  <p className="text-sm font-bold opacity-80">₹{(acc.startBalance || 0).toLocaleString('en-IN')}</p>
                </div>
                <div className="cursor-pointer group/stat" onClick={() => router.push(`/reports?account=${acc.id}&type=Revenue`)}>
                  <p className="text-[9px] font-bold text-primary uppercase mb-1 flex items-center gap-1 group-hover/stat:underline">
                    <TrendingUp className="size-2" /> Settled Rev
                  </p>
                  <p className="text-sm font-bold text-primary">+₹{(acc.totalRevenue || 0).toLocaleString('en-IN')}</p>
                </div>
                <div className="cursor-pointer group/stat" onClick={() => router.push(`/reports?account=${acc.id}&type=Expense`)}>
                  <p className="text-[9px] font-bold text-destructive uppercase mb-1 flex items-center gap-1 group-hover/stat:underline">
                    <TrendingDown className="size-2" /> Payouts
                  </p>
                  <p className="text-sm font-bold text-destructive">-₹{(acc.totalExpenses || 0).toLocaleString('en-IN')}</p>
                </div>
              </div>
              
              <div className="flex gap-2 mt-6">
                <Button 
                  variant="outline" 
                  className="flex-1 gap-2 font-bold text-xs"
                  onClick={() => router.push(`/reports?account=${acc.id}`)}
                >
                  <History className="size-3.5" /> Ledger View
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon"
                  className="text-destructive hover:bg-destructive/10"
                  onClick={() => handleDeleteAccount(acc.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-12 border-none shadow-xl overflow-hidden bg-white/80">
        <div className="bg-primary/10 px-6 py-4 border-b flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <ArrowLeftRight className="size-5 text-primary" />
              Net Fund Flow Summary
            </CardTitle>
            <p className="text-xs text-muted-foreground font-medium">Net movement of money between accounts for the selected period.</p>
          </div>
        </div>
        <CardContent className="p-6">
          {netFlows.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {netFlows.map((flow, idx) => (
                <div key={idx} className="flex items-center justify-between p-4 bg-muted/20 rounded-xl border border-muted/30 hover:border-primary/30 transition-colors group">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-muted-foreground truncate max-w-[80px]">{flow.from}</span>
                      <ArrowRight className="size-3 text-primary group-hover:translate-x-1 transition-transform" />
                      <span className="text-xs font-black text-foreground truncate max-w-[80px]">{flow.to}</span>
                    </div>
                    <Badge variant="outline" className="w-fit text-[9px] h-4 font-bold border-muted-foreground/20">Net Flow</Badge>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-black text-primary tabular-nums">₹{flow.amount.toLocaleString('en-IN')}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center">
              <Info className="size-10 mx-auto text-muted-foreground/20 mb-3" />
              <p className="text-muted-foreground font-medium">No internal transfers recorded for this period.</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-1">Change dates or record a transfer above</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
