
"use client"

import { useState, useMemo, useRef, useEffect } from "react"
import Image from "next/image"
import { useRouter, useSearchParams } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { 
  Plus, 
  Minus, 
  X, 
  Loader2, 
  UtensilsCrossed, 
  Wallet, 
  CheckCircle2, 
  ShoppingCart, 
  Search,
  Trash2,
  Lock,
  Zap,
  ArrowLeft,
  Menu,
  ReceiptText,
  History,
  Scale,
  Settings2,
  LayoutGrid,
  Check,
  ArrowUpDown,
  Power
} from "lucide-react"
import { useActiveRestaurant } from "@/hooks/use-active-restaurant"
import { useCollection, useMemoFirebase, useFirestore, useDoc } from "@/firebase"
import { collection, doc } from "firebase/firestore"
import { setDocumentNonBlocking } from "@/firebase/non-blocking-updates"
import { MenuItem, OrderItem, SaleOrder, POSMethod } from "@/lib/types"
import { format } from "date-fns"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { SortableMenuItem } from "@/components/pos/sortable-menu-item"
import { Switch } from "@/components/ui/switch"

// DND Kit Imports
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  TouchSensor,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from '@dnd-kit/sortable';

const DEFAULT_CATEGORIES = ["Starters", "Main Course", "Fast Food", "Drinks", "Desserts", "Sides"];

interface POSSession {
  id: string;
  name: string;
  cart: OrderItem[];
  createdAt: number;
  dailySrNo: number;
  sourceOrderId?: string;
  originalMethodId?: string;
}

export default function POSPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { restaurant } = useActiveRestaurant()
  const db = useFirestore()
  const { toast } = useToast()
  
  const [sessions, setSessions] = useState<POSSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string>("")
  
  const [activeCategory, setActiveCategory] = useState("All Items")
  const [searchQuery, setSearchQuery] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showBill, setShowBill] = useState(false)
  const [lastBillId, setLastBillId] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)

  // Layout Settings State
  const [layoutCols, setLayoutCols] = useState(4)
  const [layoutRows, setLayoutRows] = useState(2)
  const [showLayoutSettings, setShowLayoutSettings] = useState(false)
  const [isReorderMode, setIsReorderMode] = useState(false)

  // Drag and Drop Local Order State
  const [localMenu, setLocalMenu] = useState<MenuItem[]>([])

  // Admin Access State
  const [showAdminLock, setShowAdminLock] = useState(false)
  const [adminPasscode, setAdminPasscode] = useState(['', '', '', ''])
  const [lockError, setLockError] = useState("")
  const pinRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)]

  const printRef = useRef<HTMLDivElement>(null)

  // Edit logic
  const editId = searchParams.get('edit')
  const editOrderRef = useMemoFirebase(() => 
    (restaurant && editId) ? doc(db, 'restaurants', restaurant.id, 'orders', editId) : null
  , [db, restaurant?.id, editId]);
  const { data: editOrderData } = useDoc<SaleOrder>(editOrderRef);

  useEffect(() => {
    setMounted(true)
  }, [])

  const menuRef = useMemoFirebase(() => 
    restaurant ? collection(db, 'restaurants', restaurant.id, 'menuItems') : null
  , [db, restaurant?.id]);

  const posMethodsRef = useMemoFirebase(() => 
    restaurant ? collection(db, 'restaurants', restaurant.id, 'posMethods') : null
  , [db, restaurant?.id]);

  const ordersRef = useMemoFirebase(() => 
    restaurant ? collection(db, 'restaurants', restaurant.id, 'orders') : null
  , [db, restaurant?.id]);

  const { data: menu } = useCollection<MenuItem>(menuRef);
  const { data: posMethods } = useCollection<POSMethod>(posMethodsRef);
  const { data: allOrders } = useCollection<SaleOrder>(ordersRef);

  // Sync local menu with DB menu, sorted by sortOrder
  useEffect(() => {
    if (menu) {
      const sorted = [...menu].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      setLocalMenu(sorted);
    }
  }, [menu]);

  const todayStr = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);
  
  const todayRecords = useMemo(() => {
    return (allOrders || []).filter(o => o.date === todayStr);
  }, [allOrders, todayStr]);

  const todayTotalSales = useMemo(() => {
    return todayRecords.filter(o => o.isActive !== false).reduce((sum, o) => sum + (o.total || 0), 0);
  }, [todayRecords]);

  const nextCalculatedSr = useMemo(() => {
    const processedMax = Math.max(...todayRecords.map(o => o.dailySrNo || 0), 0);
    const baseCount = (processedMax === 0 && todayRecords.length > 0) 
      ? todayRecords.filter(o => o.isActive !== false).length 
      : processedMax;

    const sessionMax = Math.max(...sessions.map(s => s.dailySrNo || 0), 0);
    return Math.max(baseCount, sessionMax) + 1;
  }, [todayRecords, sessions]);

  useEffect(() => {
    if (allOrders && sessions.length === 0 && !editId) {
      const initialId = `order-${Date.now()}`;
      const firstSession: POSSession = {
        id: initialId,
        name: `Order #${nextCalculatedSr}`,
        cart: [],
        createdAt: Date.now(),
        dailySrNo: nextCalculatedSr
      };
      setSessions([firstSession]);
      setActiveSessionId(initialId);
    }
  }, [allOrders, sessions.length, nextCalculatedSr, editId]);

  useEffect(() => {
    if (editOrderData && !sessions.find(s => s.sourceOrderId === editOrderData.id)) {
      const newId = `edit-${editOrderData.id}-${Date.now()}`;
      const editSession: POSSession = {
        id: newId,
        name: `Edit Bill #${editOrderData.billNumber}`,
        cart: editOrderData.items,
        createdAt: Date.now(),
        dailySrNo: editOrderData.dailySrNo || nextCalculatedSr,
        sourceOrderId: editOrderData.id,
        originalMethodId: editOrderData.posMethodId
      };
      setSessions(prev => [editSession, ...prev]);
      setActiveSessionId(newId);
      toast({ description: `Reloaded Bill #${editOrderData.billNumber} for modification.` });
    }
  }, [editOrderData, sessions, nextCalculatedSr, toast]);

  const categories = useMemo(() => {
    const customCats = restaurant?.menuCategories && restaurant.menuCategories.length > 0 
      ? restaurant.menuCategories 
      : DEFAULT_CATEGORIES;
    return ["All Items", ...customCats];
  }, [restaurant]);

  const activePOSMethods = useMemo(() => {
    return posMethods?.filter(m => m.isActive) || [];
  }, [posMethods]);

  const activeSession = useMemo(() => 
    sessions.find(s => s.id === activeSessionId) || sessions[0]
  , [sessions, activeSessionId]);

  const calculateSessionTotal = (cart: OrderItem[]) => {
    let total = 0;
    cart.forEach(item => {
      const lineTotal = item.price * item.quantity;
      if (item.gstIncluded) {
        total += lineTotal;
      } else {
        total += lineTotal * 1.05;
      }
    });
    return Math.round(total);
  };

  const filteredMenu = useMemo(() => {
    return localMenu.filter(item => {
      const matchesCat = activeCategory === "All Items" || item.category === activeCategory;
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
      return item.isAvailable && matchesCat && matchesSearch;
    });
  }, [localMenu, activeCategory, searchQuery]);

  const calculations = useMemo(() => {
    const currentCart = activeSession?.cart || [];
    let grandSubtotal = 0;
    let grandCgst = 0;
    let grandSgst = 0;
    let grandTotal = 0;

    currentCart.forEach(item => {
      const lineTotal = item.price * item.quantity;
      if (item.gstIncluded) {
        const lineBase = lineTotal / 1.05;
        const lineTax = lineTotal - lineBase;
        grandSubtotal += lineBase;
        grandCgst += lineTax / 2;
        grandSgst += lineTax / 2;
        grandTotal += lineTotal;
      } else {
        const lineBase = lineTotal;
        const lineTax = lineBase * 0.05;
        grandSubtotal += lineBase;
        grandCgst += lineTax / 2;
        grandSgst += lineTax / 2;
        grandTotal += lineBase + lineTax;
      }
    });

    return {
      subtotal: grandSubtotal,
      cgst: grandCgst,
      sgst: grandSgst,
      total: Math.round(grandTotal),
      itemCount: currentCart.reduce((sum, item) => sum + item.quantity, 0)
    };
  }, [activeSession?.cart]);

  // Sensors for Drag and Drop
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = localMenu.findIndex((i) => i.id === active.id);
    const newIndex = localMenu.findIndex((i) => i.id === over.id);
    
    if (oldIndex !== -1 && newIndex !== -1) {
      const newArray = arrayMove(localMenu, oldIndex, newIndex);
      setLocalMenu(newArray);
      
      // Update DB only at end of drag
      if (restaurant) {
        newArray.forEach((item, idx) => {
          if (item.sortOrder !== idx) {
            setDocumentNonBlocking(doc(db, 'restaurants', restaurant.id, 'menuItems', item.id), {
              sortOrder: idx
            }, { merge: true });
          }
        });
      }
    }
  };

  const handleAdminPinChange = (index: number, value: string) => {
    if (value.length > 1) value = value.slice(-1)
    if (!/^\d*$/.test(value)) return
    const newPasscode = [...adminPasscode]
    newPasscode[index] = value
    setAdminPasscode(newPasscode)
    if (value && index < 3) pinRefs[index + 1].current?.focus()
  }

  const handleAdminUnlock = () => {
    const entered = adminPasscode.join('')
    if (entered === restaurant?.passcode) {
      router.push('/')
    } else {
      setLockError("Invalid Admin Passcode")
      setAdminPasscode(['', '', '', ''])
      pinRefs[0].current?.focus()
    }
  }

  const addNewOrder = () => {
    if (isReorderMode) return;
    const newId = `order-${Date.now()}`
    const newSession: POSSession = {
      id: newId,
      name: `Order #${nextCalculatedSr}`,
      cart: [],
      createdAt: Date.now(),
      dailySrNo: nextCalculatedSr
    }
    setSessions([newSession, ...sessions]);
    setActiveSessionId(newId)
    toast({ description: "New order tab opened." })
  }

  const closeSession = (id: string, e?: React.MouseEvent) => {
    if (isReorderMode) return;
    if (e) e.stopPropagation();
    if (sessions.length <= 1) {
      const resetId = `order-${Date.now()}`;
      setSessions([{
        id: resetId,
        name: `Order #${nextCalculatedSr}`,
        cart: [],
        createdAt: Date.now(),
        dailySrNo: nextCalculatedSr
      }]);
      setActiveSessionId(resetId);
      return;
    }
    const newSessions = sessions.filter(s => s.id !== id)
    setSessions(newSessions)
    if (activeSessionId === id) {
      setActiveSessionId(newSessions[0].id)
    }
  }

  const addToCart = (item: MenuItem) => {
    if (!activeSessionId || isReorderMode) return;
    setSessions(prev => prev.map(s => {
      if (s.id !== activeSessionId) return s;
      const existing = s.cart.find(i => i.itemId === item.id);
      if (existing) {
        return {
          ...s,
          cart: s.cart.map(i => i.itemId === item.id ? { ...i, quantity: i.quantity + 1 } : i)
        }
      }
      return {
        ...s,
        cart: [...s.cart, { 
          itemId: item.id, 
          name: item.name, 
          price: item.price, 
          quantity: 1, 
          gstIncluded: item.gstIncluded ?? true,
          imageUrl: item.imageUrl 
        }]
      }
    }))
  };

  const updateQty = (itemId: string, delta: number) => {
    if (isReorderMode) return;
    setSessions(prev => prev.map(s => {
      if (s.id !== activeSessionId) return s;
      return {
        ...s,
        cart: s.cart.map(i => {
          if (i.itemId === itemId) {
            return { ...i, quantity: Math.max(0, i.quantity + delta) };
          }
          return i;
        }).filter(i => i.quantity > 0)
      }
    }))
  };

  const clearCart = () => {
    if (isReorderMode) return;
    setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, cart: [], sourceOrderId: undefined, originalMethodId: undefined } : s))
  }

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow || !printRef.current) return;

    const content = printRef.current.innerHTML;
    printWindow.document.write(`
      <html>
        <head>
          <title>POS Receipt</title>
          <style>
            @page { margin: 0; }
            body { 
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              width: 80mm; 
              padding: 5mm; 
              margin: 0;
              font-size: 13px;
              line-height: 1.6;
              color: #000;
            }
            .text-center { text-align: center; }
            .text-right { text-align: right; }
            .font-bold { font-weight: bold; }
            .divider { border-bottom: 1px dashed #000; margin: 12px 0; }
            .section-divider { page-break-after: always; break-after: page; margin: 0; padding: 0; border: none; }
            table { width: 100%; border-collapse: collapse; margin: 0; }
            th { text-align: left; padding: 8px 0; font-weight: bold; }
            td { padding: 6px 0; vertical-align: top; }
            .item-col { width: 40%; text-align: left; }
            .qty-col { width: 12%; text-align: right; }
            .price-col { width: 24%; text-align: right; }
            .amt-col { width: 24%; text-align: right; }
            .total-row { font-size: 16px; font-weight: bold; padding: 10px 0; }
            .token-header { font-size: 20px; font-weight: bold; border: 2px solid #000; padding: 10px; display: inline-block; margin-bottom: 20px; }
            .kitchen-item { font-size: 15px; font-weight: bold; }
            .metadata-row { display: flex; justify-content: space-between; margin: 15px 0; }
            .tax-row td { padding: 3px 0; text-align: right; }
          </style>
        </head>
        <body onload="window.print();window.close()">
          ${content}
        </body>
      </html>
    `);
    printWindow.document.close();
    
    const sessionIdToClose = activeSessionId;
    setShowBill(false);
    closeSession(sessionIdToClose);
  };

  const handleProcessBill = (methodId: string) => {
    if (!restaurant || !activeSession || !methodId || !activeSession.cart.length) return;
    setIsSubmitting(true);

    const isEditing = !!activeSession.sourceOrderId;
    const billId = isEditing && editOrderData ? editOrderData.billNumber : `BILL-${Date.now().toString().slice(-6)}`;
    const now = new Date();
    const dateStr = isEditing && editOrderData ? editOrderData.date : format(now, 'yyyy-MM-dd');
    const timeStr = format(now, 'HH:mm');

    const selectedMethod = activePOSMethods.find(m => m.id === methodId);

    if (isEditing && activeSession.sourceOrderId) {
      const oldRef = doc(db, 'restaurants', restaurant.id, 'orders', activeSession.sourceOrderId);
      setDocumentNonBlocking(oldRef, { 
        isActive: false, 
        auditStatus: 'edited',
        updatedAt: format(new Date(), 'yyyy-MM-dd HH:mm:ss')
      }, { merge: true });
    }

    const newDocId = doc(collection(db, 'restaurants', restaurant.id, 'orders')).id;
    const orderData: any = {
      id: newDocId,
      restaurantId: restaurant.id,
      billNumber: billId,
      dailySrNo: activeSession.dailySrNo,
      date: dateStr,
      time: timeStr,
      items: activeSession.cart,
      subtotal: calculations.subtotal,
      tax: calculations.cgst + calculations.sgst,
      total: calculations.total,
      paymentMethod: selectedMethod?.name || 'Manual',
      posMethodId: methodId,
      restaurantMembers: restaurant.members,
      status: 'completed',
      isSettled: false,
      isActive: true,
      auditStatus: 'active',
      updatedAt: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
    };

    if (activeSession.sourceOrderId) {
      orderData.previousVersionId = activeSession.sourceOrderId;
    }

    setDocumentNonBlocking(doc(db, 'restaurants', restaurant.id, 'orders', newDocId), orderData, { merge: true });

    setLastBillId(billId);
    setShowBill(true);

    // Open cash drawer via Electron IPC (no-op in browser)
    if (typeof window !== 'undefined' && (window as any).electronAPI) {
      (window as any).electronAPI.openCashDrawer();
    }

    setTimeout(() => {
      handlePrint();
      setIsSubmitting(false);
    }, 500);
  };

  if (!restaurant) return null;

  return (
    <div className="h-screen flex flex-col overflow-hidden user-select-none bg-[#f8f9fa] -m-2">
      <header className="shrink-0 bg-white border-b flex flex-col z-10 shadow-sm">
        <div className="h-14 flex items-center justify-between px-4 md:px-6 border-b border-slate-50">
          <div className="flex items-center gap-4 flex-1">
            <Button 
              variant="outline" 
              onClick={() => setShowAdminLock(true)}
              className="h-10 px-4 gap-2 border-primary text-primary font-bold text-xs rounded-xl hover:bg-primary/5 transition-all shrink-0"
            >
              <Lock className="size-4" />
              <span>Admin Panel</span>
            </Button>
<div className="relative flex-1 max-w-[240px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input 
                placeholder="Search..." 
                className="w-full h-9 pl-10 rounded-full bg-muted/50 border-none text-xs font-medium" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            {/* Sorting Toggle moved back to main header */}
            <Button 
              variant={isReorderMode ? "default" : "outline"} 
              onClick={() => setIsReorderMode(!isReorderMode)}
              className={cn(
                "h-10 px-4 gap-2 font-bold text-[10px] uppercase rounded-xl transition-all",
                isReorderMode ? "bg-amber-500 hover:bg-amber-600 border-none text-white shadow-lg animate-pulse" : "border-amber-200 text-amber-700 hover:bg-amber-50"
              )}
            >
              <ArrowUpDown className="size-4" />
              <span>{isReorderMode ? "Finish Sorting" : "Sort Menu"}</span>
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
                <DropdownMenuItem className="rounded-xl h-11 cursor-pointer font-bold gap-3 focus:bg-primary/10 focus:text-primary">
                  <ReceiptText className="size-4 text-primary" /> Billing Console
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push('/pos/bills')} className="rounded-xl h-11 cursor-pointer font-bold gap-3">
                  <History className="size-4" /> Sequential Log
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push('/revenue')} className="rounded-xl h-11 cursor-pointer font-bold gap-3">
                  <Scale className="size-4" /> Settlement
                </DropdownMenuItem>
                <DropdownMenuSeparator className="my-2" />
                <DropdownMenuItem onClick={() => setShowLayoutSettings(true)} className="rounded-xl h-11 cursor-pointer font-bold gap-3">
                  <Settings2 className="size-4 text-accent" /> Layout Config
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="flex items-center gap-3">
              <div className="flex flex-col items-end">
                <span className="text-[8px] uppercase font-black text-muted-foreground tracking-widest leading-none">Today</span>
                <span className="text-xs font-black text-primary uppercase">Rs {todayTotalSales.toLocaleString('en-IN')}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="h-12 px-4 md:px-6 flex items-center gap-2 overflow-x-auto no-scrollbar bg-slate-50/50 border-b relative">
          <Button 
            onClick={addNewOrder}
            variant="outline"
            className="h-9 gap-2 border-dashed border-primary/40 text-primary font-bold text-[10px] rounded-xl hover:bg-primary/10 hover:text-primary shrink-0 bg-white shadow-sm px-4"
            disabled={isReorderMode}
          >
            <Plus className="size-3.5" />
            <span className="uppercase">Open Tab</span>
          </Button>

          {sessions.map((session) => {
            const sessionTotal = calculateSessionTotal(session.cart);
            const isActive = activeSessionId === session.id;
            
            return (
              <div 
                key={session.id}
                onClick={() => !isReorderMode && setActiveSessionId(session.id)}
                className={cn(
                  "h-9 px-3 flex items-center justify-between rounded-xl border transition-all select-none group min-w-[140px] max-w-[200px] relative shrink-0",
                  isActive 
                    ? "bg-[#00263b] border-transparent text-white shadow-lg" 
                    : "bg-white border-slate-200 text-muted-foreground hover:border-slate-300 shadow-sm",
                  session.sourceOrderId && !isActive && "border-amber-200 bg-amber-50/30",
                  isReorderMode ? "cursor-not-allowed opacity-50" : "cursor-pointer"
                )}
              >
                <div className="flex flex-col overflow-hidden max-w-[65%]">
                  <span className={cn("text-[7px] font-black uppercase leading-none", isActive ? "text-white/60" : "text-muted-foreground/60")}>Sr #{session.dailySrNo}</span>
                  <span className={cn("text-[10px] font-black truncate w-full leading-tight uppercase mt-0.5", isActive ? "text-white" : "text-slate-900")}>{session.name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={cn("text-[10px] font-black", isActive ? "text-white" : "text-primary")}>₹{sessionTotal}</span>
                  {!isReorderMode && (
                    <button 
                      onClick={(e) => closeSession(session.id, e)}
                      className={cn(
                        "opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity size-4 rounded-full flex items-center justify-center",
                        isActive ? "bg-white/10 text-white" : "bg-muted text-muted-foreground"
                      )}
                    >
                      <X className="size-2.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          
          {isReorderMode && (
            <div className="absolute inset-0 z-10 bg-white/10 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
              <Badge variant="secondary" className="bg-amber-500 text-white font-black text-[8px] uppercase tracking-widest gap-1 shadow-md">
                <Lock className="size-2.5" /> Tabs Locked for Sorting
              </Badge>
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <section className="flex-1 flex flex-col bg-[#f8f9fa] overflow-hidden">
          <div className="px-4 md:px-6 pt-3 pb-1 shrink-0">
            <ScrollArea className="w-full whitespace-nowrap">
              <div className="flex gap-2 pb-2">
                {categories.map(cat => (
                  <Button 
                    key={cat} 
                    variant="ghost"
                    onClick={() => !isReorderMode && setActiveCategory(cat)}
                    disabled={isReorderMode && activeCategory !== cat}
                    className={cn(
                      "h-9 px-4 rounded-xl font-black text-[10px] uppercase tracking-wider transition-all border-2",
                      activeCategory === cat 
                        ? "bg-[#00263b] text-white shadow-lg border-transparent" 
                        : "bg-white text-muted-foreground border-transparent hover:bg-primary/10 hover:text-primary hover:border-primary/20",
                      isReorderMode && activeCategory !== cat && "opacity-50 grayscale cursor-not-allowed"
                    )}
                  >
                    {cat}
                  </Button>
                ))}
              </div>
              <ScrollBar orientation="horizontal" className="hidden" />
            </ScrollArea>
          </div>

          <DndContext 
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <ScrollArea className="flex-1 px-4 md:px-6">
              <SortableContext 
                items={filteredMenu.map(i => i.id)}
                strategy={rectSortingStrategy}
              >
                <div className={cn(
                  "grid gap-2.5 pb-8 pt-1",
                  layoutCols === 3 && "grid-cols-3",
                  layoutCols === 4 && "grid-cols-4",
                  layoutCols === 5 && "grid-cols-5",
                  layoutCols === 6 && "grid-cols-6",
                  layoutRows === 2 ? "auto-rows-[minmax(145px,1fr)]" : "auto-rows-auto"
                )}>
                  {filteredMenu.map(item => {
                    const currentCart = activeSession?.cart || [];
                    const inCart = currentCart.find(i => i.itemId === item.id);
                    return (
                      <SortableMenuItem 
                        key={item.id} 
                        item={item} 
                        inCart={inCart} 
                        onAdd={addToCart} 
                        onUpdateQty={updateQty}
                        isReorderMode={isReorderMode}
                      />
                    );
                  })}
                </div>
              </SortableContext>
            </ScrollArea>
          </DndContext>
        </section>

        <aside className="w-[320px] bg-white flex flex-col border-l border-slate-100 shadow-[-10px_0_30px_rgba(0,0,0,0.03)] z-20">
          <div className="p-4 border-b border-slate-50 flex justify-between items-center bg-white shrink-0">
            <div className="space-y-0.5">
              <h2 className="text-sm font-black font-headline text-[#00263b] tracking-tight truncate max-w-[160px] uppercase">{activeSession?.name}</h2>
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="text-[8px] font-black uppercase border-primary/20 text-primary py-0 px-1.5">Sr #{activeSession?.dailySrNo}</Badge>
                <p className="text-[9px] text-muted-foreground font-black uppercase tracking-widest">
                  {activeSession?.sourceOrderId ? 'EDIT' : `${activeSession?.cart.length || 0} Items`}
                </p>
              </div>
            </div>
            {activeSession?.cart.length && activeSession.cart.length > 0 && (
              <Button variant="ghost" size="sm" onClick={clearCart} disabled={isReorderMode} className="h-7 text-destructive hover:bg-destructive/10 hover:text-destructive font-black text-[8px] uppercase gap-1.5 px-3 rounded-full border border-destructive/10">
                <Trash2 className="size-3" /> Clear
              </Button>
            )}
          </div>

          <ScrollArea className="flex-1">
            <div className="px-4 py-2 flex flex-col gap-0.5">
              {activeSession?.cart.map(item => (
                <div key={item.itemId} className="flex items-center gap-3 group py-1.5 border-b border-slate-50 last:border-0 hover:bg-muted/5 rounded-lg px-2 -mx-2 transition-colors">
                  <div className="size-10 rounded-lg overflow-hidden shrink-0 bg-muted/20 relative border border-slate-100 shadow-sm">
                    {item.imageUrl ? <Image src={item.imageUrl} alt={item.name} fill className="object-cover" /> : <div className="flex items-center justify-center h-full opacity-20"><UtensilsCrossed className="size-4" /></div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start gap-2 leading-tight">
                      <h4 className="font-bold text-sm text-[#00263b] line-clamp-1 uppercase tracking-tight flex-1">{item.name}</h4>
                      <span className="font-black text-sm text-[#00263b] shrink-0 text-right">₹{(item.price * item.quantity).toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-[10px] text-muted-foreground font-black uppercase tracking-tighter">₹{item.price}</p>
                      <div className="flex items-center gap-3 bg-muted/20 p-0.5 rounded-lg">
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="size-7 rounded-md bg-white shadow-sm text-primary hover:bg-primary/10 hover:text-primary transition-all active:scale-95" 
                          onClick={() => updateQty(item.itemId, -1)}
                          disabled={isReorderMode}
                        >
                          <Minus className="size-3" />
                        </Button>
                        <span className="font-black text-xs text-[#00263b] w-4 text-center">{item.quantity}</span>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="size-7 rounded-md bg-white shadow-sm text-primary hover:bg-primary/10 hover:text-primary transition-all active:scale-95" 
                          onClick={() => updateQty(item.itemId, 1)}
                          disabled={isReorderMode}
                        >
                          <Plus className="size-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {(!activeSession?.cart || activeSession.cart.length === 0) && (
                <div className="py-24 text-center opacity-30 flex flex-col items-center gap-4">
                  <div className="size-14 rounded-full bg-muted flex items-center justify-center shadow-inner"><ShoppingCart className="size-7 text-slate-400" /></div>
                  <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-500">Pick dishes to start</p>
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="p-4 bg-slate-50 border-t border-slate-100 shadow-[0_-10px_20px_rgba(0,0,0,0.02)]">
            <div className="space-y-1 mb-3">
              <div className="flex justify-between text-[10px] font-black text-muted-foreground uppercase tracking-widest"><span>Subtotal</span><span className="text-[#00263b]">₹{calculations.subtotal.toFixed(2)}</span></div>
              <div className="flex justify-between text-[10px] font-black text-muted-foreground uppercase tracking-widest"><span>GST (5%)</span><span className="text-[#00263b]">₹{(calculations.cgst + calculations.sgst).toFixed(2)}</span></div>
              <div className="pt-2 mt-2 border-t border-slate-200 flex justify-between items-center">
                <span className="font-headline font-black text-xs text-[#00263b] tracking-tight uppercase">Payable</span>
                <span className="font-headline font-black text-2xl text-[#00263b] tracking-tighter">₹{calculations.total.toFixed(2)}</span>
              </div>
            </div>

            <div className="space-y-3">
              <Label className="text-[9px] font-black uppercase text-primary ml-1 tracking-[0.15em] flex items-center gap-2">
                <Zap className="size-3 fill-current" /> Settle & Finalize
              </Label>
              <div className="grid grid-cols-2 gap-2.5">
                {activePOSMethods.map((method) => {
                  const isOriginal = activeSession?.originalMethodId === method.id;
                  return (
                    <Button
                      key={method.id}
                      variant="outline"
                      className={cn(
                        "w-full h-14 flex items-center gap-2 p-0 rounded-2xl transition-all border-2 overflow-hidden shadow-sm active:scale-[0.97] group/btn",
                        "bg-white border-slate-100 hover:border-primary/20 hover:bg-primary/5",
                        (!activeSession?.cart.length || isSubmitting || isReorderMode) && "opacity-50 cursor-not-allowed grayscale",
                        isOriginal && "border-emerald-500 ring-4 ring-emerald-500/5 bg-emerald-50/30 hover:bg-emerald-50/50 hover:border-emerald-500"
                      )}
                      onClick={() => handleProcessBill(method.id)}
                      disabled={!activeSession?.cart.length || isSubmitting || isReorderMode}
                    >
                      <div className="size-14 shrink-0 bg-white border-r border-slate-100 relative overflow-hidden flex items-center justify-center p-1.5">
                        {method.logoUrl ? (
                          <Image src={method.logoUrl} alt={method.name} width={32} height={32} className="object-contain" />
                        ) : (
                          <div className="flex items-center justify-center size-full bg-primary/5 rounded-xl"><Wallet className="size-5 text-primary" /></div>
                        )}
                      </div>
                      <div className="flex flex-col items-start overflow-hidden pr-2 text-slate-900 group-hover/btn:text-primary">
                        <span className={cn(
                          "font-headline font-black text-[10px] uppercase tracking-tight leading-tight truncate w-full",
                          isOriginal ? "text-emerald-700" : ""
                        )}>
                          {method.name}
                        </span>
                        <span className="text-[7px] font-black text-muted-foreground uppercase mt-0.5 truncate w-full">{isOriginal ? 'Original' : 'Collect'}</span>
                      </div>
                    </Button>
                  );
                })}
              </div>
              {isSubmitting && (
                <div className="flex items-center justify-center gap-2 py-2 animate-pulse bg-primary/10 rounded-xl border border-primary/20">
                  <Loader2 className="size-3.5 animate-spin text-primary" />
                  <span className="text-[10px] font-black uppercase text-primary tracking-widest">Recording Transaction...</span>
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* Layout Settings Dialog */}
      <Dialog open={showLayoutSettings} onOpenChange={setShowLayoutSettings}>
        <DialogContent className="max-w-md rounded-3xl border-none shadow-2xl p-8">
          <DialogHeader className="items-center">
            <div className="size-16 rounded-2xl bg-accent/10 flex items-center justify-center mb-4">
              <LayoutGrid className="size-8 text-accent" />
            </div>
            <DialogTitle className="text-2xl font-black text-[#00263b] uppercase tracking-tight">Layout Config</DialogTitle>
            <DialogDescription className="text-center text-xs font-medium text-muted-foreground">Adjust the grid density for your screen.</DialogDescription>
          </DialogHeader>
          
          <div className="space-y-8 py-6">
            <div className="space-y-4">
              <Label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest flex items-center justify-center gap-2">
                Select Grid Layout
              </Label>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  onClick={() => { setLayoutCols(3); setLayoutRows(2); setShowLayoutSettings(false); }}
                  className={cn("h-16 flex-col gap-1 rounded-2xl border-2 transition-all relative", layoutCols === 3 ? "border-primary bg-primary/5 text-primary" : "border-slate-100")}
                >
                  <span className="font-black text-lg">3 x 2</span>
                  <span className="text-[8px] font-bold uppercase opacity-60">Large Targets</span>
                  {layoutCols === 3 && <Check className="absolute top-2 right-2 size-3" />}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => { setLayoutCols(4); setLayoutRows(2); setShowLayoutSettings(false); }}
                  className={cn("h-16 flex-col gap-1 rounded-2xl border-2 transition-all relative", layoutCols === 4 ? "border-primary bg-primary/5 text-primary" : "border-slate-100")}
                >
                  <span className="font-black text-lg">4 x 2</span>
                  <span className="text-[8px] font-bold uppercase opacity-60">Standard</span>
                  {layoutCols === 4 && <Check className="absolute top-2 right-2 size-3" />}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => { setLayoutCols(5); setLayoutRows(2); setShowLayoutSettings(false); }}
                  className={cn("h-16 flex-col gap-1 rounded-2xl border-2 transition-all relative", layoutCols === 5 ? "border-primary bg-primary/5 text-primary" : "border-slate-100")}
                >
                  <span className="font-black text-lg">5 x 2</span>
                  <span className="text-[8px] font-bold uppercase opacity-60">Balanced</span>
                  {layoutCols === 5 && <Check className="absolute top-2 right-2 size-3" />}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => { setLayoutCols(6); setLayoutRows(2); setShowLayoutSettings(false); }}
                  className={cn("h-16 flex-col gap-1 rounded-2xl border-2 transition-all relative", layoutCols === 6 ? "border-primary bg-primary/5 text-primary" : "border-slate-100")}
                >
                  <span className="font-black text-lg">6 x 2</span>
                  <span className="text-[8px] font-bold uppercase opacity-60">Pro View</span>
                  {layoutCols === 6 && <Check className="absolute top-2 right-2 size-3" />}
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setShowLayoutSettings(false)} className="w-full h-12 font-black text-sm uppercase tracking-wider rounded-2xl shadow-lg">Save & Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Admin Passcode Modal */}
      <Dialog open={showAdminLock} onOpenChange={setShowAdminLock}>
        <DialogContent className="max-w-sm rounded-3xl border-none shadow-2xl p-8">
          <DialogHeader className="items-center">
            <div className="size-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Lock className="size-8 text-primary" />
            </div>
            <DialogTitle className="text-2xl font-black text-[#00263b] uppercase tracking-tight">Admin Access</DialogTitle>
            <DialogDescription className="text-center text-xs font-medium text-muted-foreground">Enter restaurant passcode to access manager reports and settings.</DialogDescription>
          </DialogHeader>
          
          <div className="flex flex-col items-center gap-6 py-6">
            <div className="flex justify-center gap-3">
              {adminPasscode.map((digit, idx) => (
                <input
                  key={idx}
                  ref={pinRefs[idx]}
                  type="password"
                  inputMode="numeric"
                  value={digit}
                  onChange={(e) => handleAdminPinChange(idx, e.target.value)}
                  onKeyDown={(e) => e.key === 'Backspace' && !adminPasscode[idx] && idx > 0 && pinRefs[idx-1].current?.focus()}
                  className="w-14 h-16 text-center text-3xl font-black bg-muted/20 border-2 border-primary/20 focus:border-primary focus:ring-primary rounded-2xl outline-none"
                  maxLength={1}
                  autoFocus={idx === 0}
                />
              ))}
            </div>
            {lockError && <p className="text-xs text-destructive font-black uppercase tracking-widest">{lockError}</p>}
          </div>

          <DialogFooter className="flex-col gap-2">
            <Button onClick={handleAdminUnlock} className="w-full h-12 font-black text-sm uppercase tracking-wider rounded-2xl shadow-lg">Open Admin Panel</Button>
            <Button variant="ghost" onClick={() => setShowAdminLock(false)} className="w-full text-[10px] font-bold uppercase text-muted-foreground hover:bg-transparent">Back to Billing</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receipt Template (Hidden) */}
      <div className="hidden">
        <div ref={printRef} className="receipt-view">
          <div className="customer-invoice">
            <div className="text-center">
              <h2 style={{ fontSize: '18px', fontWeight: 'bold', margin: '0 0 8px 0' }}>{restaurant.name}</h2>
              {restaurant.address && <div style={{ margin: '0' }}>{restaurant.address}</div>}
              {restaurant.mobileNumber && <div style={{ margin: '4px 0' }}>PHONE : {restaurant.mobileNumber}</div>}
              {restaurant.gstNumber && <div style={{ margin: '0' }}>GSTIN : {restaurant.gstNumber}</div>}
            </div>
            <div className="metadata-row">
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="font-bold">Bill No : {lastBillId}</span>
                <span style={{ fontSize: '10px' }}>Daily Sr : {activeSession?.dailySrNo}</span>
              </div>
              <span>Date : {mounted ? format(new Date(), 'dd/MM/yyyy') : ''}</span>
            </div>
            <div className="divider"></div>
            <table>
              <thead>
                <tr><th className="item-col">Item</th><th className="qty-col">Qty</th><th className="price-col">Price</th><th className="amt-col">Amt</th></tr>
              </thead>
            </table>
            <div className="divider"></div>
            <table>
              <tbody>
                {activeSession?.cart.map((item, idx) => (
                  <tr key={`${item.itemId}-${idx}`}>
                    <td className="item-col">{item.name}</td>
                    <td className="qty-col">{item.quantity}</td>
                    <td className="price-col">{item.price.toFixed(2)}</td>
                    <td className="amt-col">{(item.price * item.quantity).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="divider"></div>
            <table>
              <tbody>
                <tr>
                  <td className="font-bold">SubTotal</td>
                  <td className="qty-col font-bold" style={{ width: '12%' }}>{calculations.itemCount}</td>
                  <td className="text-right font-bold" style={{ width: '48%' }}>{calculations.subtotal.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
            <div className="divider"></div>
            <table className="tax-row">
              <tbody>
                <tr><td>CGST @ 2.50%</td><td style={{ width: '24%' }}>{calculations.cgst.toFixed(2)}</td></tr>
                <tr><td>SGST @ 2.50%</td><td style={{ width: '24%' }}>{calculations.sgst.toFixed(2)}</td></tr>
              </tbody>
            </table>
            <div className="divider"></div>
            <div className="total-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ textTransform: 'uppercase' }}>TOTAL</span>
              <span>Rs. {calculations.total.toFixed(2)}</span>
            </div>
            <div className="divider"></div>
            <div className="text-right" style={{ margin: '15px 0', fontSize: '11px' }}>E & O.E</div>
            <div className="text-center" style={{ marginTop: '20px' }}>Thank You</div>
          </div>
          <div className="section-divider"></div>
          <div className="kitchen-token">
            <div className="text-center">
              <div className="token-header">FOOD TOKEN</div>
              <p style={{ fontSize: '15px', fontWeight: 'bold', margin: '8px 0' }}>Daily Sr : {activeSession?.dailySrNo}</p>
              <p style={{ margin: '0' }}>{mounted ? format(new Date(), 'dd/MM/yyyy HH:mm') : ''}</p>
            </div>
            <div className="divider"></div>
            <table><thead><tr><th style={{ fontSize: '15px', width: '80%', textAlign: 'left' }}>Item Description</th><th style={{ fontSize: '15px', width: '20%', textAlign: 'center' }}>Qty</th></tr></thead></table>
            <div className="divider"></div>
            <table>
              <tbody>
                {activeSession?.cart.map((item, idx) => (
                  <tr key={`token-${item.itemId}-${idx}`}>
                    <td className="kitchen-item" style={{ padding: '10px 0', width: '80%' }}>{item.name}</td>
                    <td className="kitchen-item" style={{ textAlign: 'center', fontSize: '20px', padding: '10px 0', width: '20%' }}>{item.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="divider"></div>
            <div className="text-center font-bold" style={{ marginTop: '20px', fontSize: '15px' }}>** KITCHEN COPY **</div>
          </div>
        </div>
      </div>

      <Dialog open={showBill} onOpenChange={(o) => { if(!o) setShowBill(o); }}>
        <DialogContent className="max-w-xs text-center py-8 rounded-3xl border-none shadow-2xl">
          <div className="mx-auto size-16 rounded-full bg-primary/10 flex items-center justify-center mb-4"><CheckCircle2 className="size-10 text-primary" /></div>
          <DialogHeader>
            <DialogTitle className="text-center text-2xl font-black font-headline text-[#00263b]">₹{calculations.total.toLocaleString()}</DialogTitle>
            <p className="text-muted-foreground font-bold uppercase text-[10px] tracking-widest">Order Processed</p>
          </DialogHeader>
          <div className="pt-6 flex flex-col items-center gap-3">
            <div className="flex gap-1.5">
              <Badge variant="outline" className="font-black text-[9px]">Sr #{activeSession?.dailySrNo}</Badge>
              <Badge variant="outline" className="font-black text-[9px]">Bill #{lastBillId}</Badge>
            </div>
            <Button variant="outline" className="w-full h-12 font-bold rounded-xl border-2 text-xs" onClick={() => setShowBill(false)}>NEXT ORDER</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
