
"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { useDateContext } from "@/contexts/date-context"
import { useSearchParams } from "next/navigation"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Loader2,
  User,
  Banknote,
  Landmark,
  Store,
  Wallet,
  Zap,
  Percent,
  EyeOff,
  Eye,
  Download,
  FileSpreadsheet,
  FileText,
  XCircle,
  CheckCircle2,
  LayoutGrid,
  ListFilter,
  Copy,
  Check,
  Info,
  ImageIcon,
  Share2,
  Plus,
  Trash2,
  Clock,
  Save
} from "lucide-react"
import { exportToExcel } from "@/lib/export-excel"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useActiveRestaurant } from "@/hooks/use-active-restaurant"
import { useCollection, useMemoFirebase, useFirestore } from "@/firebase"
import { collection, doc } from "firebase/firestore"
import { setDocumentNonBlocking, deleteDocumentNonBlocking } from "@/firebase/non-blocking-updates"
import { SalePayment, SalesAccount, Expense, Party, Staff, DayStatus } from "@/lib/types"
import { format, startOfMonth, endOfMonth, eachDayOfInterval, subMonths, addMonths, addDays, subDays, isSameMonth, parseISO, isValid, differenceInDays } from "date-fns"
import { cn } from "@/lib/utils"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
  DialogTrigger
} from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { useToast } from "@/hooks/use-toast"
import { toPng, toBlob } from "html-to-image"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"

export default function InvoicesPage() {
  const { restaurant } = useActiveRestaurant()
  const db = useFirestore()
  const { toast } = useToast()
  
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [today, setToday] = useState("")
  
  const [savingId, setSavingId] = useState<string | null>(null)
  const [availableColumns, setAvailableColumns] = useState<any[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string>("")
  const [hideUnused, setHideUnused] = useState(true)
  const [viewMode, setViewMode] = useState<"detailed" | "categorized">("detailed")

  const [summaryDate, setSummaryDate] = useState<Date | null>(null)
  const [showMonthlySummary, setShowMonthlySummary] = useState(false)
  const [savedDates, setSavedDates] = useState<{ start: string; end: string } | null>(null)
  const [isCopied, setIsCopied] = useState(false)
  const [isCapturing, setIsCapturing] = useState(false)
  
  const dailyCaptureRef = useRef<HTMLDivElement>(null)
  const monthlyCaptureRef = useRef<HTMLDivElement>(null)

  const { startDate: ctxStart, endDate: ctxEnd, today: ctxToday } = useDateContext()
  useEffect(() => {
    setStartDate(ctxStart)
    setEndDate(ctxEnd)
    setToday(ctxToday)
  }, [ctxStart, ctxEnd, ctxToday])

  const salesRef = useMemoFirebase(() => restaurant ? collection(db, 'restaurants', restaurant.id, 'salePayments') : null, [db, restaurant?.id]);
  const purchasesRef = useMemoFirebase(() => restaurant ? collection(db, 'restaurants', restaurant.id, 'expenses') : null, [db, restaurant?.id]);
  const accountsRef = useMemoFirebase(() => restaurant ? collection(db, 'restaurants', restaurant.id, 'salesAccounts') : null, [db, restaurant?.id]);
  const partiesRef = useMemoFirebase(() => restaurant ? collection(db, 'restaurants', restaurant.id, 'parties') : null, [db, restaurant?.id]);
  const staffRef = useMemoFirebase(() => restaurant ? collection(db, 'restaurants', restaurant.id, 'staff') : null, [db, restaurant?.id]);
  const dayStatusesRef = useMemoFirebase(() => restaurant ? collection(db, 'restaurants', restaurant.id, 'dayStatuses') : null, [db, restaurant?.id]);

  const { data: sales } = useCollection<SalePayment>(salesRef);
  const { data: purchases } = useCollection<Expense>(purchasesRef);
  const { data: accounts } = useCollection<SalesAccount>(accountsRef);
  const { data: parties } = useCollection<Party>(partiesRef);
  const { data: staff } = useCollection<Staff>(staffRef);
  const { data: dayStatuses } = useCollection<DayStatus>(dayStatusesRef);

  const daysInRange = useMemo(() => {
    if (!startDate || !endDate) return [];
    try {
      const s = parseISO(startDate);
      const e = parseISO(endDate);
      if (!isValid(s) || !isValid(e)) return [];
      return eachDayOfInterval({ start: s, end: e });
    } catch (e) {
      return [];
    }
  }, [startDate, endDate]);

  useEffect(() => {
    if (accounts && !selectedAccountId) {
      setSelectedAccountId(accounts.find(a => a.type === 'Cash')?.id || accounts[0]?.id || "");
    }
  }, [accounts, selectedAccountId]);

  useEffect(() => {
    if (!accounts || !parties || !staff) return;

    const revenueCols = [
      ...accounts.filter(a => a.type === 'Cash').map(a => ({ type: 'sales', id: a.id, name: a.name, accType: a.type, icon: Banknote, category: 'Revenue' })),
      ...accounts.filter(a => a.type !== 'Cash').map(a => ({ type: 'sales', id: a.id, name: a.name, accType: a.type, icon: Landmark, category: 'Revenue' }))
    ];

    const gstCol = { type: 'gst', id: 'gst_accrual', name: 'GST (5%)', icon: Percent, category: 'Taxes' };

    const fixedParties = (parties || [])
      .filter(p => p.mainCategory === 'Fixed Cost')
      .sort((a, b) => (b.monthlyAmount || 0) - (a.manualAmount || 0));

    const rentCols = fixedParties.map(p => ({
      type: 'vendor', id: p.id, name: p.name, icon: Store,
      monthlyAmount: p.monthlyAmount || 0, mainCategory: p.mainCategory, subCategory: p.subCategory, category: p.subCategory || 'Other'
    }));

    const staffCols = (staff || []).sort((a, b) => (b.monthlySalary || 0) - (a.monthlySalary || 0)).map(s => ({
      type: 'staff', id: s.id, name: s.name, icon: User,
      monthlySalary: s.monthlySalary || 0, joiningDate: s.joiningDate, lastWorkingDate: s.lastWorkingDate, category: 'Salaries'
    }));

    const variableParties = (parties || []).filter(p => p.mainCategory !== 'Fixed Cost').sort((a, b) => (b.monthlyAmount || 0) - (a.monthlyAmount || 0));
    const vendorCols = variableParties.map(p => ({
      type: 'vendor', id: p.id, name: p.name, icon: Store,
      monthlyAmount: p.monthlyAmount || 0, mainCategory: p.mainCategory, subCategory: p.subCategory, category: p.subCategory || 'Other'
    }));

    setAvailableColumns([...revenueCols, gstCol, ...rentCols, ...staffCols, ...vendorCols]);
  }, [accounts, parties, staff]);

  const dayStatusMap = useMemo(() => {
    const map = new Map<string, boolean>();
    dayStatuses?.forEach(ds => map.set(ds.id, ds.isClosed));
    return map;
  }, [dayStatuses]);

  const entriesMap = useMemo(() => {
    const map = new Map<string, Expense[]>();
    purchases?.filter(p => p.isAccrual).forEach(p => {
      const entityId = p.partyId || p.staffId;
      if (p.invoiceDate && entityId) {
        const key = `${p.invoiceDate}_${entityId}`;
        const list = map.get(key) || [];
        list.push(p);
        map.set(key, list);
      }
    });
    return map;
  }, [purchases]);

  const gridDataMap = useMemo(() => {
    const map = new Map<string, number>();
    // First pass: accumulate all imported entries per key
    sales?.forEach(s => {
      const date = s.businessDate || s.paymentDate;
      const amount = Number(s.amount) || 0;
      if (date && s.salesAccountId && amount > 0 && !s.id.startsWith('daily_rev_')) {
        const key = `${date}_${s.salesAccountId}`;
        map.set(key, (map.get(key) || 0) + amount);
      }
    });
    // Second pass: manual daily_rev_ entries override imported sums entirely
    sales?.forEach(s => {
      const date = s.businessDate || s.paymentDate;
      const amount = Number(s.amount) || 0;
      if (date && s.salesAccountId && s.id.startsWith('daily_rev_')) {
        const key = `${date}_${s.salesAccountId}`;
        map.set(key, amount);  // authoritative override
      }
    });
    entriesMap.forEach((entries, key) => {
      map.set(key, entries.reduce((s, e) => s + (Number(e.amount) || 0), 0));
    });
    return map;
  }, [sales, entriesMap]);

  const isColActiveOnDay = (col: any, dayStr: string) => {
    if (!today || dayStr > today) return false;
    const isFixed = col.type === 'staff' || col.mainCategory === 'Fixed Cost';
    if (!isFixed && dayStatusMap.get(dayStr)) return false;
    
    if (col.type === 'staff') {
      if (col.joiningDate && dayStr < col.joiningDate) return false;
      if (col.lastWorkingDate && dayStr > col.lastWorkingDate) return false;
    }
    return true;
  };

  const getCellValue = (dayStr: string, col: any) => {
    if (!today) return 0;
    if (col.id === 'gst_accrual') return performanceMetrics.get(dayStr)?.dayGST || 0;
    
    const manualEntries = entriesMap.get(`${dayStr}_${col.id}`);
    if (manualEntries && manualEntries.length > 0) {
      return manualEntries.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    }

    if (col.isGroup) {
      let sum = 0;
      col.members.forEach((m: any) => {
        const manualVal = gridDataMap.get(`${dayStr}_${m.id}`);
        if (manualVal !== undefined) sum += manualVal;
        else if (isColActiveOnDay(m, dayStr) && dayStr < today) {
          sum += Math.round((m.type === 'staff' ? m.monthlySalary : m.monthlyAmount) / 30);
        }
      });
      return sum;
    }

    const manual = gridDataMap.get(`${dayStr}_${col.id}`);
    if (manual !== undefined) return manual;

    if (isColActiveOnDay(col, dayStr) && col.type !== 'sales' && dayStr < today) {
      const monthlyVal = col.type === 'staff' ? col.monthlySalary : col.monthlyAmount;
      return Math.round((monthlyVal || 0) / 30);
    }
    return 0;
  };

  const performanceMetrics = useMemo(() => {
    const metrics = new Map();
    if (!today) return metrics;

    daysInRange.forEach(day => {
      const dayStr = format(day, 'yyyy-MM-dd');
      const isClosed = dayStatusMap.get(dayStr);
      let daySales = 0, dayBills = 0;

      if (!isClosed) {
        availableColumns.forEach(col => {
          if (col.type === 'sales') daySales += gridDataMap.get(`${dayStr}_${col.id}`) ?? 0;
        });
      }

      const dayGST = isClosed ? 0 : Math.round(daySales / 21);

      availableColumns.forEach(col => {
        if (col.type !== 'sales' && col.type !== 'gst') {
          dayBills += getCellValue(dayStr, col);
        }
      });

      metrics.set(dayStr, { daySales, dayBills: dayBills + dayGST, dayGST, netPL: daySales - (dayBills + dayGST), isClosed });
    });
    return metrics;
  }, [daysInRange, gridDataMap, availableColumns, dayStatusMap, today, entriesMap]);

  const activeColumns = useMemo(() => {
    if (!hideUnused) return availableColumns;
    return availableColumns.filter(col => {
      return daysInRange.some(day => {
        const dayStr = format(day, 'yyyy-MM-dd');
        const val = getCellValue(dayStr, col);
        return val > 0;
      });
    });
  }, [availableColumns, hideUnused, daysInRange, gridDataMap, performanceMetrics, today]);

  const elapsedMetrics = useMemo(() => {
    if (!today || !daysInRange.length) return { elapsedDays: 1, elapsedWorkingDays: 1, colDivisors: new Map<string, number>() };

    let eDays = 0;
    let eWorkingDays = 0;
    const divisors = new Map<string, number>();

    daysInRange.forEach(day => {
      const dayStr = format(day, 'yyyy-MM-dd');
      if (dayStr < today) {
        eDays++;
        if (!dayStatusMap.get(dayStr)) eWorkingDays++;
      }
    });

    availableColumns.forEach(col => {
      let count = 0;
      daysInRange.forEach(day => {
        const dayStr = format(day, 'yyyy-MM-dd');
        if (dayStr < today && isColActiveOnDay(col, dayStr)) {
          count++;
        }
      });
      divisors.set(col.id, Math.max(1, count));
    });

    return { 
      elapsedDays: Math.max(1, eDays), 
      elapsedWorkingDays: Math.max(1, eWorkingDays),
      colDivisors: divisors 
    };
  }, [availableColumns, daysInRange, today, dayStatusMap]);

  const totals = useMemo(() => {
    const colTotals = new Map<string, number>();
    if (!today) return { colTotals, grandSales: 0, grandBills: 0, grandPL: 0 };

    let grandSales = 0, grandBills = 0;

    availableColumns.forEach(col => {
      let sum = 0;
      daysInRange.forEach(day => {
        const dayStr = format(day, 'yyyy-MM-dd');
        sum += getCellValue(dayStr, col);
      });
      colTotals.set(col.id, sum);
    });

    daysInRange.forEach(day => {
      const dayStr = format(day, 'yyyy-MM-dd');
      const m = performanceMetrics.get(dayStr);
      if (m) { grandSales += m.daySales; grandBills += m.dayBills; }
    });

    return { colTotals, grandSales, grandBills, grandPL: grandSales - grandBills };
  }, [availableColumns, daysInRange, gridDataMap, performanceMetrics, today]);

  const handleMonthShift = (months: number) => {
    const baseDate = parseISO(startDate);
    const newBase = months > 0 ? addMonths(baseDate, months) : subMonths(baseDate, Math.abs(months));
    setStartDate(format(startOfMonth(newBase), 'yyyy-MM-dd'));
    setEndDate(format(endOfMonth(newBase), 'yyyy-MM-dd'));
  };

  const toggleShopClosed = (day: Date, isClosed: boolean) => {
    if (!restaurant || !dayStatusesRef) return;
    const dayStr = format(day, 'yyyy-MM-dd');
    setDocumentNonBlocking(doc(dayStatusesRef, dayStr), { id: dayStr, restaurantId: restaurant.id, isClosed, restaurantMembers: restaurant.members }, { merge: true });
  };

  const handleExportExcel = () => {
    if (!daysInRange.length) return;

    const data: any[] = [];
    
    daysInRange.forEach(day => {
      const dayStr = format(day, 'yyyy-MM-dd');

      // Export Sales
      sales?.filter(s => (s.businessDate || s.paymentDate) === dayStr).forEach(s => {
        data.push({
          'Date': format(parseISO(dayStr), 'dd/MM/yyyy'),
          'Party Name': 'Revenue',
          'Transaction Type': 'Payment-in',
          'Ref No.': (s.id || "").substring(0, 5).toUpperCase(),
          'Amount': s.amount || 0,
          'Payment Type': accounts?.find(a => a.id === s.salesAccountId)?.name || s.paymentMethod || 'Unknown',
          'Received Amount': s.amount || 0
        });
      });

      // Export Expenses (Accruals)
      purchases?.filter(p => p.invoiceDate === dayStr && p.isAccrual).forEach(p => {
        data.push({
          'Date': format(parseISO(dayStr), 'dd/MM/yyyy'),
          'Party Name': p.vendor || p.description?.replace(/Daily (Salary|Bill): /, '') || 'Unknown',
          'Transaction Type': 'Payment-out',
          'Ref No.': (p.id || "").substring(0, 5).toUpperCase(),
          'Amount': p.amount || 0,
          'Payment Type': 'Accrual (Pending)',
          'Paid Amount': p.amount || 0
        });
      });
      
      // Export GST if closing shop
      const metrics = performanceMetrics.get(dayStr);
      if (metrics && !metrics.isClosed && metrics.dayGST > 0) {
        data.push({
          'Date': format(parseISO(dayStr), 'dd/MM/yyyy'),
          'Party Name': 'GST (5%)',
          'Transaction Type': 'Payment-out',
          'Ref No.': 'GST',
          'Amount': metrics.dayGST,
          'Payment Type': 'Accrual (Pending)',
          'Paid Amount': metrics.dayGST
        });
      }
    });

    if (data.length === 0) {
      toast({ title: "No data found", description: "There are no entries to export for this date range." });
      return;
    }

    exportToExcel(data, `Invoices_${format(parseISO(startDate), 'ddMMMyyyy')}_to_${format(parseISO(endDate), 'ddMMMyyyy')}`);
  };

  const handleUpdateGridCell = (day: Date, col: any, value: string) => {
    if (!restaurant || !salesRef || !purchasesRef || !selectedAccountId || col.id === 'gst_accrual' || col.isGroup) return;
    const dayStr = format(day, 'yyyy-MM-dd');
    const amount = parseFloat(value);
    
    const activeId = col.type === 'sales' 
      ? `daily_rev_${dayStr}_${col.id}` 
      : (col.type === 'staff' ? `staff_presence_${dayStr}_${col.id}` : `vendor_bill_${dayStr}_${col.id}`);

    if (value === "" || isNaN(amount)) {
      setSavingId(activeId);
      deleteDocumentNonBlocking(doc(db, 'restaurants', restaurant.id, col.type === 'sales' ? 'salePayments' : 'expenses', activeId));
      setTimeout(() => setSavingId(null), 800);
      return;
    }

    setSavingId(activeId);
    if (col.type === 'sales') {
      const settle = col.accType === 'Cash' ? day : addDays(day, 1);
      setDocumentNonBlocking(doc(salesRef, activeId), { id: activeId, restaurantId: restaurant.id, salesAccountId: col.id, amount, businessDate: dayStr, paymentDate: format(settle, 'yyyy-MM-dd'), paymentTime: col.accType === 'Cash' ? '23:00' : '03:30', paymentMethod: col.name, restaurantMembers: restaurant.members, saleTransactionId: 'daily-ledger' }, { merge: true });
    } else {
      const expenseData: any = { 
        id: activeId, 
        restaurantId: restaurant.id, 
        invoiceDate: dayStr, 
        paymentDate: dayStr, 
        amount, 
        description: `${col.type === 'staff' ? 'Daily Salary' : 'Daily Bill'}: ${col.name}`, 
        accountId: selectedAccountId, 
        restaurantMembers: restaurant.members, 
        partyId: col.type === 'vendor' ? col.id : null, 
        staffId: col.type === 'staff' ? col.id : null, 
        expenseCategoryId: col.type === 'staff' ? 'Salary' : (col.subCategory || 'General'), 
        isAccrual: true, 
        category: col.type === 'staff' ? 'Fixed Cost' : (col.mainCategory || 'Variable Cost'), 
        subCategory: col.type === 'staff' ? 'Salary' : (col.subCategory || 'Other')
      };

      if (col.type === 'staff') {
        expenseData.staffEntryType = 'Regular';
        expenseData.staffUnits = 1;
      }

      setDocumentNonBlocking(doc(purchasesRef, activeId), expenseData, { merge: true });
    }
    setTimeout(() => setSavingId(null), 800);
  };

  const handleUpdateMonthlyReference = (col: any, value: string) => {
    if (!restaurant || !staffRef || !partiesRef) return;
    const amount = parseFloat(value) || 0;
    const ref = col.type === 'staff' ? doc(staffRef, col.id) : doc(partiesRef, col.id);
    const field = col.type === 'staff' ? 'monthlySalary' : 'monthlyAmount';
    
    setSavingId(col.id);
    setDocumentNonBlocking(ref, { [field]: amount }, { merge: true });
    setTimeout(() => setSavingId(null), 800);
  };

  const handleUpsertStaffEntry = (
    dayStr: string, 
    staffId: string, 
    staffName: string,
    monthlySalary: number,
    entryId: string | null,
    data: { amount: number; units: number; type: Expense['staffEntryType']; remark?: string }
  ) => {
    if (!restaurant || !purchasesRef) return;
    
    const units = data.units !== undefined ? data.units : 0;
    const type = data.type || 'Regular';
    const amount = data.amount || 0;

    const id = entryId || (
      type === 'Regular' || type === 'Half Day' 
        ? `staff_presence_${dayStr}_${staffId}` 
        : (type === 'Overtime' ? `staff_ot_${dayStr}_${staffId}` : `staff_other_${dayStr}_${staffId}`)
    );
    
    setSavingId(`${dayStr}_${staffId}`);
    
    setDocumentNonBlocking(doc(purchasesRef, id), {
      id, 
      restaurantId: restaurant.id, 
      staffId: staffId, 
      expenseCategoryId: 'Salary',
      invoiceDate: dayStr, 
      paymentDate: dayStr, 
      description: `${type} Salary: ${staffName}`,
      amount: amount, 
      staffUnits: units,
      staffEntryType: type,
      isAccrual: true, 
      category: 'Fixed Cost', 
      subCategory: 'Salary', 
      vendor: staffName, 
      remark: data.remark || '',
      restaurantMembers: restaurant.members
    }, { merge: true });
    
    if (type === 'Regular' || type === 'Half Day') {
      deleteDocumentNonBlocking(doc(purchasesRef, `staff_accrual_${dayStr}_${staffId}`));
    }

    setTimeout(() => setSavingId(null), 800);
  };

  const handleDeleteStaffEntry = (dayStr: string, staffId: string, entryId: string) => {
    if (!restaurant || !purchasesRef) return;
    setSavingId(`${dayStr}_staffId`);
    deleteDocumentNonBlocking(doc(purchasesRef, entryId));
    setTimeout(() => setSavingId(null), 800);
  };

  const generateWhatsAppSummary = (day: Date) => {
    const dayStr = format(day, 'yyyy-MM-dd');
    const metrics = performanceMetrics.get(dayStr);
    if (!metrics) return "";

    let text = `*Summary - ${format(day, 'dd MMM yyyy')}*\n\n`;
    
    text += `*Revenue*\n`;
    availableColumns.filter(c => c.type === 'sales').forEach(c => {
      const val = gridDataMap.get(`${dayStr}_${c.id}`) || 0;
      if (val > 0) text += `Rs ${val.toLocaleString('en-IN')} (${c.name})   \n`;
    });
    text += `*Rs ${metrics.daySales.toLocaleString('en-IN')} Total revenue*\n\n`;

    text += `*Expenses*\n`;
    availableColumns.filter(c => c.type !== 'sales').forEach(c => {
      const val = getCellValue(dayStr, c);
      if (val > 0) text += `Rs ${val.toLocaleString('en-IN')} ${c.name}   \n`;
    });
    text += `*Rs ${metrics.dayBills.toLocaleString('en-IN')} Total expense*\n\n`;

    const plLabel = metrics.netPL >= 0 ? "Profit" : "Loss";
    text += `*${plLabel}*\n`;
    text += `*Rs ${Math.abs(metrics.netPL).toLocaleString('en-IN')}*`;

    return text;
  };

  const generateMonthlyWhatsAppSummary = () => {
    if (!startDate || !endDate) return "";
    const sStr = format(parseISO(startDate), 'dd MMM');
    const eStr = format(parseISO(endDate), 'dd MMM yyyy');
    let text = `*Summary - ${sStr} to ${eStr}*\n\n`;

    text += `*Revenue*\n`;
    availableColumns.filter(c => c.type === 'sales').forEach(c => {
      const val = totals.colTotals.get(c.id) || 0;
      if (val > 0) {
        const colDiv = elapsedMetrics.colDivisors.get(c.id) || elapsedMetrics.elapsedDays;
        const avg = Math.round(val / colDiv);
        text += `Rs ${val.toLocaleString('en-IN')} (${c.name}) (Avg Rs ${avg.toLocaleString('en-IN')} per day)   \n`;
      }
    });
    const grandRevAvg = Math.round(totals.grandSales / elapsedMetrics.elapsedWorkingDays);
    text += `*Rs ${totals.grandSales.toLocaleString('en-IN')} Total revenue* (Avg Rs ${grandRevAvg.toLocaleString('en-IN')} per day)\n\n`;

    text += `*Expenses*\n`;
    
    availableColumns.filter(c => c.type !== 'sales' && c.id !== 'gst_accrual').forEach(c => {
      if (c.type === 'staff') {
        let periodSalaryAmount = 0;
        let periodSalaryUnits = 0;
        let periodOTAmount = 0;
        let periodOTUnits = 0;

        daysInRange.forEach(day => {
          const dayStr = format(day, 'yyyy-MM-dd');
          if (dayStr < today) {
            const entries = entriesMap.get(`${dayStr}_${c.id}`) || [];
            if (entries.length > 0) {
              entries.forEach(e => {
                const type = e.staffEntryType || 'Regular';
                if (type === 'Regular' || type === 'Half Day') {
                  periodSalaryAmount += (Number(e.amount) || 0);
                  periodSalaryUnits += (Number(e.staffUnits) || (type === 'Regular' ? 1 : 0));
                } else {
                  periodOTAmount += (Number(e.amount) || 0);
                  periodOTUnits += (Number(e.staffUnits) || 0);
                }
              });
            } else if (isColActiveOnDay(c, dayStr)) {
              periodSalaryAmount += Math.round((c.monthlySalary || 0) / 30);
              periodSalaryUnits += 1.0;
            }
          }
        });

        if (periodSalaryUnits > 0 || periodSalaryAmount > 0) {
          const dailyRate = Math.round((c.monthlySalary || 0) / 30);
          text += `Rs ${periodSalaryAmount.toLocaleString('en-IN')} ${c.name} (Rs ${dailyRate}*${periodSalaryUnits} Days)\n`;
        }
        if (periodOTAmount > 0) {
          text += `Rs ${periodOTAmount.toLocaleString('en-IN')} ${c.name} (OT ${periodOTUnits} Units)\n`;
        }
      } else {
        const val = totals.colTotals.get(c.id) || 0;
        if (val > 0) {
          let suffix = "";
          const colDiv = elapsedMetrics.colDivisors.get(c.id) || elapsedMetrics.elapsedDays;
          const isRecurring = c.type === 'staff' || c.mainCategory === 'Fixed Cost';
          
          if (isRecurring) {
            const monthly = c.type === 'staff' ? (c.monthlySalary || 0) : (c.monthlyAmount || 0);
            const dailyRate = Math.round(monthly / 30);
            suffix = ` (Rs ${dailyRate.toLocaleString('en-IN')}*${colDiv} Days)`;
          } else {
            const avg = Math.round(val / colDiv);
            suffix = ` (Avg Rs ${avg.toLocaleString('en-IN')} per day)`;
          }
          text += `Rs ${val.toLocaleString('en-IN')} ${c.name}${suffix}   \n`;
        }
      }
    });

    const gstVal = totals.colTotals.get('gst_accrual') || 0;
    if (gstVal > 0) {
      text += `Rs ${gstVal.toLocaleString('en-IN')} GST (5%)   \n`;
    }

    const grandExpAvg = Math.round(totals.grandBills / elapsedMetrics.elapsedDays);
    text += `*Rs ${totals.grandBills.toLocaleString('en-IN')} Total expense* (Avg Rs ${grandExpAvg.toLocaleString('en-IN')} per day)\n\n`;

    const grandPLAvg = Math.round(totals.grandPL / elapsedMetrics.elapsedDays);
    const plLabel = totals.grandPL >= 0 ? "Profit" : "Loss";
    text += `*Net Profit/Loss*\n`;
    text += `*Rs ${Math.abs(totals.grandPL).toLocaleString('en-IN')}* ${plLabel} (Avg Rs ${Math.abs(grandPLAvg).toLocaleString('en-IN')} per day)`;

    return text;
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setIsCopied(true);
      toast({ title: "Copied to Clipboard!", description: "Summary is ready to paste." });
      setTimeout(() => setIsCopied(false), 2000);
    }).catch(() => {
      toast({ variant: "destructive", title: "Copy Failed", description: "Browser blocked clipboard access." });
    });
  };

  const handleCaptureImage = async (ref: React.RefObject<HTMLDivElement>, filename: string) => {
    if (!ref.current) return;
    setIsCapturing(true);
    try {
      const width = ref.current.scrollWidth;
      const height = ref.current.scrollHeight;

      const dataUrl = await toPng(ref.current, {
        backgroundColor: '#ffffff',
        cacheBust: true,
        fontEmbedCSS: '', 
        pixelRatio: 3, 
        width,
        height,
        style: {
          width: `${width}px`,
          height: `${height}px`,
          transform: 'scale(1)',
          margin: '0',
        }
      });
      const link = document.createElement('a');
      link.download = `${filename}.png`;
      link.href = dataUrl;
      link.click();
      toast({ title: "Image Saved", description: "Report card has been downloaded." });
    } catch (err) {
      toast({ variant: "destructive", title: "Capture Failed", description: "Could not generate image." });
    } finally {
      setIsCapturing(false);
    }
  };

  const handleCopyImage = async (ref: React.RefObject<HTMLDivElement>) => {
    if (!ref.current) return;
    setIsCapturing(true);
    try {
      const width = ref.current.scrollWidth;
      const height = ref.current.scrollHeight;

      const blob = await toBlob(ref.current, {
        backgroundColor: '#ffffff',
        cacheBust: true,
        fontEmbedCSS: '', 
        pixelRatio: 2, 
        width,
        height,
        style: {
          width: `${width}px`,
          height: `${height}px`,
          transform: 'scale(1)',
          margin: '0',
        }
      });
      if (blob) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ]);
        toast({ title: "Image Copied!", description: "You can now paste it in WhatsApp." });
      }
    } catch (err) {
      toast({ variant: "destructive", title: "Copy Failed", description: "Your browser might not support copying images." });
    } finally {
      setIsCapturing(false);
    }
  };

  if (!restaurant) return null;

  return (
    <div className="h-[calc(100vh-theme(spacing.16))] flex flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-1 mb-4 shrink-0">
        {/* Sidebar trigger */}
        <SidebarTrigger />

        {/* Date range picker */}
        <div className="flex items-center gap-2 bg-white px-2 py-1.5 rounded-lg border shadow-sm">
          <div className="flex flex-col">
            <Label className="text-[8px] uppercase font-black text-muted-foreground mb-0.5">Audit Period</Label>
            <div className="flex items-center gap-1">
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-7 text-[10px] w-[100px] font-black" onWheel={(e) => e.currentTarget.blur()} />
              <span className="text-muted-foreground text-[10px] font-bold">–</span>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-7 text-[10px] w-[100px] font-black" onWheel={(e) => e.currentTarget.blur()} />
            </div>
          </div>
          <div className="flex items-center border rounded-md overflow-hidden h-7">
            <Button variant="ghost" size="icon" onClick={() => handleMonthShift(-1)} className="h-7 w-6 border-r rounded-none"><ChevronLeft className="size-3.5" /></Button>
            <Button variant="ghost" size="icon" onClick={() => handleMonthShift(1)} className="h-7 w-6 rounded-none"><ChevronRight className="size-3.5" /></Button>
          </div>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right controls */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-white px-2 py-1.5 rounded-lg border shadow-sm h-9">
            <Switch id="hide-unused" checked={hideUnused} onCheckedChange={setHideUnused} />
            <Label htmlFor="hide-unused" className="text-[9px] font-black uppercase cursor-pointer flex items-center gap-1">
              {hideUnused ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
            </Label>
          </div>
          <Button variant="outline" size="sm" onClick={handleExportExcel} className="h-9 px-3 bg-white shadow-sm font-black text-xs gap-1.5">
            <FileSpreadsheet className="size-3.5 text-emerald-600" /> Export
          </Button>
          <Tabs value={viewMode} onValueChange={(v: any) => setViewMode(v)}>
            <TabsList className="h-9 bg-white border shadow-sm">
              <TabsTrigger value="detailed" className="text-[10px] font-black uppercase h-7">Detailed</TabsTrigger>
              <TabsTrigger value="categorized" className="text-[10px] font-black uppercase h-7">Categorized</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>


      <Dialog open={!!summaryDate} onOpenChange={(o) => !o && setSummaryDate(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="size-5 text-primary" /> Daily Summary
            </DialogTitle>
            <DialogDescription>Review and share your business summary for today.</DialogDescription>
          </DialogHeader>
          {summaryDate && (
            <div className="relative group flex flex-col items-center py-4 bg-muted/5 rounded-xl overflow-hidden">
              <div className="max-h-[400px] overflow-auto w-full px-4 scrollbar-hide flex justify-center">
                <div 
                  ref={dailyCaptureRef}
                  className="flex flex-col pt-10 px-12 pb-20 bg-white rounded-xl border border-dashed font-mono text-xs whitespace-pre leading-relaxed select-all text-slate-900 w-fit shrink-0 h-fit shadow-sm"
                >
                  <div className="mb-6 flex items-center justify-between border-b pb-3 gap-12 shrink-0">
                     <span className="font-bold text-primary text-sm uppercase tracking-tight">{restaurant.name}</span>
                     <span className="text-[10px] text-muted-foreground uppercase font-black tracking-widest">Plate Ledger</span>
                  </div>
                  <div className="pr-20 flex-1">
                    {generateWhatsAppSummary(summaryDate)}
                  </div>
                </div>
              </div>
              <div className="absolute top-6 right-6 md:right-8 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button size="icon" variant="secondary" className="size-8 shadow-sm" onClick={() => handleCopyImage(dailyCaptureRef)} title="Copy Image">
                   <Share2 className="size-3.5" />
                </Button>
                <Button size="icon" variant="secondary" className="size-8 shadow-sm" onClick={() => summaryDate && handleCaptureImage(dailyCaptureRef, `Summary ${format(summaryDate, 'dd MMM yyyy')}`)} title="Download Image">
                   <Download className="size-3.5" />
                </Button>
              </div>
            </div>
          )}
          <DialogFooter className="mt-6 flex flex-wrap gap-2 shrink-0">
            <Button variant="outline" onClick={() => setSummaryDate(null)}>Close</Button>
            <Button variant="secondary" onClick={() => summaryDate && handleCaptureImage(dailyCaptureRef, `Summary ${format(summaryDate, 'dd MMM yyyy')}`)} className="gap-2 font-bold" disabled={isCapturing}>
              {isCapturing ? <Loader2 className="size-4 animate-spin" /> : <ImageIcon className="size-4" />}
              Save Image
            </Button>
            <Button onClick={() => summaryDate && copyToClipboard(generateWhatsAppSummary(summaryDate))} className="gap-2 font-bold flex-1">
              {isCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {isCopied ? "Copied!" : "WhatsApp Text"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog 
        open={showMonthlySummary} 
        onOpenChange={(open) => {
          if (!open && savedDates) {
            setStartDate(savedDates.start);
            setEndDate(savedDates.end);
            setSavedDates(null);
          }
          setShowMonthlySummary(open);
        }}
      >
        <DialogContent className="max-w-2xl flex flex-col max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="size-5 text-primary" /> Period Summary
            </DialogTitle>
            <DialogDescription>Review and share your business summary for the period.</DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4 flex-1 overflow-hidden flex flex-col">
            <div className="p-3 bg-muted/20 rounded-lg border space-y-2">
              <Label className="text-[10px] uppercase font-black text-muted-foreground">Adjust Report Range</Label>
              <div className="flex items-center gap-2">
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-8 text-[10px] font-black" onWheel={(e) => e.currentTarget.blur()} />
                <span className="text-muted-foreground font-bold">to</span>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-8 text-[10px] font-black" onWheel={(e) => e.currentTarget.blur()} />
              </div>
            </div>

            <div className="relative group flex-1 flex flex-col items-center overflow-hidden py-4 bg-muted/5 rounded-xl">
              <div className="overflow-auto w-full px-4 scrollbar-hide flex justify-center">
                <div 
                  ref={monthlyCaptureRef}
                  className="flex flex-col pt-10 px-12 pb-20 bg-white rounded-xl border border-dashed font-mono text-xs whitespace-pre leading-relaxed select-all text-slate-900 w-fit shrink-0 h-fit shadow-sm"
                >
                  <div className="mb-6 flex items-center justify-between border-b pb-3 gap-12 shrink-0">
                     <span className="font-bold text-primary text-sm uppercase tracking-tight">{restaurant.name}</span>
                     <span className="text-[10px] text-muted-foreground uppercase font-black tracking-widest">Plate Ledger</span>
                  </div>
                  <div className="pr-20 flex-1">
                    {generateMonthlyWhatsAppSummary()}
                  </div>
                </div>
              </div>
              <div className="absolute top-6 right-6 md:right-8 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button size="icon" variant="secondary" className="size-8 shadow-sm" onClick={() => handleCopyImage(monthlyCaptureRef)} title="Copy Image">
                   <Share2 className="size-3.5" />
                </Button>
                <Button size="icon" variant="secondary" className="size-8 shadow-sm" onClick={() => handleCaptureImage(monthlyCaptureRef, `Summary ${format(parseISO(startDate), 'dd MMM yyyy')} to ${format(parseISO(endDate), 'dd MMM yyyy')}`)} title="Download Image">
                   <Download className="size-3.5" />
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter className="mt-2 flex flex-wrap gap-2 shrink-0 border-t pt-4">
            <Button variant="outline" onClick={() => setShowMonthlySummary(false)}>Close</Button>
            <Button variant="secondary" onClick={() => handleCaptureImage(monthlyCaptureRef, `Summary ${format(parseISO(startDate), 'dd MMM yyyy')} to ${format(parseISO(endDate), 'dd MMM yyyy')}`)} className="gap-2 font-bold" disabled={isCapturing}>
              {isCapturing ? <Loader2 className="size-4 animate-spin" /> : <ImageIcon className="size-4" />}
              Save Image
            </Button>
            <Button onClick={() => copyToClipboard(generateMonthlyWhatsAppSummary())} className="gap-2 font-bold flex-1">
              {isCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {isCopied ? "Copied!" : "WhatsApp Text"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex-1 rounded-2xl border border-slate-200/80 shadow-2xl overflow-auto relative bg-white">
        <table className="w-max border-separate border-spacing-0">
          <thead>
            {/* ── Row 1: Column headers ─────────────────────────────────────── */}
            <tr>
              <th className="sticky left-0 top-0 z-40 bg-white border-b border-r p-2 text-left w-[110px]">
                <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Date / Status</div>
              </th>
              {activeColumns.map((col) => (
                <th key={col.id} className="sticky top-0 z-30 bg-white border-b border-l p-2 w-[110px]">
                  <div className="flex items-center gap-1.5">
                    <col.icon className={cn("size-3 shrink-0", col.type === 'sales' ? "text-primary" : "text-rose-500")} />
                    <div className="min-w-0">
                      <div className="font-black text-[10px] truncate leading-tight text-slate-800">{col.name}</div>
                      <div className="text-[7px] uppercase tracking-widest text-slate-400 mt-0.5">{col.isGroup ? 'Group' : col.type}</div>
                    </div>
                  </div>
                </th>
              ))}
              <th className="sticky top-0 z-30 bg-emerald-50 border-b border-l p-2 w-[100px]">
                <div className="text-[9px] font-black uppercase tracking-widest text-emerald-600 text-center">Total Sales</div>
              </th>
              <th className="sticky top-0 z-30 bg-rose-50 border-b border-l p-2 w-[100px]">
                <div className="text-[9px] font-black uppercase tracking-widest text-rose-600 text-center">Total Bills</div>
              </th>
              <th className="sticky top-0 z-30 bg-slate-50 border-b border-l p-2 w-[100px]">
                <div className="text-[9px] font-black uppercase tracking-widest text-slate-500 text-center">Net P&L</div>
              </th>
            </tr>

            {/* ── Row 2: Monthly Target ─────────────────────────────────────── */}
            <tr className="sticky top-[40px] z-20">
              <th className="sticky left-0 z-40 bg-slate-50 border-b border-r p-2 text-[8px] font-black uppercase tracking-widest text-slate-400">Monthly Target</th>
              {activeColumns.map((col) => {
                const isEditable = col.type === 'staff' || col.type === 'vendor';
                const val = col.type === 'staff' ? (col.monthlySalary || 0) : (col.monthlyAmount || 0);
                return (
                  <th key={`mr-${col.id}`} className="p-1 border-b border-l text-center bg-slate-50">
                    {isEditable ? (
                      <div className="relative">
                        <Input
                          type="number"
                          className="h-7 text-center border-transparent bg-transparent text-[10px] font-bold tabular-nums focus:bg-white focus:border-slate-200"
                          defaultValue={val || ""}
                          placeholder="—"
                          onBlur={(e) => handleUpdateMonthlyReference(col, e.target.value)}
                          onWheel={(e) => e.currentTarget.blur()}
                        />
                        {savingId === col.id && <Loader2 className="absolute right-1 top-2 size-2 animate-spin text-primary" />}
                      </div>
                    ) : <div className="h-7 flex items-center justify-center text-[10px] font-bold text-slate-300">—</div>}
                  </th>
                )
              })}
              <th className="bg-slate-50 border-b border-l" />
              <th className="bg-slate-50 border-b border-l" />
              <th className="bg-slate-50 border-b border-l" />
            </tr>

            {/* ── Row 3: Daily Average ──────────────────────────────────────── */}
            <tr className="sticky top-[76px] z-20">
              <th className="sticky left-0 z-40 bg-slate-50/95 border-b border-r p-2 text-[8px] font-black uppercase tracking-widest text-slate-400">Daily Average</th>
              {activeColumns.map((col) => {
                let actualTotal = 0;
                if (col.isGroup) col.members.forEach((m: any) => actualTotal += (totals.colTotals.get(m.id) || 0));
                else actualTotal = totals.colTotals.get(col.id) || 0;
                const divisor = elapsedMetrics.colDivisors.get(col.id) || elapsedMetrics.elapsedDays;
                const avg = Math.round(actualTotal / divisor);
                return <th key={`da-${col.id}`} className="p-2 border-b border-l text-center font-bold text-[9px] tabular-nums text-slate-500 bg-slate-50/95">₹{avg.toLocaleString('en-IN')}</th>;
              })}
              <th className="bg-emerald-50/80 border-b border-l p-2 text-center font-bold text-emerald-600 text-[9px] tabular-nums">₹{Math.round(totals.grandSales / elapsedMetrics.elapsedWorkingDays).toLocaleString('en-IN')}</th>
              <th className="bg-rose-50/80 border-b border-l p-2 text-center font-bold text-rose-500 text-[9px] tabular-nums">₹{Math.round(totals.grandBills / elapsedMetrics.elapsedDays).toLocaleString('en-IN')}</th>
              <th className={cn("border-b border-l p-2 text-center font-bold text-[9px] tabular-nums", totals.grandPL >= 0 ? "bg-emerald-50/80 text-emerald-600" : "bg-rose-50/80 text-rose-500")}>₹{Math.round(totals.grandPL / elapsedMetrics.elapsedDays).toLocaleString('en-IN')}</th>
            </tr>
          </thead>
          <tbody>
            {daysInRange.map((day) => {
              const dayStr = format(day, 'yyyy-MM-dd');
              const metrics = performanceMetrics.get(dayStr) || { daySales: 0, dayBills: 0, dayGST: 0, netPL: 0, isClosed: false };
              const isToday = today === dayStr;
              return (
                <tr key={dayStr} className={cn("transition-colors duration-75 group", isToday ? "bg-emerald-50/30" : "hover:bg-slate-50/60", metrics.isClosed && "bg-slate-100/60 opacity-60")}>
                  <td className={cn("sticky left-0 z-20 p-2 border-r border-b", isToday ? "bg-emerald-50/60" : (metrics.isClosed ? "bg-slate-100/80" : "bg-white group-hover:bg-slate-50/60"))}>
                    <div className="flex flex-col leading-tight gap-1">
                      <div className="flex items-baseline gap-1">
                        <span className={cn("text-[11px] font-black tracking-tight", isToday ? "text-emerald-700" : "text-slate-800")}>{format(day, 'dd MMM')}</span>
                        <span className="text-[8px] font-bold uppercase tracking-widest text-slate-400">{format(day, 'EEE')}</span>
                      </div>
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1">
                          <Checkbox id={`closed-${dayStr}`} checked={metrics.isClosed} onCheckedChange={(checked) => toggleShopClosed(day, !!checked)} className="size-3 rounded-full" />
                          <Label htmlFor={`closed-${dayStr}`} className={cn("text-[7px] font-black uppercase tracking-wide cursor-pointer", metrics.isClosed ? "text-rose-500" : "text-slate-400")}>{metrics.isClosed ? "Closed" : "Open"}</Label>
                        </div>
                        <Button variant="ghost" size="icon" className="size-5 text-slate-300 hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => setSummaryDate(day)}>
                          <FileText className="size-3" />
                        </Button>
                      </div>
                    </div>
                  </td>
                  {activeColumns.map((col) => {
                    const val = getCellValue(dayStr, col);
                    const manualEntry = col.type === 'sales' 
                      ? gridDataMap.has(`${dayStr}_${col.id}`) 
                      : entriesMap.has(`${dayStr}_${col.id}`);
                    
                    const isEditable = !col.isGroup && col.id !== 'gst_accrual';
                    const isRecurring = col.type === 'staff' || (col.type === 'vendor' && col.mainCategory === 'Fixed Cost');
                    
                    const defaultValue = isRecurring 
                      ? Math.round((col.type === 'staff' ? col.monthlySalary : (col.monthlyAmount || 0)) / 30)
                      : null;
                    
                    // AUDIT LOGIC: Only mark red if it's recurring and the value differs from system default
                    const isEdited = isRecurring && manualEntry && (Math.round(val) !== defaultValue);
                    
                    if (col.type === 'staff') {
                      const entries = entriesMap.get(`${dayStr}_${col.id}`) || [];
                      const isHalfDay = entries.some(e => e.staffEntryType === 'Half Day');
                      const isOvertime = entries.some(e => e.staffEntryType === 'Overtime');
                      const isSaving = savingId === `${dayStr}_${col.id}`;

                      return (
                        <td key={`${dayStr}-${col.id}`} className={cn("p-1 border-l border-b w-[110px]", (metrics.isClosed && col.type === 'sales') && "bg-muted/10 opacity-30")}>
                          <StaffLedgerCellPopover 
                            dayStr={dayStr} 
                            staff={col} 
                            entries={entries} 
                            onUpsert={(id, data) => handleUpsertStaffEntry(dayStr, col.id, col.name, col.monthlySalary, id, data)}
                            onDelete={(id) => handleDeleteStaffEntry(dayStr, col.id, id)}
                            isDisabled={dayStr > today}
                            isSaving={isSaving}
                          >
                            <div className={cn(
                              "relative flex flex-col items-center justify-center min-h-[40px] cursor-pointer rounded-md transition-all hover:bg-white/80",
                              isEdited ? "bg-red-50 border border-destructive/20" : (val > 0 ? "bg-white/40 border border-primary/10" : "")
                            )}>
                              {isSaving ? (
                                <Loader2 className="size-4 animate-spin text-primary" />
                              ) : (
                                <>
                                  <span className={cn(
                                    "text-xs font-black",
                                    isEdited ? "text-destructive" : (col.type === 'sales' ? "text-primary" : (val > 0 ? "text-slate-900" : "text-muted-foreground opacity-30"))
                                  )}>
                                    {val > 0 || manualEntry ? `₹${Math.round(val).toLocaleString('en-IN')}` : "0"}
                                  </span>
                                  <div className="flex gap-1 mt-0.5">
                                    {isHalfDay && <Badge variant="outline" className="text-[7px] font-black uppercase border-blue-500 text-blue-600 h-3 px-1 leading-none">Half Day</Badge>}
                                    {isOvertime && <Badge variant="outline" className="text-[7px] font-black uppercase border-emerald-500 text-emerald-600 h-3 px-1 leading-none">Overtime</Badge>}
                                  </div>
                                </>
                              )}
                            </div>
                          </StaffLedgerCellPopover>
                        </td>
                      );
                    }

                    return (
                      <td key={`${dayStr}-${col.id}`} className={cn("p-1 border-l border-b w-[110px]", (metrics.isClosed && col.type === 'sales') && "opacity-20")}>
                        {isEditable ? (
                          <div className={cn(
                            "relative rounded-lg transition-all",
                            isEdited ? "bg-rose-50 ring-1 ring-rose-200" : ""
                          )}>
                            <Input
                              type="number"
                              className={cn(
                                "h-9 text-center border-transparent bg-transparent text-[11px] font-bold tabular-nums focus:bg-white focus:shadow-sm",
                                isEdited ? "text-rose-600" : (col.type === 'sales' ? "text-emerald-700" : "text-slate-700")
                              )}
                              defaultValue={gridDataMap.get(`${dayStr}_${col.id}`) !== undefined ? String(gridDataMap.get(`${dayStr}_${col.id}`)) : ""}
                              placeholder={val > 0 ? String(val) : "—"}
                              onBlur={(e) => handleUpdateGridCell(day, col, e.target.value)}
                              onWheel={(e) => e.currentTarget.blur()}
                              disabled={dayStr > today || (metrics.isClosed && col.type === 'sales')}
                            />
                            {savingId === (col.type === 'sales' ? `daily_rev_${dayStr}_${col.id}` : (col.type === 'staff' ? `staff_presence_${dayStr}_${col.id}` : `vendor_bill_${dayStr}_${col.id}`)) && <Loader2 className="absolute right-1 top-3 size-2.5 animate-spin text-primary" />}
                          </div>
                        ) : <div className={cn("h-9 flex items-center justify-center text-[11px] font-bold tabular-nums", (col.type === 'sales' || col.category === 'Revenue') ? "text-emerald-700" : "text-slate-700")}>{val > 0 ? `₹${val.toLocaleString('en-IN')}` : <span className="text-slate-200">—</span>}</div>}
                      </td>
                    );
                  })}
                  <td className="border-l border-b bg-emerald-50/60 text-center font-black tabular-nums text-[11px] text-emerald-700 px-2">₹{metrics.daySales.toLocaleString('en-IN')}</td>
                  <td className="border-l border-b bg-rose-50/60 text-center font-black tabular-nums text-[11px] text-rose-600 px-2">₹{metrics.dayBills.toLocaleString('en-IN')}</td>
                  <td className={cn("border-l border-b text-center font-black tabular-nums text-[11px] px-2", metrics.netPL >= 0 ? "bg-emerald-50/40 text-emerald-700" : "bg-rose-50/40 text-rose-600")}>₹{metrics.netPL.toLocaleString('en-IN')}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="sticky bottom-0 z-30">
            <tr className="bg-white border-t-2 border-slate-100 shadow-[0_-4px_12px_-2px_rgba(0,0,0,0.08)]">
              <td className="sticky left-0 z-40 bg-slate-50 border-r border-t p-2">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Total Sum</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-5 text-slate-400 hover:text-primary"
                    onClick={() => {
                      setSavedDates({ start: startDate, end: endDate });
                      const now = new Date();
                      const start = format(startOfMonth(now), 'yyyy-MM-dd');
                      const yesterday = format(subDays(now, 1), 'yyyy-MM-dd');
                      setStartDate(start);
                      setEndDate(yesterday);
                      setShowMonthlySummary(true);
                    }}
                  >
                    <FileText className="size-3" />
                  </Button>
                </div>
              </td>
              {activeColumns.map((col) => {
                let totalVal = 0;
                if (col.isGroup) col.members.forEach((m: any) => totalVal += (totals.colTotals.get(m.id) || 0));
                else totalVal = totals.colTotals.get(col.id) || 0;
                return <td key={`total-${col.id}`} className="border-l border-t p-2 text-center bg-white"><div className={cn("font-black text-[11px] tabular-nums", (col.type === 'sales' || col.category === 'Revenue') ? "text-emerald-700" : "text-rose-600")}>₹{totalVal.toLocaleString('en-IN')}</div></td>;
              })}
              <td className="border-l border-t bg-emerald-50 p-2 text-center font-black tabular-nums text-emerald-700 text-[12px]">₹{totals.grandSales.toLocaleString('en-IN')}</td>
              <td className="border-l border-t bg-rose-50 p-2 text-center font-black tabular-nums text-rose-600 text-[12px]">₹{totals.grandBills.toLocaleString('en-IN')}</td>
              <td className={cn("border-l border-t p-2 text-center font-black tabular-nums text-[12px]", totals.grandPL >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600")}>₹{totals.grandPL.toLocaleString('en-IN')}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

function StaffLedgerCellPopover({ 
  children, 
  dayStr, 
  staff, 
  entries, 
  onUpsert, 
  onDelete, 
  isDisabled,
  isSaving 
}: { 
  children: React.ReactNode; 
  dayStr: string; 
  staff: any; 
  entries: Expense[];
  onUpsert: (id: string | null, data: any) => void;
  onDelete: (id: string) => void;
  isDisabled: boolean;
  isSaving: boolean;
}) {
  const [isOpen, setOpen] = useState(false);
  const dailyRate = Math.round((staff.monthlySalary || 0) / 30);
  const halfDailyRate = Math.round(dailyRate / 2);

  const regularEntry = entries.find(e => e.staffEntryType === 'Regular');
  const overtimeEntry = entries.find(e => e.staffEntryType === 'Overtime');
  const halfDayEntry = entries.find(e => e.staffEntryType === 'Half Day');
  const leaveEntry = entries.find(e => e.staffEntryType === 'Other');

  const [activeTab, setActiveTab] = useState<string>("overtime");
  const [regAmount, setRegAmount] = useState<string>(String(regularEntry?.amount || dailyRate));
  const [otAmount, setOtAmount] = useState<string>(String(overtimeEntry?.amount || ""));
  const [otRemark, setOtRemark] = useState<string>(overtimeEntry?.remark || "");
  const [hdAmount, setHdAmount] = useState<string>(String(halfDayEntry?.amount || halfDailyRate));
  const [hdRemark, setHdRemark] = useState<string>(halfDayEntry?.remark || "");
  const [leaveRemark, setLeaveRemark] = useState<string>(leaveEntry?.remark?.replace('Leave: ', '') || "");

  useEffect(() => {
    if (isOpen) {
      if (halfDayEntry) setActiveTab("half-day");
      else if (leaveEntry) setActiveTab("leave");
      else setActiveTab("overtime");

      setRegAmount(String(regularEntry?.amount || dailyRate));
      setOtAmount(String(overtimeEntry?.amount || ""));
      setOtRemark(overtimeEntry?.remark || "");
      setHdAmount(String(halfDayEntry?.amount || halfDailyRate));
      setHdRemark(halfDayEntry?.remark || "");
      setLeaveRemark(leaveEntry?.remark?.replace('Leave: ', '') || "");
    }
  }, [isOpen, entries, dailyRate, halfDailyRate, regularEntry, overtimeEntry, halfDayEntry, leaveEntry]);

  if (isDisabled) return <div className="opacity-30 cursor-not-allowed">{children}</div>;

  const handleSave = () => {
    if (activeTab === 'overtime') {
      onUpsert(regularEntry?.id || null, { 
        type: 'Regular', 
        units: 1, 
        amount: parseFloat(regAmount) || dailyRate 
      });
      const otVal = parseFloat(otAmount);
      if (otVal > 0) {
        onUpsert(overtimeEntry?.id || null, { 
          type: 'Overtime', 
          units: 0, 
          amount: otVal, 
          remark: otRemark 
        });
      } else if (overtimeEntry) {
        onDelete(overtimeEntry.id);
      }
      entries.filter(e => e.staffEntryType === 'Half Day' || e.staffEntryType === 'Other').forEach(e => onDelete(e.id));
    } else if (activeTab === 'half-day') {
      onUpsert(halfDayEntry?.id || null, { 
        type: 'Half Day', 
        units: 0.5, 
        amount: parseFloat(hdAmount) || halfDailyRate,
        remark: hdRemark
      });
      entries.filter(e => e.staffEntryType !== 'Half Day').forEach(e => onDelete(e.id));
    } else if (activeTab === 'leave') {
      onUpsert(leaveEntry?.id || null, {
        type: 'Other',
        units: 0,
        amount: 0,
        remark: `Leave: ${leaveRemark}`
      });
      entries.filter(e => e.staffEntryType !== 'Other').forEach(e => onDelete(e.id));
    }
    setOpen(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="max-w-md p-0 shadow-2xl border-primary/20 overflow-hidden rounded-3xl border-none">
        <DialogHeader className="hidden">
          <DialogTitle>Staff Attendance - {staff.name}</DialogTitle>
          <DialogDescription>Record overtime, half-days, or leave for {format(parseISO(dayStr), 'dd MMM yyyy')}</DialogDescription>
        </DialogHeader>
        
        <div className="bg-[#00263b] text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-2xl bg-white/10 flex items-center justify-center">
              <User className="size-5 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-black uppercase tracking-widest">{staff.name}</span>
              <span className="text-[10px] text-white/60 font-bold uppercase">Rate: ₹{dailyRate}/day</span>
            </div>
          </div>
          <div className="text-xs font-black text-white/60 uppercase">
            {format(parseISO(dayStr), 'dd MMM yyyy')}
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full grid grid-cols-3 h-12 rounded-none bg-muted/20 border-b p-0">
            <TabsTrigger value="overtime" className="rounded-none text-[10px] font-black uppercase h-full data-[state=active]:bg-white data-[state=active]:text-primary border-r">Overtime</TabsTrigger>
            <TabsTrigger value="half-day" className="rounded-none text-[10px] font-black uppercase h-full data-[state=active]:bg-white data-[state=active]:text-primary border-r">Half Day</TabsTrigger>
            <TabsTrigger value="leave" className="rounded-none text-[10px] font-black uppercase h-full data-[state=active]:bg-white data-[state=active]:text-destructive">Leave</TabsTrigger>
          </TabsList>

          <div className="p-6 space-y-6 bg-white min-h-[220px]">
            <TabsContent value="overtime" className="mt-0 space-y-6">
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Regular Salary (₹)</Label>
                <Input 
                  type="number" 
                  className="h-12 font-black text-lg bg-muted/10 border-dashed" 
                  value={regAmount} 
                  onChange={(e) => setRegAmount(e.target.value)}
                />
              </div>
              <Separator />
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-primary tracking-widest">OT Amount (₹)</Label>
                  <Input 
                    type="number" 
                    className="h-12 font-black text-lg border-primary/20 bg-primary/[0.02]" 
                    value={otAmount} 
                    onChange={(e) => setOtAmount(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">OT Remark</Label>
                  <Input 
                    className="h-12 text-xs font-bold" 
                    value={otRemark} 
                    onChange={(e) => setOtRemark(e.target.value)}
                    placeholder="e.g. 4 hrs extra"
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="half-day" className="mt-0 space-y-6">
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase text-blue-600 tracking-widest">Half Day Pay (₹)</Label>
                <Input 
                  type="number" 
                  className="h-12 font-black text-lg border-blue-200 bg-blue-50/30" 
                  value={hdAmount} 
                  onChange={(e) => setHdAmount(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Comment</Label>
                <Input 
                  className="h-12 text-xs font-bold" 
                  value={hdRemark} 
                  onChange={(e) => setHdRemark(e.target.value)}
                  placeholder="e.g. Left early"
                />
              </div>
            </TabsContent>

            <TabsContent value="leave" className="mt-0 space-y-6">
              <div className="p-6 rounded-2xl border-2 border-dashed border-destructive/20 bg-destructive/[0.02] flex items-center justify-center gap-3">
                <Badge variant="destructive" className="font-black text-xs px-3 h-7">ABSENT</Badge>
                <span className="text-xs font-black text-destructive uppercase tracking-widest">Marked as Leave</span>
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Leave Reason</Label>
                <Input 
                  className="h-12 text-xs font-bold border-destructive/10" 
                  value={leaveRemark} 
                  onChange={(e) => setLeaveRemark(e.target.value)}
                  placeholder="e.g. Family function"
                />
              </div>
            </TabsContent>
          </div>
        </Tabs>

        <div className="p-6 border-t bg-slate-50 space-y-4">
          <Button 
            className="w-full h-14 gap-2 font-black text-sm uppercase shadow-xl bg-[#00263b] hover:bg-[#00263b]/90 text-white rounded-2xl active:scale-[0.98] transition-all"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? <Loader2 className="size-5 animate-spin" /> : <Save className="size-5" />}
            Save Entry Details
          </Button>
          <div className="flex items-center justify-between px-2">
            <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Total Daily Accrual</p>
            <p className="text-xl font-black text-primary">
              ₹{( (activeTab === 'overtime' ? (parseFloat(regAmount) || 0) + (parseFloat(otAmount) || 0) : (activeTab === 'half-day' ? (parseFloat(hdAmount) || 0) : 0)) ).toLocaleString()}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
