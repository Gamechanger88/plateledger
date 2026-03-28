
"use client"

import { useState, useMemo, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useDateContext } from "@/contexts/date-context"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { Loader2, UserPlus, Calculator, Zap, Clock, Info, Check, Plus, Trash2, User, Save } from "lucide-react"
import { useActiveRestaurant } from "@/hooks/use-active-restaurant"
import { useCollection, useMemoFirebase, useFirestore } from "@/firebase"
import { collection, doc } from "firebase/firestore"
import { setDocumentNonBlocking, deleteDocumentNonBlocking } from "@/firebase/non-blocking-updates"
import { Staff, Expense } from "@/lib/types"
import { format, eachDayOfInterval, parseISO } from "date-fns"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import Link from "next/link"
import { cn } from "@/lib/utils"

export default function StaffPage() {
  const { restaurant, userId } = useActiveRestaurant()
  const db = useFirestore()
  const { startDate, endDate, today } = useDateContext()

  const [savingId, setSavingId] = useState<string | null>(null)
  const [isAddingStaff, setIsAddingStaff] = useState(false)
  const [isAutoFilling, setIsAutoFilling] = useState(false)

  const staffRef = useMemoFirebase(() => restaurant ? collection(db, 'restaurants', restaurant.id, 'staff') : null, [db, restaurant?.id]);
  const expensesRef = useMemoFirebase(() => restaurant ? collection(db, 'restaurants', restaurant.id, 'expenses') : null, [db, restaurant?.id]);

  const { data: staff, isLoading: isStaffLoading } = useCollection<Staff>(staffRef);
  const { data: allExpenses, isLoading: isExpensesLoading } = useCollection<Expense>(expensesRef);

  const daysInMonth = useMemo(() => {
    if (!startDate || !endDate) return [];
    try { return eachDayOfInterval({ start: parseISO(startDate), end: parseISO(endDate) }); } catch { return []; }
  }, [startDate, endDate]);

  const visibleStaff = useMemo(() => {
    if (!staff) return [];
    return staff.filter(s => {
      const hasJoinedByMonthEnd = !s.joiningDate || s.joiningDate <= (endDate || '9999-12-31');
      const hasResignedBeforeMonthStart = s.lastWorkingDate && s.lastWorkingDate < (startDate || '0000-01-01');
      return hasJoinedByMonthEnd && !hasResignedBeforeMonthStart;
    }).sort((a, b) => (b.monthlySalary || 0) - (a.monthlySalary || 0));
  }, [staff, startDate, endDate]);

  const dailyAccruals = useMemo(() => {
    const map = new Map<string, Expense[]>();
    allExpenses?.filter(e => e.isAccrual && e.staffId).forEach(e => {
      const key = `${e.invoiceDate}_${e.staffId}`;
      const existing = map.get(key) || [];
      map.set(key, [...existing, e]);
    });
    return map;
  }, [allExpenses]);

  const isStaffActiveOnDay = (s: Staff, dayStr: string) => {
    if (!today || dayStr > today) return false;
    if (s.joiningDate && dayStr < s.joiningDate) return false;
    if (s.lastWorkingDate && dayStr > s.lastWorkingDate) return false;
    return true;
  };

  const handleUpsertStaffEntry = (
    dayStr: string, 
    member: Staff, 
    entryId: string | null,
    data: { amount: number; units: number; type: Expense['staffEntryType']; remark?: string }
  ) => {
    if (!restaurant || !expensesRef) return;
    
    const units = data.units !== undefined ? data.units : 0;
    const type = data.type || 'Regular';
    const amount = data.amount || 0;

    // Use standardized IDs to prevent double counting
    const id = entryId || (
      type === 'Regular' || type === 'Half Day' 
        ? `staff_presence_${dayStr}_${member.id}` 
        : (type === 'Overtime' ? `staff_ot_${dayStr}_${member.id}` : `staff_other_${dayStr}_${member.id}`)
    );
    
    setSavingId(`${dayStr}_${member.id}`);
    
    setDocumentNonBlocking(doc(expensesRef, id), {
      id, 
      restaurantId: restaurant.id, 
      staffId: member.id, 
      expenseCategoryId: 'Salary',
      invoiceDate: dayStr, 
      paymentDate: dayStr, 
      description: `${type} Salary: ${member.name}`,
      amount: amount, 
      staffUnits: units,
      staffEntryType: type,
      isAccrual: true, 
      category: 'Fixed Cost', 
      subCategory: 'Salary', 
      vendor: member.name, 
      remark: data.remark || '',
      restaurantMembers: restaurant.members
    }, { merge: true });
    
    // Cleanup old generic accrual IDs if we are upserting a standardized presence record
    if (type === 'Regular' || type === 'Half Day') {
      const legacyId = `staff_accrual_${dayStr}_${member.id}`;
      deleteDocumentNonBlocking(doc(expensesRef, legacyId));
    }

    setTimeout(() => setSavingId(null), 800);
  };

  const handleDeleteStaffEntry = (dayStr: string, memberId: string, entryId: string) => {
    if (!restaurant || !expensesRef) return;
    setSavingId(`${dayStr}_${memberId}`);
    deleteDocumentNonBlocking(doc(expensesRef, entryId));
    setTimeout(() => setSavingId(null), 800);
  };

  const handleAutoFillSalaries = async () => {
    if (!restaurant || !expensesRef || !visibleStaff.length || !today) return;
    setIsAutoFilling(true);
    daysInMonth.forEach(day => {
      const dayStr = format(day, 'yyyy-MM-dd');
      if (dayStr >= today) return; 
      visibleStaff.forEach(s => {
        if (isStaffActiveOnDay(s, dayStr) && !dailyAccruals.has(`${dayStr}_${s.id}`)) {
          handleUpsertStaffEntry(dayStr, s, null, {
            type: 'Regular',
            units: 1,
            amount: Math.round((s.monthlySalary || 0) / 30)
          });
        }
      });
    });
    setTimeout(() => setIsAutoFilling(false), 2000);
  };

  const handleSaveStaff = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!restaurant || !staffRef) return;

    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const salary = parseFloat(formData.get('salary') as string) || 0;
    const joiningDate = formData.get('joiningDate') as string;
    const role = formData.get('role') as string;
    const contact = formData.get('contact') as string;

    setSavingId('new-staff');
    const staffId = doc(staffRef).id;
    
    setDocumentNonBlocking(doc(staffRef, staffId), {
      id: staffId,
      restaurantId: restaurant.id,
      name,
      monthlySalary: salary,
      joiningDate,
      role,
      contactInfo: contact,
      restaurantMembers: restaurant.members
    }, { merge: true });

    setTimeout(() => {
      setSavingId(null);
      setIsAddingStaff(false);
    }, 1000);
  };

  const handleUpdateMonthlySalary = (staffId: string, value: string) => {
    if (!restaurant || !staffRef) return;
    setSavingId(staffId);
    setDocumentNonBlocking(doc(staffRef, staffId), { monthlySalary: parseFloat(value) || 0 }, { merge: true });
    setTimeout(() => setSavingId(null), 800);
  };

  if (!restaurant) return null;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleAutoFillSalaries} disabled={isAutoFilling} className="h-9 gap-2 font-black uppercase text-[10px] border-primary/30 text-primary">
            {isAutoFilling ? <Loader2 className="size-3 animate-spin" /> : <Zap className="size-3.5 fill-current" />} Auto-Log
          </Button>
          <Button onClick={() => setIsAddingStaff(true)} className="h-9 gap-2 font-black uppercase text-[10px]"><UserPlus className="size-3.5" /> Add Staff</Button>
        </div>
      </div>

      <Dialog open={isAddingStaff} onOpenChange={setIsAddingStaff}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Add New Staff Member</DialogTitle>
            <DialogDescription>
              Monthly salary is used to calculate daily and half-day rates.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveStaff} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="staff-name">Full Name</Label>
              <Input id="staff-name" name="name" placeholder="e.g. Saddam" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-salary">Monthly Salary (₹)</Label>
              <Input id="staff-salary" name="salary" type="number" placeholder="0" required onWheel={(e) => e.currentTarget.blur()} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-joining">Joining Date</Label>
              <Input id="staff-joining" name="joiningDate" type="date" defaultValue={today} required onWheel={(e) => e.currentTarget.blur()} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-role">Role / Position</Label>
              <Input id="staff-role" name="role" placeholder="e.g. Captain" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-contact">Contact Info</Label>
              <Input id="staff-contact" name="contact" placeholder="Phone or Email" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsAddingStaff(false)}>Cancel</Button>
              <Button type="submit" disabled={savingId === 'new-staff'}>
                {savingId === 'new-staff' ? <Loader2 className="animate-spin mr-2" /> : null}
                Create Staff
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Card className="shadow-lg border-none overflow-hidden bg-card/50">
        <ScrollArea className="w-full">
          <Table className="border-separate border-spacing-0">
            <TableHeader className="sticky top-0 z-30">
              <TableRow className="bg-white/90 border-b-2">
                <TableHead className="w-[180px] font-black uppercase text-[10px] pl-6 sticky left-0 bg-white z-40 border-r-2 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">Salary Ref</TableHead>
                {visibleStaff.map(s => (
                  <TableHead key={`ms-${s.id}`} className="p-2 border-l min-w-[160px] text-center relative">
                    <div className="relative">
                      <Input 
                        key={`${s.id}-${s.monthlySalary}`} 
                        type="number" 
                        className="h-9 border-transparent text-center font-black text-xs focus:text-slate-950 focus:bg-white" 
                        defaultValue={s.monthlySalary || ""} 
                        onBlur={(e) => handleUpdateMonthlySalary(s.id, e.target.value)} 
                        onWheel={(e) => e.currentTarget.blur()}
                      />
                      {savingId === s.id && <Loader2 className="absolute right-1 top-2.5 size-2 animate-spin text-primary" />}
                    </div>
                  </TableHead>
                ))}
              </TableRow>
              <TableRow className="bg-primary/[0.03] border-b-2">
                <TableHead className="w-[180px] font-black uppercase text-[10px] pl-6 sticky left-0 bg-primary/[0.03] z-40 border-r-2">Period Total</TableHead>
                {visibleStaff.map(s => {
                  let sum = 0;
                  let units = 0;
                  daysInMonth.forEach(d => {
                    const ds = format(d, 'yyyy-MM-dd');
                    if (ds >= startDate && ds <= endDate) {
                      const entries = dailyAccruals.get(`${ds}_${s.id}`) || [];
                      entries.forEach(e => {
                        sum += (e.amount || 0);
                        units += (e.staffUnits || 0);
                      });
                    }
                  });
                  return (
                    <TableHead key={`acc-${s.id}`} className="p-2 border-l text-center">
                      <div className="flex flex-col">
                        <span className="font-black text-primary text-sm">₹{sum.toLocaleString('en-IN')}</span>
                        <span className="text-[9px] font-bold text-muted-foreground uppercase">{units} units</span>
                      </div>
                    </TableHead>
                  );
                })}
              </TableRow>
              <TableRow className="bg-muted/30 border-b-4">
                <TableHead className="w-[180px] font-black uppercase text-[10px] pl-6 sticky left-0 bg-muted/30 z-40 border-r-2">Staff Member</TableHead>
                {visibleStaff.map(s => <TableHead key={`name-${s.id}`} className="p-4 border-l text-center font-black text-xs"><Link href={`/staff/${s.id}`} className="hover:text-primary underline decoration-primary/30">{s.name}</Link></TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {daysInMonth.map((day) => {
                const dayStr = format(day, 'yyyy-MM-dd');
                const isToday = today === dayStr;
                const isFuture = dayStr > today;
                return (
                  <TableRow key={dayStr} className={cn("hover:bg-primary/[0.01]", isToday && "bg-primary/[0.02]", isFuture && "opacity-30 bg-muted/5")}>
                    <TableCell className={cn("pl-6 py-4 border-r-2 font-black text-xs sticky left-0 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]", isToday ? "bg-[#f8faf9]" : "bg-white")}>
                      <div className="flex flex-col leading-tight"><span>{format(day, 'dd MMM')}</span><span className="text-[9px] text-muted-foreground uppercase opacity-60 font-bold">{format(day, 'EEEE')}</span></div>
                    </TableCell>
                    {visibleStaff.map((s) => {
                      const isActive = isStaffActiveOnDay(s, dayStr);
                      const entries = dailyAccruals.get(`${dayStr}_${s.id}`) || [];
                      const totalAmount = entries.reduce((sum, e) => sum + (e.amount || 0), 0);
                      const totalUnits = entries.reduce((sum, e) => sum + (e.staffUnits || 0), 0);
                      const isSaving = savingId === `${dayStr}_${s.id}`;

                      return (
                        <TableCell key={`${dayStr}-${s.id}`} className={cn("p-1 border-l text-center", !isActive && "bg-muted/10 opacity-30")}>
                          <StaffCellPopover 
                            dayStr={dayStr} 
                            staff={s} 
                            entries={entries} 
                            onUpsert={(id, data) => handleUpsertStaffEntry(dayStr, s, id, data)}
                            onDelete={(id) => handleDeleteStaffEntry(dayStr, s.id, id)}
                            isDisabled={!isActive || isFuture}
                            isSaving={isSaving}
                          >
                            <div className={cn(
                              "relative flex flex-col items-center justify-center min-h-[44px] cursor-pointer rounded-md transition-all hover:bg-white/80",
                              totalAmount > 0 ? "bg-primary/5 ring-1 ring-primary/10" : ""
                            )}>
                              {isSaving ? (
                                <Loader2 className="size-4 animate-spin text-primary" />
                              ) : (
                                <>
                                  <span className={cn(
                                    "text-xs font-black",
                                    totalAmount > 0 ? "text-primary" : "text-muted-foreground opacity-30"
                                  )}>
                                    {totalAmount > 0 ? `₹${totalAmount}` : "Absent"}
                                  </span>
                                  {totalAmount > 0 && (
                                    <span className="text-[8px] font-black uppercase text-muted-foreground/60 mt-0.5">
                                      {totalUnits} Units
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                          </StaffCellPopover>
                        </TableCell>
                      )
                    })}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </Card>
    </div>
  )
}

function StaffCellPopover({ 
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
  staff: Staff; 
  entries: Expense[];
  onUpsert: (id: string | null, data: any) => void;
  onDelete: (id: string) => void;
  isDisabled: boolean;
  isSaving: boolean;
}) {
  const [isOpen, setOpen] = useState(false);
  const dailyRate = Math.round((staff.monthlySalary || 0) / 30);

  if (isDisabled) return <div className="opacity-30 cursor-not-allowed">{children}</div>;

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="max-w-md p-0 shadow-2xl border-primary/20 overflow-hidden rounded-3xl border-none">
        <DialogHeader className="hidden">
          <DialogTitle>Attendance Details - {staff.name}</DialogTitle>
          <DialogDescription>Modify logs for {format(parseISO(dayStr), 'dd MMM yyyy')}</DialogDescription>
        </DialogHeader>
        
        <div className="bg-[#00263b] text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-2xl bg-white/10 flex items-center justify-center">
              <User className="size-5 text-white/80" />
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

        <div className="p-6 space-y-4 bg-[#f8f9fa] max-h-[400px] overflow-auto">
          {entries.length > 0 ? (
            entries.map((e) => (
              <div key={e.id} className="p-4 bg-white rounded-2xl border-2 border-slate-100 shadow-sm group">
                <div className="flex items-center justify-between mb-3">
                  <Badge variant="outline" className="text-[10px] font-black uppercase border-primary/20 text-primary px-2.5 h-6">
                    {e.staffEntryType} ({e.staffUnits}u)
                  </Badge>
                  <Button variant="ghost" size="icon" className="size-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity rounded-full hover:bg-destructive/10" onClick={() => onDelete(e.id)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-black text-slate-900">₹{e.amount}</span>
                  <span className="text-[10px] font-bold text-muted-foreground italic truncate max-w-[150px]">{e.remark || 'No note'}</span>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-12 border-2 border-dashed rounded-3xl bg-white">
              <p className="text-[10px] text-muted-foreground font-black uppercase tracking-[0.2em]">No entries for today</p>
            </div>
          )}
        </div>

        <div className="p-6 border-t bg-white space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Button 
              variant="outline" 
              className="h-12 text-[10px] font-black uppercase border-primary text-primary hover:bg-primary/5 rounded-2xl"
              onClick={() => onUpsert(null, { type: 'Regular', units: 1, amount: dailyRate })}
            >
              Add Full Day
            </Button>
            <Button 
              variant="outline" 
              className="h-12 text-[10px] font-black uppercase border-orange-500 text-orange-600 hover:bg-orange-50 rounded-2xl"
              onClick={() => onUpsert(null, { type: 'Half Day', units: 0.5, amount: Math.round(dailyRate / 2) })}
            >
              Add Half Day
            </Button>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button className="w-full h-12 gap-2 font-black text-xs uppercase shadow-xl bg-accent hover:bg-accent/90 rounded-2xl">
                <Plus className="size-4" /> Add Overtime / Other
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[300px] p-6 shadow-2xl border-accent/20 rounded-3xl" side="top">
              <StaffEntryForm 
                onSave={(data) => onUpsert(null, data)} 
                dailyRate={dailyRate}
              />
            </PopoverContent>
          </Popover>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StaffEntryForm({ onSave, dailyRate }: { onSave: (data: any) => void; dailyRate: number }) {
  const [type, setType] = useState<'Regular' | 'Half Day' | 'Overtime' | 'Other'>('Overtime');
  const [amount, setAmount] = useState<string>("");
  const [units, setUnits] = useState<string>("0");
  const [remark, setRemark] = useState("");

  const handleLocalSave = () => {
    onSave({ 
      type, 
      amount: parseFloat(amount) || 0, 
      units: parseFloat(units) || 0, 
      remark 
    });
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Entry Type</Label>
        <div className="grid grid-cols-2 gap-2">
          {['Overtime', 'Other'].map((t) => (
            <Button 
              key={t}
              size="sm"
              variant={type === t ? 'default' : 'outline'}
              className="h-9 text-[10px] font-black uppercase rounded-xl"
              onClick={() => setType(t as any)}
            >
              {t}
            </Button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Amount (₹)</Label>
          <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-10 text-sm font-black rounded-xl" placeholder="0" />
        </div>
        <div className="space-y-2">
          <Label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Units</Label>
          <Input type="number" value={units} onChange={(e) => setUnits(e.target.value)} className="h-10 text-sm font-black rounded-xl" placeholder="0" />
        </div>
      </div>
      <div className="space-y-2">
        <Label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Remark</Label>
        <Input value={remark} onChange={(e) => setRemark(e.target.value)} className="h-10 text-xs font-bold rounded-xl" placeholder="e.g. 4 hrs extra" />
      </div>
      <Button className="w-full h-11 bg-accent hover:bg-accent/90 font-black text-xs uppercase rounded-xl shadow-lg" onClick={handleLocalSave}>
        Record Entry
      </Button>
    </div>
  );
}
