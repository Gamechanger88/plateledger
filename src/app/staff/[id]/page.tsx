
"use client"

import { use, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useDateContext } from "@/contexts/date-context"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Loader2, ChevronLeft, Trash2, CalendarDays, ExternalLink, Info, Calculator, TrendingUp, Zap, Clock } from "lucide-react"
import { useActiveRestaurant } from "@/hooks/use-active-restaurant"
import { useDoc, useMemoFirebase, useFirestore, useCollection } from "@/firebase"
import { doc, collection, query, where } from "firebase/firestore"
import { deleteDocumentNonBlocking, setDocumentNonBlocking } from "@/firebase/non-blocking-updates"
import { Staff, Expense } from "@/lib/types"
import { format, parseISO, differenceInDays, subDays } from "date-fns"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

export default function StaffDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const { id } = use(params)
  const { restaurant } = useActiveRestaurant()
  const db = useFirestore()
  const { startDate, endDate } = useDateContext()

  const staffDocRef = useMemoFirebase(() => 
    restaurant ? doc(db, 'restaurants', restaurant.id, 'staff', id) : null
  , [db, restaurant?.id, id]);

  const expensesRef = useMemoFirebase(() => 
    restaurant ? collection(db, 'restaurants', restaurant.id, 'expenses') : null
  , [db, restaurant?.id]);

  const { data: member, isLoading: isMemberLoading } = useDoc<Staff>(staffDocRef);

  const accrualsQuery = useMemoFirebase(() => {
    if (!expensesRef || !id) return null;
    return query(expensesRef, where('staffId', '==', id));
  }, [expensesRef, id]);

  const { data: rawAccruals } = useCollection<Expense>(accrualsQuery);

  const yesterdayStr = format(subDays(new Date(), 1), 'yyyy-MM-dd');

  const stats = useMemo(() => {
    if (!member) return { 
      lifetime: 0, 
      period: 0, 
      periodDays: 0, 
      lifetimeDays: 0, 
      expectedLifetime: 0,
      breakdown: { regular: 0, half: 0, ot: 0 },
      units: { regular: 0, half: 0, ot: 0 }
    };

    const allAccruals = (rawAccruals || []).filter(a => a.isAccrual);
    
    const validAccruals = allAccruals.filter(a => {
      const isAfterJoin = !member.joiningDate || a.invoiceDate >= member.joiningDate;
      const isBeforeLast = !member.lastWorkingDate || a.invoiceDate <= member.lastWorkingDate;
      const isUpToYesterday = a.invoiceDate <= yesterdayStr;
      return isAfterJoin && isBeforeLast && isUpToYesterday;
    });

    const lifetime = validAccruals.reduce((sum, acc) => sum + (acc.amount || 0), 0);
    const periodAccruals = validAccruals.filter(acc => {
      const date = acc.invoiceDate;
      return date >= startDate && date <= endDate;
    });

    const period = periodAccruals.reduce((sum, acc) => sum + (acc.amount || 0), 0);
    
    // Breakdown for period
    const breakdown = { regular: 0, half: 0, ot: 0 };
    const units = { regular: 0, half: 0, ot: 0 };

    periodAccruals.forEach(a => {
      if (a.staffEntryType === 'Regular') {
        breakdown.regular += (a.amount || 0);
        units.regular += (a.staffUnits || 0);
      } else if (a.staffEntryType === 'Half Day') {
        breakdown.half += (a.amount || 0);
        units.half += (a.staffUnits || 0);
      } else {
        breakdown.ot += (a.amount || 0);
        units.ot += (a.staffUnits || 0);
      }
    });

    let expectedLifetime = 0;
    if (member?.joiningDate) {
      const join = parseISO(member.joiningDate);
      const endDateVal = member.lastWorkingDate 
        ? (member.lastWorkingDate < yesterdayStr ? parseISO(member.lastWorkingDate) : parseISO(yesterdayStr))
        : parseISO(yesterdayStr);
      
      const days = Math.max(0, differenceInDays(endDateVal, join) + 1);
      const dailyRate = (member.monthlySalary || 0) / 30;
      expectedLifetime = days * dailyRate;
    }

    return { 
      lifetime, 
      period, 
      periodDays: periodAccruals.length,
      totalUnits: units.regular + units.half + units.ot,
      lifetimeDays: validAccruals.length,
      expectedLifetime,
      breakdown,
      units
    };
  }, [rawAccruals, startDate, endDate, member, yesterdayStr]);

  const handleDelete = () => {
    if (!staffDocRef || !confirm("Are you sure you want to remove this staff member? This action cannot be undone.")) return;
    deleteDocumentNonBlocking(staffDocRef);
    router.push('/staff');
  };

  const handleUpdate = (field: keyof Staff, value: any) => {
    if (!staffDocRef) return;
    setDocumentNonBlocking(staffDocRef, { [field]: value }, { merge: true });
  };

  if (isMemberLoading) {
    return <div className="flex h-[80vh] items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>
  }

  if (!member) {
    return (
      <div className="flex flex-col items-center justify-center h-[80vh] gap-4">
        <p className="text-muted-foreground">Staff member not found.</p>
        <Button onClick={() => router.push('/staff')}>Back to Ledger</Button>
      </div>
    )
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push('/staff')} className="rounded-full">
            <ChevronLeft className="size-5" />
          </Button>
        </div>

      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2 space-y-6">
          <Card className="shadow-md border-none bg-white">
            <CardHeader>
              <CardTitle>Professional Details</CardTitle>
              <CardDescription>Update employee information and core settings.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Full Name</Label>
                  <Input 
                    defaultValue={member.name} 
                    onBlur={(e) => handleUpdate('name', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Monthly Salary (₹)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-muted-foreground font-bold text-xs">₹</span>
                    <Input 
                      type="number"
                      className="pl-7"
                      defaultValue={member.monthlySalary} 
                      onBlur={(e) => handleUpdate('monthlySalary', parseFloat(e.target.value))}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Contact Number</Label>
                  <Input 
                    defaultValue={member.contactInfo} 
                    onBlur={(e) => handleUpdate('contactInfo', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Role / Position</Label>
                  <Input 
                    placeholder="e.g. Head Chef, Captain"
                    defaultValue={member.role} 
                    onBlur={(e) => handleUpdate('role', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Joining Date</Label>
                  <Input 
                    type="date"
                    defaultValue={member.joiningDate || ''} 
                    onBlur={(e) => handleUpdate('joiningDate', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Last Working Day</Label>
                  <Input 
                    type="date"
                    defaultValue={member.lastWorkingDate || ''} 
                    onBlur={(e) => handleUpdate('lastWorkingDate', e.target.value)}
                  />
                </div>
              </div>
              
              <div className="pt-6 border-t flex justify-between items-center">
                <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                  Member ID: {member.id}
                </div>
                <Button variant="ghost" size="sm" onClick={handleDelete} className="gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive">
                  <Trash2 className="size-4" /> Remove Employee
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-md border-none bg-white">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="size-5 text-primary" />
                Period Earnings Breakdown
              </CardTitle>
              <CardDescription>Detailed calculation for {format(parseISO(startDate), 'dd MMM')} - {format(parseISO(endDate), 'dd MMM')}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                <div className="p-4 flex items-center justify-between hover:bg-muted/5 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">REG</div>
                    <div>
                      <p className="font-bold text-sm">Regular Presence</p>
                      <p className="text-[10px] text-muted-foreground uppercase font-black">{stats.units.regular} Full Days</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-black text-lg">₹{stats.breakdown.regular.toLocaleString('en-IN')}</p>
                    <p className="text-[10px] text-muted-foreground font-bold">₹{Math.round((member.monthlySalary || 0) / 30)} / day</p>
                  </div>
                </div>

                <div className="p-4 flex items-center justify-between hover:bg-muted/5 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-xl bg-orange-100 flex items-center justify-center text-orange-600 font-bold text-xs">HALF</div>
                    <div>
                      <p className="font-bold text-sm">Half Day Presence</p>
                      <p className="text-[10px] text-muted-foreground uppercase font-black">{stats.units.half} Units (0.5 Each)</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-black text-lg text-orange-600">₹{stats.breakdown.half.toLocaleString('en-IN')}</p>
                    <p className="text-[10px] text-muted-foreground font-bold">Variable Rate</p>
                  </div>
                </div>

                <div className="p-4 flex items-center justify-between hover:bg-muted/5 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-xl bg-accent/10 flex items-center justify-center text-accent font-bold text-xs">OT</div>
                    <div>
                      <p className="font-bold text-sm">Overtime & Others</p>
                      <p className="text-[10px] text-muted-foreground uppercase font-black">{stats.units.ot} Extra Units</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-black text-lg text-accent">₹{stats.breakdown.ot.toLocaleString('en-IN')}</p>
                    <p className="text-[10px] text-muted-foreground font-bold">Add-ons</p>
                  </div>
                </div>

                <div className="p-6 bg-primary/5 flex items-center justify-between">
                  <div>
                    <p className="font-black text-xs uppercase tracking-[0.2em] text-primary">Period Summary</p>
                    <p className="text-sm font-bold mt-1">{member.name} ({stats.totalUnits} Total Units)</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-black text-primary tabular-nums">₹{stats.period.toLocaleString('en-IN')}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Button 
            className="w-full h-12 gap-2 font-bold" 
            variant="outline"
            onClick={() => router.push('/staff')}
          >
            <ExternalLink className="size-4" /> Open Payroll Ledger to Record Attendance
          </Button>
        </div>

        <div className="space-y-6">
          <Card className="bg-primary border-none text-white shadow-xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase tracking-widest text-white/70">Finalized Period Earnings</CardTitle>
              <CardDescription className="text-[10px] text-white/60">
                {format(parseISO(startDate), 'dd MMM')} to {format(parseISO(endDate), 'dd MMM')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-black">₹{stats.period.toLocaleString('en-IN')}</div>
              <div className="flex items-center gap-2 mt-3">
                <Badge variant="secondary" className="bg-white/20 text-white border-none text-[10px] font-black uppercase tracking-widest">
                  {stats.totalUnits} Units Logged
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-muted/30 border-none shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Logged Lifetime Total</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">₹{stats.lifetime.toLocaleString('en-IN')}</div>
              <p className="text-[10px] text-muted-foreground mt-1 font-medium italic">Validated records up to yesterday.</p>
            </CardContent>
          </Card>

          <Card className="bg-accent/5 border-accent/20 border-dashed shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase tracking-widest text-accent flex items-center gap-1">
                <Calculator className="size-3" /> Contractual Expected
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-accent">₹{stats.expectedLifetime.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
              <p className="text-[10px] text-muted-foreground mt-1">Based on full daily rate since joining.</p>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-none bg-card/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Engagement Metrics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center text-sm border-b pb-2 border-dashed">
                <div className="flex items-center gap-2">
                  <Zap className="size-3.5 text-primary" />
                  <span className="text-muted-foreground">Daily Base Rate</span>
                </div>
                <span className="font-bold">₹{((member.monthlySalary || 0) / 30).toFixed(0)}</span>
              </div>
              <div className="flex justify-between items-center text-sm border-b pb-2 border-dashed">
                <div className="flex items-center gap-2">
                  <Clock className="size-3.5 text-primary" />
                  <span className="text-muted-foreground">Days Engaged</span>
                </div>
                <span className="font-bold">{stats.lifetimeDays}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <div className="flex items-center gap-2">
                  <Info className="size-3.5 text-primary" />
                  <span className="text-muted-foreground">Employment Status</span>
                </div>
                <Badge className={member.lastWorkingDate ? "bg-destructive/10 text-destructive border-destructive/20" : "bg-accent/10 text-accent border-accent/20"}>
                  {member.lastWorkingDate ? 'Tenure Ended' : 'Active Duty'}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
