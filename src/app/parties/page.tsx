"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Users, Loader2, Phone, Trash2, Pencil, Calendar, ArrowUpRight, ArrowDownLeft, ReceiptText, Store, Info, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { useActiveRestaurant } from "@/hooks/use-active-restaurant"
import { useCollection, useMemoFirebase, useFirestore } from "@/firebase"
import { collection, doc } from "firebase/firestore"
import { setDocumentNonBlocking, deleteDocumentNonBlocking } from "@/firebase/non-blocking-updates"
import { Party, MainCategory, SubCategory } from "@/lib/types"
import { format } from "date-fns"

export default function PartiesPage() {
  const router = useRouter()
  const { restaurant, isLoading: isRestLoading, userId } = useActiveRestaurant()
  const db = useFirestore()
  const [showForm, setShowForm] = useState(false)
  const [editingParty, setEditingParty] = useState<Party | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  const [mainCat, setMainCat] = useState<MainCategory>('Variable Cost')

  const partiesRef = useMemoFirebase(() => 
    restaurant ? collection(db, 'restaurants', restaurant.id, 'parties') : null
  , [db, restaurant?.id]);

  const { data: parties, isLoading: isDataLoading } = useCollection<Party>(partiesRef);

  const subCategories: Record<MainCategory, SubCategory[]> = {
    'Fixed Cost': ['Rent'],
    'Variable Cost': ['Food Purchase', 'Disposable Items', 'Maintenance', 'Electricity Bill', 'Gas', 'Other'],
    'General': ['Miscellaneous']
  }

  const handleOpenEdit = (party: Party) => {
    setEditingParty(party)
    setMainCat(party.mainCategory)
    setShowForm(true)
  }

  const handleCancel = () => {
    setShowForm(false)
    setEditingParty(null)
    setMainCat('Variable Cost')
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!restaurant || !userId || !partiesRef) return;

    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const subCategory = formData.get('subCategory') as SubCategory;
    const contact = formData.get('contact') as string;
    const openingBalance = parseFloat(formData.get('openingBalance') as string) || 0;
    const openingBalanceDate = formData.get('openingBalanceDate') as string;
    const balanceType = formData.get('balanceType') as 'Payable' | 'Receivable';
    const monthlyAmount = parseFloat(formData.get('monthlyAmount') as string) || 0;

    setIsSubmitting(true);
    
    const partyId = editingParty ? editingParty.id : doc(partiesRef).id;
    const partyDocRef = doc(partiesRef, partyId);

    setDocumentNonBlocking(partyDocRef, {
      id: partyId,
      restaurantId: restaurant.id,
      name,
      mainCategory: mainCat,
      subCategory,
      contactInfo: contact,
      openingBalance,
      openingBalanceDate,
      balanceType,
      monthlyAmount,
      restaurantMembers: restaurant.members
    }, { merge: true });

    setIsSubmitting(false);
    handleCancel();
  };

  const handleDelete = (id: string) => {
    if (!partiesRef || !confirm("Are you sure you want to delete this party?")) return;
    deleteDocumentNonBlocking(doc(partiesRef, id));
  };

  if (isRestLoading || isDataLoading) {
    return <div className="flex h-[80vh] items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>
  }

  if (!restaurant) return null;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
        </div>
        {!showForm && (
          <Button onClick={() => setShowForm(true)} className="gap-2 font-bold">
            <Plus className="size-4" />
            Register Party
          </Button>
        )}
      </div>

      {showForm && (
        <Card className="animate-in fade-in slide-in-from-top-4 duration-300 border-primary/20 shadow-lg relative overflow-hidden">
          <div className="absolute top-4 right-4 z-10">
            <Button variant="ghost" size="icon" onClick={handleCancel} className="rounded-full hover:bg-muted"><X className="size-4" /></Button>
          </div>
          <CardHeader>
            <CardTitle>{editingParty ? 'Edit Party Details' : 'Add New Party'}</CardTitle>
            <CardDescription>
              Set monthly amounts to automatically distribute bills daily in your Performance Ledger.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form key={editingParty?.id || 'new-party'} onSubmit={handleSubmit} className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="name">Party Name</Label>
                <Input 
                  name="name" 
                  id="name" 
                  placeholder="e.g. Fresh Veggie Co" 
                  defaultValue={editingParty?.name || ''}
                  required 
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="mainCategory">Main Category</Label>
                <Select value={mainCat} onValueChange={(val: MainCategory) => setMainCat(val)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Fixed Cost">Fixed Cost</SelectItem>
                    <SelectItem value="Variable Cost">Variable Cost</SelectItem>
                    <SelectItem value="General">General</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="subCategory">Sub-Category</Label>
                <Select name="subCategory" required defaultValue={editingParty?.subCategory || subCategories[mainCat][0]}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {subCategories[mainCat].map(sub => (
                      <SelectItem key={sub} value={sub}>{sub}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="monthlyAmount" className="flex items-center gap-1">
                  Monthly Total (₹)
                  <Info className="size-3 text-muted-foreground" />
                </Label>
                <Input 
                  type="number"
                  name="monthlyAmount" 
                  id="monthlyAmount" 
                  className="font-bold border-primary/20"
                  placeholder="e.g. 12000" 
                  defaultValue={editingParty?.monthlyAmount || ''}
                  onWheel={(e) => e.currentTarget.blur()}
                />
                <p className="text-[10px] text-muted-foreground italic">If set, ₹{Math.round((editingParty?.monthlyAmount || 0) / 30)}/day will show in Ledger.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="contact">Contact Detail</Label>
                <Input 
                  name="contact" 
                  id="contact" 
                  placeholder="Phone or Email" 
                  defaultValue={editingParty?.contactInfo || ''}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="balanceType">Balance Type</Label>
                <Select name="balanceType" defaultValue={editingParty?.balanceType || "Payable"}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Payable">To Give (Payable)</SelectItem>
                    <SelectItem value="Receivable">To Receive (Receivable)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="openingBalance">Opening Balance (₹)</Label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-muted-foreground font-bold text-xs">₹</span>
                  <Input 
                    type="number"
                    name="openingBalance" 
                    id="openingBalance" 
                    className="pl-7"
                    placeholder="0.00" 
                    defaultValue={editingParty?.openingBalance || ''}
                    onWheel={(e) => e.currentTarget.blur()}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="openingBalanceDate">Opening Date</Label>
                <Input 
                  type="date" 
                  name="openingBalanceDate" 
                  id="openingBalanceDate" 
                  defaultValue={editingParty?.openingBalanceDate || format(new Date(), 'yyyy-MM-dd')}
                />
              </div>
              
              <div className="lg:col-span-4 flex justify-end gap-2 border-t pt-4">
                <Button variant="outline" type="button" onClick={handleCancel}>Cancel</Button>
                <Button className="bg-primary px-8 font-bold" disabled={isSubmitting}>
                  {isSubmitting ? <Loader2 className="animate-spin" /> : (editingParty ? 'Update Party' : 'Save Party')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {parties?.map((party) => (
          <Card key={party.id} className="group hover:border-primary/50 transition-colors shadow-sm relative overflow-hidden flex flex-col">
            <CardHeader className="pb-2">
              <div className="flex justify-between items-start">
                <div className="flex flex-col gap-1">
                   <Badge variant="outline" className="w-fit text-[10px] uppercase font-bold tracking-wider">
                    {party.mainCategory}
                  </Badge>
                  <Badge className="w-fit bg-accent/10 text-accent hover:bg-accent/20 border-accent/20">
                    {party.subCategory}
                  </Badge>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => handleOpenEdit(party)} 
                    className="h-8 w-8 text-muted-foreground hover:text-primary"
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => handleDelete(party.id)} 
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
              <CardTitle className="mt-3 text-lg font-bold">{party.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 flex-1">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Phone className="size-4" />
                <span>{party.contactInfo || 'No contact provided'}</span>
              </div>

              {party.monthlyAmount !== undefined && party.monthlyAmount > 0 && (
                <div className="p-3 rounded-lg bg-primary/5 border border-primary/10 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase text-primary tracking-tighter">Monthly Reference</p>
                    <div className="flex items-center gap-1.5">
                      <Calendar className="size-3 text-primary" />
                      <span className="text-sm font-bold text-primary">₹{party.monthlyAmount.toLocaleString('en-IN')}</span>
                    </div>
                  </div>
                  <div className="text-right">
                     <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-tighter">Daily Accrual</p>
                     <span className="text-[10px] font-black text-primary">₹{Math.round(party.monthlyAmount / 30)}</span>
                  </div>
                </div>
              )}

              {party.openingBalance !== undefined && party.openingBalance > 0 && (
                <div className="p-3 rounded-lg bg-muted/30 border border-muted flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-tighter">Opening Balance</p>
                    <div className="flex items-center gap-1.5">
                      {party.balanceType === 'Payable' ? (
                        <ArrowUpRight className="size-3 text-destructive" />
                      ) : (
                        <ArrowDownLeft className="size-3 text-primary" />
                      )}
                      <span className={`text-sm font-bold ${party.balanceType === 'Payable' ? 'text-destructive' : 'text-primary'}`}>
                        ₹{party.openingBalance.toLocaleString('en-IN')}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                     <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-tighter">As Of</p>
                     <span className="text-[10px] font-medium">{party.openingBalanceDate ? format(new Date(party.openingBalanceDate), 'dd MMM yy') : 'N/A'}</span>
                  </div>
                </div>
              )}
            </CardContent>
            <div className="p-4 pt-0 mt-auto border-t bg-muted/10">
               <Button 
                variant="ghost" 
                className="w-full justify-between font-bold text-xs uppercase tracking-wider h-10 px-2 hover:bg-primary/5 hover:text-primary"
                onClick={() => router.push(`/invoices?party=${party.id}`)}
               >
                 <span className="flex items-center gap-2">
                   <ReceiptText className="size-4" />
                   Record Purchase
                 </span>
                 <Plus className="size-3" />
               </Button>
            </div>
          </Card>
        ))}
        
        {parties?.length === 0 && !showForm && (
          <div className="col-span-full py-20 text-center border-2 border-dashed rounded-xl bg-muted/20">
            <Store className="size-12 mx-auto text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground font-medium text-lg">No Parties registered yet.</p>
            <p className="text-muted-foreground/60 text-sm mb-6">Add Vendors, Landlords, or Suppliers here.</p>
            <Button onClick={() => setShowForm(true)} className="gap-2 font-bold">
              <Plus className="size-4" /> Add Your First Party
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
