"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { useDateContext } from "@/contexts/date-context"
import Image from "next/image"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { 
  ArrowDownLeft, 
  ArrowUpRight, 
  Loader2, 
  Calendar,
  ChevronLeft,
  ChevronRight,
  User,
  Store,
  Banknote,
  Landmark,
  Wallet,
  Clock,
  Settings2,
  Check,
  AlertTriangle,
  ArrowRight,
  Percent,
  Plus,
  Trash2,
  MessageSquare,
  Link as LinkIcon,
  Info,
  Upload,
  Save,
  CheckCircle2,
  FileSpreadsheet,
  XCircle,
  LayoutList,
  LayoutGrid,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ShoppingCart,
  ChevronDown,
  Database,
} from "lucide-react"
import { exportToExcel } from "@/lib/export-excel"
import { processExcelImport, importPaymentIn, importPaymentOut, importPurchase, ImportJob } from "@/lib/import-excel"
import { processVyaparImport } from "@/lib/import-vyapar"
import { useActiveRestaurant } from "@/hooks/use-active-restaurant"
import { useCollection, useMemoFirebase, useFirestore } from "@/firebase"
import { collection, doc, getDocs, writeBatch, setDoc, serverTimestamp } from "firebase/firestore"
import { setDocumentNonBlocking, deleteDocumentNonBlocking } from "@/firebase/non-blocking-updates"
import { SalePayment, Expense, SalesAccount, Party, Staff, Transfer } from "@/lib/types"
import { format, eachDayOfInterval, addDays, subDays, parseISO } from "date-fns"
import { cn, getSettlementDate } from "@/lib/utils"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
import { useToast } from "@/hooks/use-toast"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"

export default function TransactionsPage() {
  const { restaurant } = useActiveRestaurant()
  const db = useFirestore()
  const { toast } = useToast()
  
  const [isImporting, setIsImporting] = useState(false)
  const [isPaymentInImporting, setIsPaymentInImporting] = useState(false)
  const [isPaymentOutImporting, setIsPaymentOutImporting] = useState(false)
  const [isPurchaseImporting, setIsPurchaseImporting] = useState(false)
  const [isVyaparImporting, setIsVyaparImporting] = useState(false)
  const [isDeletingAll, setIsDeletingAll] = useState(false)
  const [importProgress, setImportProgress] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const paymentInFileInputRef = useRef<HTMLInputElement>(null)
  const paymentOutFileInputRef = useRef<HTMLInputElement>(null)
  const purchaseFileInputRef = useRef<HTMLInputElement>(null)
  const vyaparFileInputRef = useRef<HTMLInputElement>(null)
  
  const [savingId, setSavingId] = useState<string | null>(null)
  const [stableGridColumns, setStableGridColumns] = useState<any[]>([])
  const [selectedPayoutAccountId, setSelectedPayoutAccountId] = useState<string>("")
  const [showJobsPanel, setShowJobsPanel] = useState(false)

  // List view state
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [listFilter, setListFilter] = useState<'all' | 'payment_in' | 'payment_out' | 'purchase' | 'sale'>('all')
  const [listSortDir, setListSortDir] = useState<'desc' | 'asc'>('desc')
  const [selectedTxAccountIds, setSelectedTxAccountIds] = useState<string[]>([])
  const [txAccountPickerOpen, setTxAccountPickerOpen] = useState(false)

  const { startDate, endDate, today } = useDateContext()

  const salesRef = useMemoFirebase(() => restaurant ? collection(db, 'restaurants', restaurant.id, 'salePayments') : null, [db, restaurant?.id]);
  const purchasesRef = useMemoFirebase(() => restaurant ? collection(db, 'restaurants', restaurant.id, 'expenses') : null, [db, restaurant?.id]);
  const accountsRef = useMemoFirebase(() => restaurant ? collection(db, 'restaurants', restaurant.id, 'salesAccounts') : null, [db, restaurant?.id]);
  const partiesRef = useMemoFirebase(() => restaurant ? collection(db, 'restaurants', restaurant.id, 'parties') : null, [db, restaurant?.id]);
  const staffRef = useMemoFirebase(() => restaurant ? collection(db, 'restaurants', restaurant.id, 'staff') : null, [db, restaurant?.id]);
  const transfersRef = useMemoFirebase(() => restaurant ? collection(db, 'restaurants', restaurant.id, 'transfers') : null, [db, restaurant?.id]);
  const importJobsRef = useMemoFirebase(() => restaurant ? collection(db, 'restaurants', restaurant.id, 'importJobs') : null, [db, restaurant?.id]);
  const dailyPhysicalsRef = useMemoFirebase(() => restaurant ? collection(db, 'restaurants', restaurant.id, 'dailyPhysicalBalances') : null, [db, restaurant?.id]);

  const { data: sales } = useCollection<SalePayment>(salesRef);
  const { data: purchases } = useCollection<Expense>(purchasesRef);
  const { data: accounts } = useCollection<SalesAccount>(accountsRef);
  const { data: parties } = useCollection<Party>(partiesRef);
  const { data: staff } = useCollection<Staff>(staffRef);
  const { data: transfers } = useCollection<Transfer>(transfersRef);
  const { data: importJobsRaw } = useCollection<ImportJob>(importJobsRef);
  const { data: dailyPhysicals } = useCollection<any>(dailyPhysicalsRef);

  // Sort jobs newest-first, show last 5
  const importJobs = useMemo(() => 
    (importJobsRaw || []).slice().sort((a: any, b: any) => {
      const ta = a.startedAt?.toMillis?.() || 0;
      const tb = b.startedAt?.toMillis?.() || 0;
      return tb - ta;
    }).slice(0, 5)
  , [importJobsRaw]);

  // A job is only "active" if it's running AND was started within the last 10 minutes.
  // This prevents a crashed/stuck job from permanently locking the import buttons.
  const activeJob = importJobs.find(j => {
    if (j.status !== 'running') return false;
    const startedMs = (j as any).startedAt?.toMillis?.() || 0;
    return startedMs > 0 && (Date.now() - startedMs) < 10 * 60 * 1000;
  });
  // Vyapar jobs track progress separately; exclude them from the generic Import button display
  const activeExcelJob = activeJob && !(activeJob.fileName || '').startsWith('[Vyapar]') ? activeJob : undefined;

  const daysInRange = useMemo(() => {
    if (!startDate || !endDate) return [];
    try {
      return eachDayOfInterval({ start: parseISO(startDate), end: parseISO(endDate) });
    } catch (e) {
      return [];
    }
  }, [startDate, endDate]);

  // Init account filter to all accounts; prune stale IDs if accounts change
  useEffect(() => {
    if (!accounts || accounts.length === 0) return
    if (selectedTxAccountIds.length === 0) {
      setSelectedTxAccountIds(accounts.map(a => a.id))
      return
    }
    const valid = selectedTxAccountIds.filter(id => accounts.some(a => a.id === id))
    if (valid.length !== selectedTxAccountIds.length) {
      setSelectedTxAccountIds(valid.length > 0 ? valid : accounts.map(a => a.id))
    }
  }, [accounts])

  const isSingleTxAccount = selectedTxAccountIds.length === 1
  const singleTxAccount = useMemo(() =>
    isSingleTxAccount ? accounts?.find(a => a.id === selectedTxAccountIds[0]) : undefined
  , [isSingleTxAccount, accounts, selectedTxAccountIds])

  useEffect(() => {
    if (accounts && !selectedPayoutAccountId) {
      const axisAcc = accounts.find(a => a.name.toLowerCase().includes('axis'));
      const bankAcc = accounts.find(a => a.type === 'Bank Account');
      const cashAcc = accounts.find(a => a.type === 'Cash');
      setSelectedPayoutAccountId(axisAcc?.id || bankAcc?.id || cashAcc?.id || accounts[0]?.id || "");
    }
  }, [accounts, selectedPayoutAccountId]);

  useEffect(() => {
    if (!accounts || !parties || !staff) return;
    
    const revCols = [
      ...accounts.filter(a => a.type === 'Cash').map(a => ({ type: 'revenue', id: a.id, name: a.name, accType: a.type, icon: Banknote, logoUrl: a.logoUrl })),
      ...accounts.filter(a => a.type !== 'Cash').map(a => ({ type: 'revenue', id: a.id, name: a.name, accType: a.type, icon: Landmark, logoUrl: a.logoUrl }))
    ];

    const gstCol = { type: 'gst', id: 'gst_payout', name: 'GST Payout', icon: Percent };

    const fixedVendorCols = (parties || [])
      .filter(p => p.mainCategory === 'Fixed Cost')
      .sort((a, b) => (b.monthlyAmount || 0) - (a.monthlyAmount || 0))
      .map(p => ({ 
        type: 'vendor', 
        id: p.id, 
        name: p.name, 
        icon: Store,
        mainCategory: p.mainCategory,
        subCategory: p.subCategory
      }));

    const staffCols = (staff || [])
      .sort((a, b) => (b.monthlySalary || 0) - (a.monthlySalary || 0))
      .map(s => ({ 
        type: 'staff', 
        id: s.id, 
        name: s.name, 
        icon: User,
        mainCategory: 'Fixed Cost',
        subCategory: 'Salary'
      }));

    const variableVendorCols = (parties || [])
      .filter(p => p.mainCategory !== 'Fixed Cost')
      .sort((a, b) => (b.monthlyAmount || 0) - (a.monthlyAmount || 0))
      .map(p => ({ 
        type: 'vendor', 
        id: p.id, 
        name: p.name, 
        icon: Store,
        mainCategory: p.mainCategory,
        subCategory: p.subCategory
      }));

    setStableGridColumns([...revCols, gstCol, ...fixedVendorCols, ...staffCols, ...variableVendorCols]);
  }, [accounts, parties, staff]);

  const salesBySettlement = useMemo(() => {
    const map = new Map<string, SalePayment[]>();
    sales?.forEach(s => {
      if (s.paymentDate && s.salesAccountId) {
        const key = `${s.paymentDate}_${s.salesAccountId}`;
        const existing = map.get(key) || [];
        map.set(key, [...existing, s]);
      }
    });
    return map;
  }, [sales]);

  const payoutsBySettlement = useMemo(() => {
    const map = new Map<string, Expense[]>();
    purchases?.filter(p => !p.isAccrual).forEach(p => {
      let key = "";
      if (p.partyId || p.staffId) {
        key = `${p.paymentDate}_${p.partyId || p.staffId}`;
      } else if (p.expenseCategoryId === 'Taxes') {
        key = `${p.paymentDate}_gst_payout`;
      }
      
      if (key) {
        const existing = map.get(key) || [];
        map.set(key, [...existing, p]);
      }
    });
    return map;
  }, [purchases]);

  const handleUpsertTransaction = (
    day: Date, 
    col: any, 
    transactionId: string | null, 
    data: { amount: number; time: string; remark: string; accountId: string; invoiceDate?: string }
  ) => {
    if (!restaurant || !salesRef || !purchasesRef || !today) return;
    const settle = format(day, 'yyyy-MM-dd');
    if (settle > today) return;

    const { amount, time, remark, accountId, invoiceDate } = data;
    const activeId = transactionId || (col.type === 'revenue' ? doc(salesRef).id : doc(purchasesRef).id);

    setSavingId(`${settle}_${col.id}`);

    if (col.type === 'revenue') {
      const existingRev = salesBySettlement.get(`${settle}_${col.id}`)?.find(s => s.id === activeId);
      const bizDate = existingRev?.businessDate || (col.accType === 'Cash' ? settle : format(subDays(day, 1), 'yyyy-MM-dd'));
      const defaultTime = col.accType === 'Cash' ? '23:00' : '03:30';

      setDocumentNonBlocking(doc(salesRef, activeId), {
        id: activeId,
        restaurantId: restaurant.id,
        salesAccountId: accountId || col.id, 
        amount,
        paymentDate: settle,
        paymentTime: time || defaultTime,
        paymentMethod: col.name,
        restaurantMembers: restaurant.members,
        businessDate: bizDate,
        description: `Daily ${col.name} Settlement`,
        remark
      }, { merge: true });
    } else {
      setDocumentNonBlocking(doc(purchasesRef, activeId), {
        id: activeId,
        restaurantId: restaurant.id,
        invoiceDate: invoiceDate || settle,
        paymentDate: settle,
        paymentTime: time || '12:00',
        amount,
        description: col.type === 'gst' ? 'GST Tax Payout' : `Payout to ${col.name}`,
        accountId: accountId,
        restaurantMembers: restaurant.members,
        partyId: col.type === 'vendor' ? col.id : null,
        staffId: col.type === 'staff' ? col.id : null,
        expenseCategoryId: col.type === 'staff' ? 'Salary' : (col.type === 'gst' ? 'Taxes' : 'General'),
        category: col.type === 'gst' ? 'General' : (col.mainCategory || 'Variable Cost'),
        subCategory: col.type === 'gst' ? 'Other' : (col.subCategory || 'Other'),
        isAccrual: false,
        remark
      }, { merge: true });
    }
    setTimeout(() => {
      setSavingId(null);
      toast({ title: "Transaction Saved" });
    }, 800);
  };

  const handleDeleteTransaction = (settleKey: string, collectionName: string, id: string) => {
    if (!restaurant) return;
    setSavingId(settleKey);
    deleteDocumentNonBlocking(doc(db, 'restaurants', restaurant.id, collectionName, id));
    setTimeout(() => setSavingId(null), 800);
  };

  const handleExportExcel = () => {
    if (!daysInRange.length) return;

    const data: any[] = [];
    
    daysInRange.forEach(day => {
      const dayStr = format(day, 'yyyy-MM-dd');
      
      stableGridColumns.forEach(col => {
        if (col.type === 'revenue') {
          const revs = salesBySettlement.get(`${dayStr}_${col.id}`) || [];
          revs.forEach(rev => {
            data.push({
              'Date': format(parseISO(dayStr), 'dd/MM/yyyy'),
              'Party Name': 'Revenue',
              'Transaction Type': 'Payment-in',
              'Ref No.': (rev.id || "").substring(0, 5).toUpperCase(),
              'Amount': rev.amount || 0,
              'Payment Type': accounts?.find(a => a.id === rev.salesAccountId)?.name || col.name,
              'Received Amount': rev.amount || 0
            });
          });
        } else {
          const payouts = payoutsBySettlement.get(`${dayStr}_${col.id}`) || [];
          payouts.forEach(payout => {
            data.push({
              'Date': format(parseISO(dayStr), 'dd/MM/yyyy'),
              'Party Name': col.name,
              'Transaction Type': 'Payment-out',
              'Ref No.': (payout.id || "").substring(0, 5).toUpperCase(),
              'Amount': payout.amount || 0,
              'Payment Type': accounts?.find(a => a.id === payout.accountId)?.name || 'Account',
              'Paid Amount': payout.amount || 0
            });
          });
        }
      });
    });

    if (data.length === 0) {
      toast({ title: "No data found", description: "There are no entries to export for this date range." });
      return;
    }

    exportToExcel(data, `Transactions_${format(parseISO(startDate), 'ddMMMyyyy')}_to_${format(parseISO(endDate), 'ddMMMyyyy')}`);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !restaurant || !db) return;
    
    // Create the importJob tracking document first
    const jobRef = doc(collection(db, 'restaurants', restaurant.id, 'importJobs'));
    await setDoc(jobRef, {
      id: jobRef.id,
      fileName: file.name,
      status: 'running',
      totalRows: 0,
      processedRows: 0,
      salesCount: 0,
      expenseCount: 0,
      startedAt: serverTimestamp(),
      restaurantMembers: restaurant.members,
    });

    setIsImporting(true);
    setShowJobsPanel(true);
    setImportProgress("Starting import...");

    try {
      await processExcelImport(
        file,
        restaurant.id,
        restaurant.members,
        db,
        jobRef,
        (msg) => setImportProgress(msg)
      );
      toast({ title: "Import Complete", description: "All rows processed successfully." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Import Failed", description: err.message || "Could not read file." });
    } finally {
      setIsImporting(false);
      setImportProgress("");
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePaymentInUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !restaurant || !db) return;

    const jobRef = doc(collection(db, 'restaurants', restaurant.id, 'importJobs'));
    await setDoc(jobRef, {
      id: jobRef.id,
      fileName: `[Payment In] ${file.name}`,
      status: 'running',
      totalRows: 0,
      processedRows: 0,
      salesCount: 0,
      expenseCount: 0,
      startedAt: serverTimestamp(),
      restaurantMembers: restaurant.members,
    });

    setIsPaymentInImporting(true);
    setShowJobsPanel(true);

    try {
      await importPaymentIn(
        file,
        restaurant.id,
        restaurant.members,
        db,
        jobRef,
        (msg) => setImportProgress(msg)
      );
      toast({ title: "Payment In Import Complete", description: "Sales imported with correct Cash/Bank settlement dates." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Import Failed", description: err.message || "Could not read file." });
    } finally {
      setIsPaymentInImporting(false);
      setImportProgress("");
      if (paymentInFileInputRef.current) paymentInFileInputRef.current.value = '';
    }
  };

  const handlePaymentOutUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !restaurant || !db) return;

    const jobRef = doc(collection(db, 'restaurants', restaurant.id, 'importJobs'));
    await setDoc(jobRef, {
      id: jobRef.id,
      fileName: `[Payment Out] ${file.name}`,
      status: 'running',
      totalRows: 0, processedRows: 0, salesCount: 0, expenseCount: 0,
      startedAt: serverTimestamp(),
      restaurantMembers: restaurant.members,
    });

    setIsPaymentOutImporting(true);
    setShowJobsPanel(true);

    try {
      await importPaymentOut(
        file, restaurant.id, restaurant.members, db, jobRef,
        (msg) => setImportProgress(msg)
      );
      toast({ title: "Payment Out Import Complete", description: "All payment-out entries imported." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Import Failed", description: err.message || "Could not read file." });
    } finally {
      setIsPaymentOutImporting(false);
      setImportProgress("");
      if (paymentOutFileInputRef.current) paymentOutFileInputRef.current.value = '';
    }
  };

  const handlePurchaseUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !restaurant || !db) return;

    const jobRef = doc(collection(db, 'restaurants', restaurant.id, 'importJobs'));
    await setDoc(jobRef, {
      id: jobRef.id,
      fileName: `[Purchase] ${file.name}`,
      status: 'running',
      totalRows: 0, processedRows: 0, salesCount: 0, expenseCount: 0,
      startedAt: serverTimestamp(),
      restaurantMembers: restaurant.members,
    });

    setIsPurchaseImporting(true);
    setShowJobsPanel(true);

    try {
      await importPurchase(
        file, restaurant.id, restaurant.members, db, jobRef,
        (msg) => setImportProgress(msg)
      );
      toast({ title: "Purchase Import Complete", description: "All purchase entries imported." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Import Failed", description: err.message || "Could not read file." });
    } finally {
      setIsPurchaseImporting(false);
      setImportProgress("");
      if (purchaseFileInputRef.current) purchaseFileInputRef.current.value = '';
    }
  };

  const handleVyaparUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !restaurant || !db) return;

    const jobRef = doc(collection(db, 'restaurants', restaurant.id, 'importJobs'));
    await setDoc(jobRef, {
      id: jobRef.id,
      fileName: `[Vyapar] ${file.name}`,
      status: 'running',
      totalRows: 0, processedRows: 0, salesCount: 0, expenseCount: 0, transferCount: 0,
      startedAt: serverTimestamp(),
      restaurantMembers: restaurant.members,
    });

    setIsVyaparImporting(true);
    setShowJobsPanel(true);

    try {
      await processVyaparImport(
        file, restaurant.id, restaurant.members, db, jobRef,
        (msg) => setImportProgress(msg)
      );
      toast({ title: "Vyapar Import Complete", description: "Sales, purchases and payment outs imported successfully." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Vyapar Import Failed", description: err.message || "Could not parse file." });
    } finally {
      setIsVyaparImporting(false);
      setImportProgress("");
      if (vyaparFileInputRef.current) vyaparFileInputRef.current.value = '';
    }
  };

  const handleDeleteTransactions = async (type: 'all' | 'payment_in' | 'payment_out' | 'purchase') => {
    if (!restaurant) return;
    
    const messages = {
      'all': "Are you ABSOLUTELY sure you want to delete ALL transactions (sales and expenses)? This action cannot be undone.",
      'payment_in': "Are you sure you want to delete ALL Payment In (Sales) transactions?",
      'payment_out': "Are you sure you want to delete ALL Payment Out transactions?",
      'purchase': "Are you sure you want to delete ALL Purchase transactions?"
    };

    if (!window.confirm(messages[type])) return;
    
    setIsDeletingAll(true);
    toast({ title: "Deleting Data...", description: "Removing selected transactions. Please wait." });
    
    try {
      let allDocs: any[] = [];
      const salesQuery = await getDocs(collection(db, 'restaurants', restaurant.id, 'salePayments'));
      const expensesQuery = await getDocs(collection(db, 'restaurants', restaurant.id, 'expenses'));
      
      if (type === 'all') {
        allDocs = [...salesQuery.docs, ...expensesQuery.docs];
      } else if (type === 'payment_in') {
        allDocs = [...salesQuery.docs];
      } else if (type === 'payment_out') {
        allDocs = expensesQuery.docs.filter(d => {
          const data = d.data();
          const isPurchase = data.subCategory === 'Purchase' || data.expenseCategoryId === 'Purchase' || (!!data.partyId && data.subCategory !== 'Payment Out');
          return !isPurchase && !data.isAccrual;
        });
      } else if (type === 'purchase') {
        allDocs = expensesQuery.docs.filter(d => {
          const data = d.data();
          const isPurchase = data.subCategory === 'Purchase' || data.expenseCategoryId === 'Purchase' || (!!data.partyId && data.subCategory !== 'Payment Out');
          return isPurchase && !data.isAccrual;
        });
      }
      
      for (let i = 0; i < allDocs.length; i += 400) {
        const chunk = allDocs.slice(i, i + 400);
        const chunkBatch = writeBatch(db);
        chunk.forEach(d => chunkBatch.delete(d.ref));
        await chunkBatch.commit();
      }
      
      toast({ title: "Success", description: `Successfully deleted ${allDocs.length} transactions.` });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message || "Failed to delete transactions." });
    } finally {
      setIsDeletingAll(false);
    }
  };

  const handleDeleteEverything = async () => {
    if (!restaurant) return;
    if (!window.confirm("Are you ABSOLUTELY sure you want to delete ALL data — transactions, accounts, parties, staff, transfers and import history? This cannot be undone.")) return;

    setIsDeletingAll(true);
    toast({ title: "Deleting All Data...", description: "Please wait." });

    try {
      const colNames = ['salePayments', 'expenses', 'salesAccounts', 'parties', 'staff', 'transfers', 'importJobs'];
      for (const colName of colNames) {
        const snap = await getDocs(collection(db, 'restaurants', restaurant.id, colName));
        for (let i = 0; i < snap.docs.length; i += 400) {
          const batch = writeBatch(db);
          snap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
      }
      toast({ title: "Done", description: "All data has been deleted." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message || "Failed to delete data." });
    } finally {
      setIsDeletingAll(false);
    }
  };

  const handleMigratePurchases = async () => {
    if (!restaurant) return;
    if (!window.confirm("Are you sure you want to migrate all existing Purchases to the Invoices tab?")) return;
    
    setIsDeletingAll(true);
    toast({ title: "Migrating...", description: "Moving purchases to invoices. Please wait." });
    
    try {
      const expensesQuery = await getDocs(collection(db, 'restaurants', restaurant.id, 'expenses'));
      const purchasesToMigrate = expensesQuery.docs.filter(d => {
        const data = d.data();
        const isPurchase = data.subCategory === 'Purchase' || data.expenseCategoryId === 'Purchase' || (!!data.partyId && data.subCategory !== 'Payment Out');
        return isPurchase && !data.isAccrual;
      });
      
      for (let i = 0; i < purchasesToMigrate.length; i += 400) {
        const chunk = purchasesToMigrate.slice(i, i + 400);
        const chunkBatch = writeBatch(db);
        chunk.forEach(d => {
          chunkBatch.update(d.ref, { isAccrual: true });
        });
        await chunkBatch.commit();
      }
      
      toast({ title: "Migration Complete", description: `Successfully moved ${purchasesToMigrate.length} purchases to Invoices.` });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message || "Failed to migrate purchases." });
    } finally {
      setIsDeletingAll(false);
    }
  };

  const dailyMetrics = useMemo(() => {
    const metrics = new Map();
    if (!startDate || !endDate || !today) return metrics;
    
    let runningBalance = 0;
    
    accounts?.forEach(acc => {
      const base = (acc.openingBalanceDate && acc.openingBalanceDate < startDate) ? (Number(acc.balance) || 0) : 0;
      const revBefore = sales?.filter(s => s.salesAccountId === acc.id && s.paymentDate < startDate).reduce((s, p) => s + (Number(p.amount) || 0), 0) || 0;
      const expBefore = purchases?.filter(e => e.accountId === acc.id && e.paymentDate < startDate && !e.isAccrual).reduce((s, p) => s + (Number(p.amount) || 0), 0) || 0;
      const tInBefore = transfers?.filter(t => t.toAccountId === acc.id && t.date < startDate).reduce((s, t) => s + (Number(t.amount) || 0), 0) || 0;
      const tOutBefore = transfers?.filter(t => t.fromAccountId === acc.id && t.date < startDate).reduce((s, t) => s + (Number(t.amount) || 0), 0) || 0;
      runningBalance += (base + revBefore - expBefore + tInBefore - tOutBefore);
    });

    daysInRange.forEach(day => {
      const dayStr = format(day, 'yyyy-MM-dd');
      let dayIn = 0;
      let dayOut = 0;
      
      stableGridColumns.forEach(col => {
        if (col.type === 'revenue') {
          const revs = salesBySettlement.get(`${dayStr}_${col.id}`) || [];
          dayIn += revs.reduce((sum, r) => sum + (r.amount || 0), 0);
        } else if (col.type === 'gst') {
          const gstPayouts = purchases?.filter(p => !p.isAccrual && p.paymentDate === dayStr && p.expenseCategoryId === 'Taxes') || [];
          dayOut += gstPayouts.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
        } else {
          const entityId = col.id;
          const entityPayouts = purchases?.filter(p => !p.isAccrual && p.paymentDate === dayStr && (p.partyId === entityId || p.staffId === entityId)) || [];
          dayOut += entityPayouts.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
        }
      });

      const newOpenings = accounts?.filter(acc => acc.openingBalanceDate === dayStr).reduce((sum, acc) => sum + (Number(acc.balance) || 0), 0) || 0;
      const dayTransfersIn = transfers?.filter(t => t.date === dayStr).reduce((sum, t) => sum + (Number(t.amount) || 0), 0) || 0;
      const dayTransfersOut = transfers?.filter(t => t.date === dayStr).reduce((sum, t) => sum + (Number(t.amount) || 0), 0) || 0;

      runningBalance += (dayIn - dayOut + newOpenings + dayTransfersIn - dayTransfersOut);
      metrics.set(dayStr, { dayIn, dayOut, closingBalance: runningBalance });
    });
    return metrics;
  }, [daysInRange, salesBySettlement, stableGridColumns, accounts, startDate, sales, purchases, transfers, today]);

  // --- Flat list rows for List View ---
  const flatRows = useMemo(() => {
    if (!startDate || !endDate) return [];
    const rows: any[] = [];

    // Sale Payments → Payment In
    sales?.forEach(s => {
      if (!s.paymentDate || s.paymentDate < startDate || s.paymentDate > endDate) return;
      const acc = accounts?.find(a => a.id === s.salesAccountId);
      rows.push({
        id: s.id,
        date: s.paymentDate,
        time: s.paymentTime || '00:00',
        type: 'Payment In',
        typeKey: 'payment_in',
        party: acc?.name || s.paymentMethod || '—',
        account: acc?.name || '—',
        accountId: s.salesAccountId || '',
        description: s.description || `${s.paymentMethod || 'Sale'}`,
        remark: s.remark || '',
        credit: s.amount || 0,
        debit: 0,
      });
    });

    // Expenses → Payment Out / Purchase
    purchases?.filter(p => !p.isAccrual).forEach(p => {
      if (!p.paymentDate || p.paymentDate < startDate || p.paymentDate > endDate) return;
      const acc = accounts?.find(a => a.id === p.accountId);
      const party = p.partyId
        ? (parties?.find(pt => pt.id === p.partyId)?.name || '—')
        : p.staffId
          ? (staff?.find(s => s.id === p.staffId)?.name || '—')
          : (p.description || '—');
      const isPurchase = p.subCategory === 'Purchase' || p.expenseCategoryId === 'Purchase' || (!!p.partyId && p.subCategory !== 'Payment Out');
      rows.push({
        id: p.id,
        date: p.paymentDate,
        time: p.paymentTime || '00:00',
        type: isPurchase ? 'Purchase' : 'Payment Out',
        typeKey: isPurchase ? 'purchase' : 'payment_out',
        party,
        account: acc?.name || '—',
        accountId: p.accountId || '',
        description: p.description || party,
        remark: p.remark || '',
        debit: p.amount || 0,
        credit: 0,
      });
    });

    // Sort by date+time
    rows.sort((a, b) => {
      const da = `${a.date} ${a.time}`;
      const db = `${b.date} ${b.time}`;
      return listSortDir === 'desc' ? db.localeCompare(da) : da.localeCompare(db);
    });

    return rows;
  }, [sales, purchases, accounts, parties, staff, startDate, endDate, listSortDir]);

  const filteredRows = useMemo(() => {
    if (listFilter === 'all') return flatRows;
    if (listFilter === 'sale') return flatRows.filter(r => r.typeKey === 'payment_in');
    return flatRows.filter(r => r.typeKey === listFilter);
  }, [flatRows, listFilter]);

  const accountFilteredRows = useMemo(() => {
    if (selectedTxAccountIds.length === 0 || !accounts) return filteredRows
    const idSet = new Set(selectedTxAccountIds)
    return filteredRows.filter(r => idSet.has(r.accountId))
  }, [filteredRows, selectedTxAccountIds, accounts])

  // Opening balance for single-account mode (all activity before startDate)
  const txOpeningBalance = useMemo(() => {
    if (!isSingleTxAccount || !singleTxAccount || !startDate) return 0
    const acc = singleTxAccount
    const baseline = Number(acc.balance) || 0
    const baselineDate = (acc as any).openingBalanceDate || '2000-01-01'
    let endCalcDate: string
    try { endCalcDate = format(subDays(parseISO(startDate), 1), 'yyyy-MM-dd') }
    catch { return baseline }
    if (baselineDate > endCalcDate) return baseline
    const accType = (acc as any).type || 'Cash'
    const totalIn = (sales || []).filter(p => {
      if (p.salesAccountId !== acc.id) return false
      const { date: effDate } = getSettlementDate(p.paymentDate, accType)
      return effDate >= baselineDate && effDate <= endCalcDate
    }).reduce((s, p) => s + (Number(p.amount) || 0), 0)
    const totalOut = (purchases || []).filter(p =>
      p.accountId === acc.id && !p.isAccrual &&
      p.paymentDate >= baselineDate && p.paymentDate <= endCalcDate
    ).reduce((s, p) => s + (Number(p.amount) || 0), 0)
    const txIn = (transfers || []).filter((t: any) =>
      t.toAccountId === acc.id && t.date >= baselineDate && t.date <= endCalcDate
    ).reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0)
    const txOut = (transfers || []).filter((t: any) =>
      t.fromAccountId === acc.id && t.date >= baselineDate && t.date <= endCalcDate
    ).reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0)
    return baseline + totalIn - totalOut + txIn - txOut
  }, [isSingleTxAccount, singleTxAccount, startDate, sales, purchases, transfers])

  // Per-row running balance + daily closing + physical balance maps (single account only)
  const singleAccountData = useMemo(() => {
    const empty = { balanceMap: new Map<string, number>(), physicalMap: new Map<string, number | null>(), dailyClosingMap: new Map<string, number>() }
    if (!isSingleTxAccount) return empty
    const ascRows = [...accountFilteredRows].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
    let balance = txOpeningBalance
    const balanceMap = new Map<string, number>()
    const dailyClosingMap = new Map<string, number>()
    ascRows.forEach(row => {
      balance += (row.credit || 0) - (row.debit || 0)
      balanceMap.set(row.id, balance)
      dailyClosingMap.set(row.date, balance)
    })
    const physicalMap = new Map<string, number | null>()
    ;(dailyPhysicals || []).forEach((d: any) => {
      if (d.accountId === selectedTxAccountIds[0]) physicalMap.set(d.date, Number(d.physicalBalance))
    })
    return { balanceMap, physicalMap, dailyClosingMap }
  }, [isSingleTxAccount, accountFilteredRows, txOpeningBalance, dailyPhysicals, selectedTxAccountIds])

  if (!restaurant) return null;

  return (
    <div className="h-[calc(100vh-theme(spacing.16))] flex flex-col overflow-hidden">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between px-1 mb-4 shrink-0">
        {/* LEFT: sidebar trigger */}
        <div className="flex items-center gap-3">
          <SidebarTrigger />
        </div>

        {/* RIGHT: all action controls */}
        <div className="flex items-center gap-3 relative">
          <input type="file" accept=".xlsx, .xls" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
          <input type="file" accept=".xlsx, .xls" className="hidden" ref={paymentInFileInputRef} onChange={handlePaymentInUpload} />
          <input type="file" accept=".xlsx, .xls" className="hidden" ref={paymentOutFileInputRef} onChange={handlePaymentOutUpload} />
          <input type="file" accept=".xlsx, .xls" className="hidden" ref={purchaseFileInputRef} onChange={handlePurchaseUpload} />
          <input type="file" accept=".vyb" className="hidden" ref={vyaparFileInputRef} onChange={handleVyaparUpload} />
          {/* Import dropdown */}
          <div className="relative">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-10 px-3 bg-white shadow-sm font-black text-xs gap-2" disabled={isImporting || isPaymentInImporting || isPaymentOutImporting || isPurchaseImporting || isVyaparImporting || isDeletingAll || !!activeJob}>
                  {(isImporting || isPaymentInImporting || isPaymentOutImporting || isPurchaseImporting || isVyaparImporting || activeExcelJob)
                    ? <Loader2 className="size-4 animate-spin" />
                    : <Upload className="size-4 text-primary" />}
                  {activeExcelJob ? `${Math.round((activeExcelJob.processedRows / Math.max(activeExcelJob.totalRows, 1)) * 100)}%` : 'Import'}
                  <ChevronDown className="size-3 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-44">
                <DropdownMenuItem onClick={() => fileInputRef.current?.click()} className="text-xs font-black gap-2">
                  <Upload className="size-3.5 text-primary" /> All (Excel)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => paymentInFileInputRef.current?.click()} className="text-xs font-black gap-2 text-emerald-700 focus:text-emerald-800 focus:bg-emerald-50">
                  <ArrowDownLeft className="size-3.5" /> Payment In
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => paymentOutFileInputRef.current?.click()} className="text-xs font-black gap-2 text-red-700 focus:text-red-800 focus:bg-red-50">
                  <ArrowUpRight className="size-3.5" /> Payment Out
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => purchaseFileInputRef.current?.click()} className="text-xs font-black gap-2 text-orange-700 focus:text-orange-800 focus:bg-orange-50">
                  <ShoppingCart className="size-3.5" /> Purchase
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => vyaparFileInputRef.current?.click()} className="text-xs font-black gap-2 text-violet-700 focus:text-violet-800 focus:bg-violet-50">
                  <Database className="size-3.5" /> Vyapar (.vyb)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {importJobs.length > 0 && (
              <button onClick={() => setShowJobsPanel(v => !v)} className="absolute -top-1.5 -right-1.5 size-4 rounded-full bg-primary text-white text-[8px] font-black flex items-center justify-center leading-none">
                {importJobs.length}
              </button>
            )}
          </div>

          {showJobsPanel && (
            <div className="absolute top-full right-0 mt-2 w-80 bg-white rounded-2xl border shadow-2xl z-50 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Import History</span>
                <button onClick={() => setShowJobsPanel(false)} className="text-muted-foreground hover:text-foreground"><XCircle className="size-4" /></button>
              </div>
              <div className="divide-y max-h-72 overflow-auto">
                {importJobs.map(job => {
                  const pct = job.totalRows > 0 ? Math.round((job.processedRows / job.totalRows) * 100) : 0;
                  return (
                    <div key={job.id} className="px-4 py-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-black truncate flex-1" title={job.fileName}>{job.fileName}</span>
                        {job.status === 'done' && <Badge className="text-[8px] h-4 bg-emerald-500 text-white border-none shrink-0">Done</Badge>}
                        {job.status === 'running' && <Badge className="text-[8px] h-4 bg-blue-500 text-white border-none shrink-0 animate-pulse">Running</Badge>}
                        {job.status === 'error' && <Badge className="text-[8px] h-4 bg-destructive text-white border-none shrink-0">Error</Badge>}
                      </div>
                      {job.status === 'running' && (
                        <>
                          <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                            <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                          </div>
                          <p className="text-[10px] text-muted-foreground font-bold">
                            {job.processedRows.toLocaleString('en-IN')} / {job.totalRows > 0 ? job.totalRows.toLocaleString('en-IN') : '...'} rows ({pct}%)
                          </p>
                        </>
                      )}
                      {job.status === 'done' && (<p className="text-[10px] text-muted-foreground font-bold">✅ {job.salesCount} sales + {job.expenseCount} expenses + {(job as any).transferCount || 0} transfers</p>)}
                      {job.status === 'error' && (<p className="text-[10px] text-destructive font-bold truncate">{job.error}</p>)}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {/* View toggle */}
          <div className="flex items-center bg-white border rounded-lg shadow-sm overflow-hidden h-10">
            <button onClick={() => setViewMode('grid')} className={cn("flex items-center gap-1.5 px-3 h-full text-xs font-black transition-colors", viewMode === 'grid' ? "bg-primary text-white" : "text-muted-foreground hover:bg-muted/40")}>
              <LayoutGrid className="size-3.5" /> Grid
            </button>
            <button onClick={() => setViewMode('list')} className={cn("flex items-center gap-1.5 px-3 h-full text-xs font-black transition-colors border-l", viewMode === 'list' ? "bg-primary text-white" : "text-muted-foreground hover:bg-muted/40")}>
              <LayoutList className="size-3.5" /> List
            </button>
          </div>
          <Button variant="outline" size="sm" onClick={handleExportExcel} className="h-10 px-3 bg-white shadow-sm font-black text-xs gap-2" disabled={isImporting || isDeletingAll}>
            <FileSpreadsheet className="size-4 text-emerald-600" /> Export
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-10 px-3 bg-red-50 text-red-600 border-red-200 hover:bg-red-100 hover:text-red-700 shadow-sm font-black text-xs gap-2" disabled={isImporting || isDeletingAll}>
                {isDeletingAll ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Clear Data
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-48 p-2">
              <div className="flex flex-col gap-1">
                <Button variant="ghost" size="sm" onClick={() => handleDeleteTransactions('payment_in')} className="justify-start text-xs font-black text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50">Clear Payment In</Button>
                <Button variant="ghost" size="sm" onClick={() => handleDeleteTransactions('payment_out')} className="justify-start text-xs font-black text-red-700 hover:text-red-800 hover:bg-red-50">Clear Payment Out</Button>
                <Button variant="ghost" size="sm" onClick={() => handleDeleteTransactions('purchase')} className="justify-start text-xs font-black text-orange-700 hover:text-orange-800 hover:bg-orange-50">Clear Purchases</Button>
                <Separator className="my-1" />
                <Button variant="ghost" size="sm" onClick={handleMigratePurchases} className="justify-start text-xs font-black text-blue-700 hover:text-blue-800 hover:bg-blue-50">Migrate Purchases to Invoices</Button>
                <Separator className="my-1" />
                <Button variant="ghost" size="sm" onClick={() => handleDeleteTransactions('all')} className="justify-start text-xs font-black text-destructive hover:bg-destructive shadow-sm hover:text-white">Clear All Transactions</Button>
                <Separator className="my-1" />
                <Button variant="ghost" size="sm" onClick={handleDeleteEverything} className="justify-start text-xs font-black text-destructive hover:bg-destructive shadow-sm hover:text-white">Delete Everything</Button>
              </div>
            </PopoverContent>
          </Popover>
          <div className="flex items-center gap-2 bg-white border rounded-lg px-2 h-10 shadow-sm">
            <Wallet className="size-3.5 text-muted-foreground" />
            <div className="flex flex-col">
              <Label className="text-[8px] font-black uppercase text-muted-foreground">Default Account</Label>
              <select value={selectedPayoutAccountId} onChange={(e) => setSelectedPayoutAccountId(e.target.value)} className="bg-transparent border-none text-[10px] font-black uppercase outline-none focus:ring-0 cursor-pointer">
                {accounts?.map(acc => (<option key={acc.id} value={acc.id}>{acc.name}</option>))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {viewMode === 'list' && (
        <div className="flex-1 flex flex-col bg-card rounded-xl border shadow-lg overflow-hidden">
          {/* Filter chips */}
          <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/20 shrink-0 flex-wrap">
            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mr-1">Filter</span>
            {([
              { key: 'all', label: 'All' },
              { key: 'payment_in', label: 'Payment In' },
              { key: 'payment_out', label: 'Payment Out' },
              { key: 'purchase', label: 'Purchase' },
              { key: 'sale', label: 'Sale' },
            ] as const).map(f => (
              <button
                key={f.key}
                onClick={() => setListFilter(f.key)}
                className={cn(
                  "px-3 py-1 rounded-full text-[10px] font-black border transition-all",
                  listFilter === f.key
                    ? "bg-primary text-white border-primary shadow"
                    : "bg-white text-muted-foreground border-border hover:border-primary/40"
                )}
              >
                {f.label}
                {listFilter === f.key && (
                  <span className="ml-1.5 bg-white/20 rounded-full px-1">{accountFilteredRows.length}</span>
                )}
              </button>
            ))}

            {/* Account multi-select */}
            {(() => {
              const allIds = accounts?.map(a => a.id) ?? []
              const cashIds = accounts?.filter(a => a.type === 'Cash').map(a => a.id) ?? []
              const bankIds = accounts?.filter(a => a.type !== 'Cash').map(a => a.id) ?? []
              const allSel = allIds.length > 0 && selectedTxAccountIds.length === allIds.length
              const cashOnly = cashIds.length > 0 && selectedTxAccountIds.length === cashIds.length && cashIds.every(id => selectedTxAccountIds.includes(id))
              const bankOnly = bankIds.length > 0 && selectedTxAccountIds.length === bankIds.length && bankIds.every(id => selectedTxAccountIds.includes(id))
              const label = allSel ? '🏛️ All Accounts' : cashOnly ? '💵 Cash' : bankOnly ? '🏦 Bank' : isSingleTxAccount ? `${singleTxAccount?.type === 'Cash' ? '💵' : '🏦'} ${singleTxAccount?.name ?? ''}` : `${selectedTxAccountIds.length} Accounts`
              const toggle = (id: string) => setSelectedTxAccountIds(prev =>
                prev.includes(id) ? (prev.length > 1 ? prev.filter(x => x !== id) : prev) : [...prev, id]
              )
              return (
                <Popover open={txAccountPickerOpen} onOpenChange={setTxAccountPickerOpen}>
                  <PopoverTrigger asChild>
                    <button className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black border bg-white text-muted-foreground border-border hover:border-primary/40 transition-all">
                      {label} <ChevronDown className="size-3 opacity-60" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-60 p-3 space-y-2.5">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1.5">Quick Select</p>
                      <div className="flex flex-wrap gap-1.5">
                        <Button size="sm" variant={allSel ? "default" : "outline"} className="h-6 text-[10px] font-bold px-2" onClick={() => setSelectedTxAccountIds(allIds)}>🏛️ All</Button>
                        {cashIds.length > 0 && <Button size="sm" variant={cashOnly ? "default" : "outline"} className="h-6 text-[10px] font-bold px-2" onClick={() => setSelectedTxAccountIds(cashIds)}>💵 Cash</Button>}
                        {bankIds.length > 0 && <Button size="sm" variant={bankOnly ? "default" : "outline"} className="h-6 text-[10px] font-bold px-2" onClick={() => setSelectedTxAccountIds(bankIds)}>🏦 Bank</Button>}
                      </div>
                    </div>
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1.5">Individual</p>
                      <div className="space-y-1">
                        {accounts?.map(acc => (
                          <label key={acc.id} className="flex items-center gap-2 cursor-pointer rounded px-1.5 py-1 hover:bg-muted/50 transition-colors">
                            <Checkbox checked={selectedTxAccountIds.includes(acc.id)} onCheckedChange={() => toggle(acc.id)} />
                            <span className="text-xs font-bold flex-1 truncate">{acc.type === 'Cash' ? '💵' : '🏦'} {acc.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              )
            })()}

            <span className="ml-auto text-[10px] font-black text-muted-foreground">
              {accountFilteredRows.length} transactions
            </span>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-auto">
            <table className="w-full border-separate border-spacing-0 text-xs">
              <thead>
                <tr className="bg-muted/30">
                  <th className="sticky top-0 z-10 bg-muted/30 px-3 py-3 text-left font-black text-[10px] uppercase text-muted-foreground border-b w-12">Sr#</th>
                  <th
                    className="sticky top-0 z-10 bg-muted/30 px-3 py-3 text-left font-black text-[10px] uppercase text-muted-foreground border-b cursor-pointer hover:text-primary select-none whitespace-nowrap"
                    onClick={() => setListSortDir(d => d === 'desc' ? 'asc' : 'desc')}
                  >
                    <div className="flex items-center gap-1">
                      Date
                      {listSortDir === 'desc' ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />}
                    </div>
                  </th>
                  <th className="sticky top-0 z-10 bg-muted/30 px-3 py-3 text-left font-black text-[10px] uppercase text-muted-foreground border-b">Type</th>
                  <th className="sticky top-0 z-10 bg-muted/30 px-3 py-3 text-left font-black text-[10px] uppercase text-muted-foreground border-b">Party / Account</th>
                  <th className="sticky top-0 z-10 bg-muted/30 px-3 py-3 text-left font-black text-[10px] uppercase text-muted-foreground border-b">Description</th>
                  <th className="sticky top-0 z-10 bg-muted/30 px-3 py-3 text-right font-black text-[10px] uppercase text-destructive border-b">Debit (Out)</th>
                  <th className="sticky top-0 z-10 bg-muted/30 px-3 py-3 text-right font-black text-[10px] uppercase text-emerald-600 border-b">Credit (In)</th>
                  {isSingleTxAccount && <th className="sticky top-0 z-10 bg-muted/30 px-3 py-3 text-right font-black text-[10px] uppercase text-primary border-b border-l">Balance</th>}
                  {isSingleTxAccount && <th className="sticky top-0 z-10 bg-muted/30 px-3 py-3 text-right font-black text-[10px] uppercase text-blue-600 border-b border-l bg-blue-50/30">Physical</th>}
                  <th className="sticky top-0 z-10 bg-muted/30 px-3 py-3 text-left font-black text-[10px] uppercase text-muted-foreground border-b">Remark</th>
                </tr>
              </thead>
              <tbody>
                {accountFilteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={isSingleTxAccount ? 10 : 8} className="text-center py-16 text-muted-foreground">
                      <div className="flex flex-col items-center gap-2">
                        <LayoutList className="size-10 opacity-20" />
                        <p className="text-xs font-black uppercase tracking-widest opacity-50">No transactions found</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  accountFilteredRows.map((row, idx) => {
                    const runningBalance = singleAccountData.balanceMap.get(row.id)
                    const physical = singleAccountData.physicalMap.get(row.date)
                    const dailyClosing = singleAccountData.dailyClosingMap.get(row.date)
                    const physicalMismatch = physical !== undefined && physical !== null && dailyClosing !== undefined && physical !== dailyClosing
                    return (
                    <tr
                      key={row.id}
                      className={cn(
                        "transition-colors hover:bg-muted/30",
                        idx % 2 === 0 ? "bg-white" : "bg-muted/10"
                      )}
                    >
                      <td className="px-3 py-2.5 border-b text-muted-foreground font-black text-[10px] w-12">{idx + 1}</td>
                      <td className="px-3 py-2.5 border-b font-bold whitespace-nowrap">
                        <div>{row.date ? new Date(row.date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}</div>
                        <div className="text-[9px] text-muted-foreground">{row.time}</div>
                      </td>
                      <td className="px-3 py-2.5 border-b">
                        <span className={cn(
                          "px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide whitespace-nowrap",
                          row.typeKey === 'payment_in' ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : row.typeKey === 'purchase' ? "bg-orange-50 text-orange-700 border border-orange-200"
                          : "bg-red-50 text-red-700 border border-red-200"
                        )}>
                          {row.type}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 border-b font-bold max-w-[160px] truncate" title={row.party}>{row.party}</td>
                      <td className="px-3 py-2.5 border-b text-muted-foreground max-w-[200px] truncate" title={row.description}>{row.description}</td>
                      <td className="px-3 py-2.5 border-b text-right font-black">
                        {row.debit > 0 ? (
                          <span className="text-destructive">₹{row.debit.toLocaleString('en-IN')}</span>
                        ) : <span className="text-muted-foreground/30">—</span>}
                      </td>
                      <td className="px-3 py-2.5 border-b text-right font-black">
                        {row.credit > 0 ? (
                          <span className="text-emerald-600">₹{row.credit.toLocaleString('en-IN')}</span>
                        ) : <span className="text-muted-foreground/30">—</span>}
                      </td>
                      {isSingleTxAccount && (
                        <td className="px-3 py-2.5 border-b border-l text-right font-black text-xs">
                          {runningBalance !== undefined ? (
                            <span className={cn(runningBalance < 0 ? "text-destructive" : runningBalance > 0 ? "text-primary" : "text-muted-foreground")}>
                              ₹{runningBalance.toLocaleString('en-IN')}
                            </span>
                          ) : <span className="text-muted-foreground/30">—</span>}
                        </td>
                      )}
                      {isSingleTxAccount && (
                        <td className="px-3 py-2.5 border-b border-l bg-blue-50/20 text-right font-black text-xs">
                          {physical !== undefined && physical !== null ? (
                            <span className={cn(physicalMismatch ? "text-amber-600" : "text-blue-600", "flex items-center justify-end gap-1")}>
                              {physicalMismatch && <AlertTriangle className="size-3" />}
                              ₹{physical.toLocaleString('en-IN')}
                            </span>
                          ) : <span className="text-muted-foreground/20">—</span>}
                        </td>
                      )}
                      <td className="px-3 py-2.5 border-b text-muted-foreground text-[10px] max-w-[140px] truncate" title={row.remark}>{row.remark || '—'}</td>
                    </tr>
                    )
                  })
                )}
              </tbody>
              {accountFilteredRows.length > 0 && (
                <tfoot className="sticky bottom-0 z-20 shadow-[0_-2px_10px_rgba(0,0,0,0.05)] inset-x-0">
                  <tr className="bg-white/95 backdrop-blur font-black">
                    <td colSpan={5} className="px-3 py-3 text-[10px] uppercase text-muted-foreground border-t-2">Totals ({accountFilteredRows.length} rows)</td>
                    <td className="px-3 py-3 text-right text-destructive border-t-2">
                      ₹{accountFilteredRows.reduce((s, r) => s + r.debit, 0).toLocaleString('en-IN')}
                    </td>
                    <td className="px-3 py-3 text-right text-emerald-600 border-t-2">
                      ₹{accountFilteredRows.reduce((s, r) => s + r.credit, 0).toLocaleString('en-IN')}
                    </td>
                    {isSingleTxAccount && (
                      <td className="px-3 py-3 text-right text-primary border-t-2 border-l text-xs font-black">
                        {(() => {
                          const last = accountFilteredRows[accountFilteredRows.length - 1]
                          const bal = last ? singleAccountData.balanceMap.get(last.id) : undefined
                          return bal !== undefined ? `₹${bal.toLocaleString('en-IN')}` : '—'
                        })()}
                      </td>
                    )}
                    {isSingleTxAccount && <td className="border-t-2 border-l bg-blue-50/20" />}
                    <td className="border-t-2" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {viewMode === 'grid' && (
      <div className="flex-1 bg-card rounded-xl border shadow-lg overflow-auto relative">
        <table className="w-max border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-40 bg-white border-b-2 border-r-2 p-4 text-left w-[120px] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                <div className="text-[10px] font-black uppercase text-muted-foreground">Settled Day</div>
              </th>
              {stableGridColumns.map((col) => (
                <th key={col.id} className="sticky top-0 z-30 bg-white border-b-2 border-l p-4 w-[170px] text-center shadow-[0_2px_5px_-2px_rgba(0,0,0,0.1)]">
                  <div className="flex flex-col items-center gap-1">
                    <div className="size-8 shrink-0 flex items-center justify-center">
                      {col.logoUrl ? (
                        <Image src={col.logoUrl} alt="" width={32} height={32} className="object-contain" />
                      ) : (
                        <col.icon className={cn("size-5", col.type === 'revenue' ? "text-primary" : "text-destructive")} />
                      )}
                    </div>
                    <span className="font-black text-[11px] truncate w-full">{col.name}</span>
                    <Badge variant="outline" className="text-[8px] font-black uppercase h-3.5 tracking-tighter">
                      Settled {col.type === 'revenue' ? 'In' : 'Out'}
                    </Badge>
                  </div>
                </th>
              ))}
              <th className="sticky top-0 z-30 bg-primary/[0.05] border-b-2 border-l p-4 w-[130px] text-center"><span className="font-black text-[11px] text-primary uppercase">Total In</span></th>
              <th className="sticky top-0 z-30 bg-destructive/[0.05] border-b-2 border-l p-4 w-[130px] text-center"><span className="font-black text-[11px] text-destructive uppercase">Total Out</span></th>
              <th className="sticky top-0 z-30 bg-muted/40 border-b-2 border-l p-4 w-[160px] text-center shadow-[0_2px_5px_-2px_rgba(0,0,0,0.1)]"><span className="font-black text-[11px] uppercase">Closing Balance</span></th>
            </tr>
          </thead>
          <tbody>
            {daysInRange.map((day) => {
              const ds = format(day, 'yyyy-MM-dd');
              const metrics = dailyMetrics.get(ds) || { dayIn: 0, dayOut: 0, closingBalance: 0 };
              const isToday = today === ds;
              const isFuture = ds > today;
              
              return (
                <tr key={ds} className={cn("hover:bg-muted/30 transition-colors", isToday && "bg-primary/[0.02]", isFuture && "opacity-40 bg-muted/5")}>
                  <td className={cn("sticky left-0 z-20 p-4 border-r-2 border-b font-medium shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]", isToday ? "bg-[#f8faf9]" : (isFuture ? "bg-muted/5" : "bg-white"))}>
                    <div className="flex flex-col leading-tight">
                      <span className="text-xs font-black">{format(day, 'dd MMM')}</span>
                      <span className="text-[9px] text-muted-foreground uppercase opacity-60 font-bold">{format(day, 'EEE')}</span>
                    </div>
                  </td>
                  {stableGridColumns.map((col) => {
                    const currentTxs = col.type === 'revenue' 
                      ? (salesBySettlement.get(`${ds}_${col.id}`) || [])
                      : (payoutsBySettlement.get(`${ds}_${col.id}`) || []);
                    
                    const totalVal = currentTxs.reduce((sum, t) => sum + (t.amount || 0), 0);
                    
                    return (
                      <td key={`${ds}-${col.id}`} className="p-1 border-l border-b w-[170px]">
                        <Dialog>
                          <DialogTrigger asChild>
                            <div className={cn(
                              "relative flex flex-col items-center justify-center h-10 cursor-pointer group rounded-md hover:bg-white/80 transition-all",
                              totalVal > 0 ? "bg-white/40 border-primary/10 border" : ""
                            )}>
                              <div className={cn(
                                "text-xs font-black",
                                totalVal > 0 ? (col.type === 'revenue' ? "text-primary" : "text-slate-950") : "text-muted-foreground opacity-30"
                              )}>
                                {totalVal > 0 ? `₹${totalVal.toLocaleString('en-IN')}` : "0"}
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                {currentTxs.length > 1 && (
                                  <Badge className="h-3 px-1 text-[7px] font-bold bg-primary text-white border-none">
                                    {currentTxs.length} entries
                                  </Badge>
                                )}
                                <span className="text-[8px] font-black uppercase text-muted-foreground/40 truncate max-w-full px-2">
                                  {totalVal > 0 ? (accounts?.find(a => a.id === (currentTxs[0] as any)?.accountId || a.id === (currentTxs[0] as any)?.salesAccountId)?.name || "Multiple") : "Click to add"}
                                </span>
                              </div>
                              {savingId === `${ds}_${col.id}` && <Loader2 className="absolute right-1 top-3 size-2.5 animate-spin text-primary" />}
                            </div>
                          </DialogTrigger>
                          <DialogContent className="max-w-md p-0 shadow-2xl border-primary/20 overflow-hidden rounded-3xl border-none">
                            <DialogHeader className="hidden">
                              <DialogTitle>Daily Settlement - {col.name}</DialogTitle>
                              <DialogDescription>Record settlements for {format(day, 'dd MMM yyyy')}</DialogDescription>
                            </DialogHeader>
                            
                            <div className="bg-[#00263b] text-white px-6 py-4 flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className="size-10 rounded-2xl bg-white/10 flex items-center justify-center overflow-hidden p-1.5">
                                  {col.logoUrl ? (
                                    <Image src={col.logoUrl} alt="" width={32} height={32} className="object-contain brightness-0 invert" />
                                  ) : (
                                    <col.icon className="size-5 text-white/80" />
                                  )}
                                </div>
                                <span className="text-sm font-black uppercase tracking-widest">{col.name}</span>
                              </div>
                              <div className="text-xs font-black text-white/60 uppercase">
                                {format(day, 'dd MMM yyyy')}
                              </div>
                            </div>
                            
                            <div className="max-h-[450px] overflow-auto p-6 space-y-6 bg-[#f8f9fa]">
                              {currentTxs.length > 0 ? (
                                currentTxs.map((tx, idx) => (
                                  <TransactionForm 
                                    key={tx.id}
                                    tx={tx}
                                    col={col}
                                    day={day}
                                    idx={idx}
                                    accounts={accounts || []}
                                    onSave={(data) => handleUpsertTransaction(day, col, tx.id, data)}
                                    onDelete={() => handleDeleteTransaction(`${ds}_${col.id}`, col.type === 'revenue' ? 'salePayments' : 'expenses', tx.id)}
                                    selectedPayoutAccountId={selectedPayoutAccountId}
                                  />
                                ))
                              ) : (
                                <div className="py-12 text-center border-2 border-dashed rounded-2xl bg-white">
                                  <p className="text-[10px] text-muted-foreground font-black uppercase tracking-[0.2em]">No entries recorded</p>
                                </div>
                              )}
                            </div>

                            <div className="p-6 border-t bg-white space-y-4">
                              <Button 
                                className="w-full h-14 gap-2 font-black text-sm uppercase shadow-xl bg-[#00263b] hover:bg-[#00263b]/90 text-white rounded-2xl"
                                onClick={() => handleUpsertTransaction(day, col, null, { 
                                  amount: 0, 
                                  time: col.accType === 'Cash' ? '23:00' : format(new Date(), 'HH:mm'), 
                                  remark: '', 
                                  accountId: selectedPayoutAccountId || (accounts && accounts[0]?.id) || ""
                                })}
                                disabled={isFuture}
                              >
                                <Plus className="size-5" /> Add New Entry
                              </Button>
                              <p className="text-[10px] text-muted-foreground italic text-center leading-tight">Payments linked to Bill Dates update the Entity Ledger status.</p>
                            </div>
                          </DialogContent>
                        </Dialog>
                      </td>
                    );
                  })}
                  <td className="border-l border-b bg-primary/[0.02] text-center font-black text-primary text-xs w-[130px]">₹{metrics.dayIn.toLocaleString('en-IN')}</td>
                  <td className="border-l border-b bg-destructive/[0.02] text-center font-black text-destructive text-xs w-[130px]">₹{metrics.dayOut.toLocaleString('en-IN')}</td>
                  <td className={cn("border-l border-b text-center font-black text-xs bg-muted/10 w-[160px]", metrics.closingBalance >= 0 ? "text-accent" : "text-destructive")}>
                    ₹{metrics.closingBalance.toLocaleString('en-IN')}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="sticky bottom-0 z-40 shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
            <tr className="bg-muted/95 backdrop-blur border-t-2">
              <td className="sticky left-0 bottom-0 z-50 px-4 py-3 border-r-2 border-t-2 bg-muted/95 backdrop-blur font-black text-[10px] uppercase text-muted-foreground shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] whitespace-nowrap">
                TOTAL ({daysInRange.length} days)
              </td>
              {stableGridColumns.map((col) => {
                const colTotal = daysInRange.reduce((sum, day) => {
                  const ds = format(day, 'yyyy-MM-dd');
                  const txs = col.type === 'revenue'
                    ? (salesBySettlement.get(`${ds}_${col.id}`) || [])
                    : (payoutsBySettlement.get(`${ds}_${col.id}`) || []);
                  return sum + txs.reduce((s, t) => s + (t.amount || 0), 0);
                }, 0);
                return (
                  <td key={`total-${col.id}`} className="border-l border-t-2 px-4 py-3 text-center font-black text-xs bg-muted/95 backdrop-blur">
                    <span className={col.type === 'revenue' ? 'text-primary' : 'text-destructive'}>
                      {colTotal > 0 ? `₹${colTotal.toLocaleString('en-IN')}` : '—'}
                    </span>
                  </td>
                );
              })}
              <td className="border-l border-t-2 px-4 py-3 text-center font-black text-sm bg-primary/[0.08] backdrop-blur text-primary">
                ₹{daysInRange.reduce((s, d) => s + (dailyMetrics.get(format(d, 'yyyy-MM-dd'))?.dayIn || 0), 0).toLocaleString('en-IN')}
              </td>
              <td className="border-l border-t-2 px-4 py-3 text-center font-black text-sm bg-destructive/[0.08] backdrop-blur text-destructive">
                ₹{daysInRange.reduce((s, d) => s + (dailyMetrics.get(format(d, 'yyyy-MM-dd'))?.dayOut || 0), 0).toLocaleString('en-IN')}
              </td>
              <td className="border-l border-t-2 px-4 py-3 text-center font-black text-sm bg-muted/95 backdrop-blur">
                {(() => {
                  const net = daysInRange.reduce((s, d) => s + (dailyMetrics.get(format(d, 'yyyy-MM-dd'))?.dayIn || 0), 0)
                            - daysInRange.reduce((s, d) => s + (dailyMetrics.get(format(d, 'yyyy-MM-dd'))?.dayOut || 0), 0);
                  return <span className={net >= 0 ? 'text-emerald-600' : 'text-destructive'}>₹{net.toLocaleString('en-IN')}</span>;
                })()}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      )}

    </div>
  )
}

function TransactionForm({ 
  tx, 
  col, 
  day, 
  idx, 
  accounts, 
  onSave, 
  onDelete, 
  selectedPayoutAccountId 
}: { 
  tx: any; 
  col: any; 
  day: Date; 
  idx: number; 
  accounts: SalesAccount[]; 
  onSave: (data: any) => void;
  onDelete: () => void;
  selectedPayoutAccountId: string;
}) {
  const [amount, setAmount] = useState(tx.amount || 0)
  const [time, setTime] = useState((tx as any).paymentTime || (col.accType === 'Cash' ? '23:00' : '12:00'))
  const [remark, setRemark] = useState((tx as any).remark || "")
  const [accountId, setAccountId] = useState((tx as any).accountId || (tx as any).salesAccountId || selectedPayoutAccountId)
  const [invoiceDate, setInvoiceDate] = useState((tx as any).invoiceDate || format(day, 'yyyy-MM-dd'))

  const handleLocalSave = () => {
    onSave({ amount, time, remark, accountId, invoiceDate });
  };

  return (
    <div className="space-y-4 p-5 bg-white rounded-3xl border-2 border-slate-100 shadow-sm relative animate-in fade-in slide-in-from-top-2">
      <div className="flex items-center justify-between border-b pb-3 mb-3">
        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Entry #{idx + 1}</span>
        <Button 
          variant="ghost" 
          size="icon" 
          className="size-8 text-destructive hover:bg-destructive/10 rounded-full"
          onClick={onDelete}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Amount (₹)</Label>
          <Input 
            type="number" 
            className="h-12 text-lg font-black border-slate-200 rounded-2xl focus:ring-primary"
            value={amount || ""}
            onChange={(e) => setAmount(parseFloat(e.target.value))}
            placeholder="0.00"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Time</Label>
          <div className="relative">
            <Clock className="absolute left-3 top-4 size-4 text-muted-foreground" />
            <Input 
              type="time" 
              className="h-12 pl-10 text-xs font-black border-slate-200 rounded-2xl"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
        </div>
      </div>

      {col.type !== 'revenue' && (
        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-[10px] font-black uppercase text-[#00263b] flex items-center gap-2 tracking-widest">
              <LinkIcon className="size-3.5" /> Linked Bill Date
            </Label>
          </div>
          <Input 
            type="date"
            className="h-10 text-xs font-black border-slate-200 rounded-xl bg-white"
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
          />
        </div>
      )}

      <div className="space-y-3">
        <Label className="text-[10px] font-black uppercase text-muted-foreground ml-1 tracking-widest">Account Channel</Label>
        <div className="grid grid-cols-2 gap-3">
          {accounts.map(acc => (
            <button
              key={acc.id}
              type="button"
              onClick={() => setAccountId(acc.id)}
              className={cn(
                "flex items-center gap-3 p-3 rounded-2xl border-2 transition-all text-left",
                accountId === acc.id 
                  ? "border-primary bg-primary/5 ring-4 ring-primary/5 shadow-md" 
                  : "border-slate-100 hover:border-slate-200 bg-white"
              )}
            >
              <div className="size-10 shrink-0 flex items-center justify-center bg-white rounded-xl border border-slate-100 overflow-hidden p-1.5 shadow-inner">
                {acc.logoUrl ? (
                  <Image src={acc.logoUrl} alt="" width={32} height={32} className="object-contain" />
                ) : (
                  <Landmark className="size-5 text-slate-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={cn(
                  "text-[10px] font-black uppercase truncate leading-tight",
                  accountId === acc.id ? "text-primary" : "text-slate-600"
                )}>
                  {acc.name}
                </p>
                {accountId === acc.id && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <CheckCircle2 className="size-2.5 text-primary" />
                    <span className="text-[8px] font-bold text-primary uppercase">Selected</span>
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-[10px] font-black uppercase text-muted-foreground ml-1 tracking-widest">Remark / Note</Label>
        <div className="relative">
          <MessageSquare className="absolute left-3.5 top-4 size-4 text-muted-foreground/40" />
          <Input 
            className="h-12 pl-10 text-xs font-bold border-slate-200 rounded-2xl"
            placeholder="Reference # or Note"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
          />
        </div>
      </div>

      <Button 
        type="button"
        onClick={handleLocalSave}
        className="w-full h-12 gap-2 font-black text-xs uppercase bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl shadow-xl active:scale-[0.98] transition-all"
      >
        <Save className="size-4" /> Save Entry Details
      </Button>
    </div>
  );
}
