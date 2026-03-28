"use client"

import { useState } from "react"
import Image from "next/image"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Loader2, Store, Smartphone, MapPin, Hash, Wallet, CheckCircle2, MonitorDot, Plus, Trash2, Link as LinkIcon, Layers, X, Pencil, Upload } from "lucide-react"
import { useActiveRestaurant } from "@/hooks/use-active-restaurant"
import { useFirestore, useCollection, useMemoFirebase } from "@/firebase"
import { doc, updateDoc, collection, deleteDoc, getDocs } from "firebase/firestore"
import { SalesAccount, POSMethod } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"
import { setDocumentNonBlocking, updateDocumentNonBlocking } from "@/firebase/non-blocking-updates"
import { cn } from "@/lib/utils"

const DEFAULT_CATEGORIES = ["Starters", "Main Course", "Fast Food", "Drinks", "Desserts", "Sides"];

export default function SettingsPage() {
  const { restaurant, isLoading: isRestLoading } = useActiveRestaurant()
  const db = useFirestore()
  const { toast } = useToast()
  const [isUpdating, setIsProcessing] = useState(false)
  const [newCategory, setNewCategory] = useState("")
  const [editingCategory, setEditingCategory] = useState<string | null>(null)
  const [editCategoryValue, setEditCategoryValue] = useState("")

  const accountsRef = useMemoFirebase(() => 
    restaurant ? collection(db, 'restaurants', restaurant.id, 'salesAccounts') : null
  , [db, restaurant?.id]);

  const posMethodsRef = useMemoFirebase(() => 
    restaurant ? collection(db, 'restaurants', restaurant.id, 'posMethods') : null
  , [db, restaurant?.id]);

  const { data: accounts, isLoading: isAccountsLoading } = useCollection<SalesAccount>(accountsRef);
  const { data: posMethods, isLoading: isMethodsLoading } = useCollection<POSMethod>(posMethodsRef);

  const activeCategories = restaurant?.menuCategories && restaurant.menuCategories.length > 0 
    ? restaurant.menuCategories 
    : DEFAULT_CATEGORIES;

  const handleUpdateProfile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!restaurant) return

    setIsProcessing(true)
    const formData = new FormData(e.currentTarget)
    const name = (formData.get('name') as string || '').trim()
    if (!name) {
      toast({ variant: "destructive", title: "Validation Error", description: "Business name is required." })
      setIsProcessing(false)
      return
    }
    const gstNumber = (formData.get('gstNumber') as string || '').trim()
    if (gstNumber && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstNumber)) {
      toast({ variant: "destructive", title: "Validation Error", description: "Invalid GST number format (e.g. 27ABCDE1234F1Z5)." })
      setIsProcessing(false)
      return
    }

    try {
      const restRef = doc(db, 'restaurants', restaurant.id)
      await updateDoc(restRef, {
        name,
        mobileNumber: (formData.get('mobileNumber') as string || '').trim(),
        gstNumber,
        address: (formData.get('address') as string || '').trim(),
      })
      toast({ title: "Settings Updated", description: "Restaurant profile has been saved." })
    } catch (err) {
      toast({ variant: "destructive", title: "Update Failed", description: "Could not save settings." })
    } finally {
      setIsProcessing(false)
    }
  }

  const handleLogoUpload = (methodId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 100 * 1024) {
        toast({ variant: "destructive", title: "File Too Large", description: "Logo size must be less than 100KB." });
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        handleUpdatePOSMethod(methodId, 'logoUrl', reader.result as string);
      };
      reader.onerror = () => {
        toast({ variant: "destructive", title: "Upload Failed", description: "Could not read the logo file." });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAddPOSMethod = () => {
    if (!restaurant || !posMethodsRef || !accounts?.length) return;
    const id = doc(posMethodsRef).id;
    setDocumentNonBlocking(doc(posMethodsRef, id), {
      id,
      restaurantId: restaurant.id,
      name: "New Method",
      linkedAccountId: accounts[0].id,
      isActive: true,
      restaurantMembers: restaurant.members
    }, { merge: true });
  }

  const handleUpdatePOSMethod = (id: string, field: keyof POSMethod, value: any) => {
    if (!posMethodsRef) return;
    setDocumentNonBlocking(doc(posMethodsRef, id), { [field]: value }, { merge: true });
  }

  const handleDeletePOSMethod = (id: string) => {
    if (!posMethodsRef) return;
    deleteDoc(doc(posMethodsRef, id));
  }

  const handleAddCategory = () => {
    if (!restaurant || !newCategory.trim()) return;
    const currentCats = activeCategories;
    if (currentCats.includes(newCategory.trim())) {
      toast({ variant: "destructive", title: "Duplicate Category", description: "This category already exists." });
      return;
    }
    
    const updatedCats = [...currentCats, newCategory.trim()];
    const restRef = doc(db, 'restaurants', restaurant.id);
    updateDocumentNonBlocking(restRef, { menuCategories: updatedCats });
    setNewCategory("");
    toast({ title: "Category Added" });
  }

  const handleRenameCategory = async (oldName: string) => {
    if (!restaurant || !editCategoryValue.trim() || oldName === editCategoryValue.trim()) {
      setEditingCategory(null);
      return;
    }
    
    const newName = editCategoryValue.trim();
    const updatedCats = activeCategories.map(c => c === oldName ? newName : c);
    
    setIsProcessing(true);
    try {
      const restRef = doc(db, 'restaurants', restaurant.id);
      await updateDoc(restRef, { menuCategories: updatedCats });
      
      const itemsSnapshot = await getDocs(collection(db, 'restaurants', restaurant.id, 'menuItems'));
      itemsSnapshot.docs.forEach(d => {
        if (d.data().category === oldName) {
          setDocumentNonBlocking(d.ref, { category: newName }, { merge: true });
        }
      });
      
      setEditingCategory(null);
      toast({ title: "Category Renamed", description: `Items moved to ${newName}` });
    } catch (e) {
      toast({ variant: "destructive", title: "Rename Failed" });
    } finally {
      setIsProcessing(false);
    }
  }

  const handleDeleteCategory = (cat: string) => {
    if (!restaurant) return;
    const updatedCats = activeCategories.filter(c => c !== cat);
    const restRef = doc(db, 'restaurants', restaurant.id);
    updateDocumentNonBlocking(restRef, { menuCategories: updatedCats });
    toast({ title: "Category Removed" });
  }

  if (isRestLoading || isAccountsLoading || isMethodsLoading) {
    return <div className="flex h-[80vh] items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>
  }

  if (!restaurant) return null

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-20">
      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-8">
          <Card className="shadow-sm border-none bg-white">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Store className="size-5 text-primary" />
                Restaurant Profile
              </CardTitle>
              <CardDescription>These details will be printed on your customer receipts.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleUpdateProfile} className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="name">Business Name</Label>
                    <div className="relative">
                      <Store className="absolute left-3 top-3 size-4 text-muted-foreground" />
                      <Input id="name" name="name" defaultValue={restaurant.name} className="pl-9" placeholder="e.g. My Cafe" required />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mobileNumber">Contact Mobile</Label>
                    <div className="relative">
                      <Smartphone className="absolute left-3 top-3 size-4 text-muted-foreground" />
                      <Input id="mobileNumber" name="mobileNumber" defaultValue={restaurant.mobileNumber} className="pl-9" placeholder="+91..." />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="gstNumber">GST Number</Label>
                    <div className="relative">
                      <Hash className="absolute left-3 top-3 size-4 text-muted-foreground" />
                      <Input id="gstNumber" name="gstNumber" defaultValue={restaurant.gstNumber} className="pl-9" placeholder="27XXXXX..." />
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="address">Physical Address</Label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-3 size-4 text-muted-foreground" />
                    <Input id="address" name="address" defaultValue={restaurant.address} className="pl-9" placeholder="Full address for bill header" />
                  </div>
                </div>
                <div className="flex justify-end pt-2">
                  <Button type="submit" disabled={isUpdating} className="font-bold min-w-[140px]">
                    {isUpdating ? <Loader2 className="animate-spin mr-2" /> : <CheckCircle2 className="size-4 mr-2" />}
                    Save Profile
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-none bg-white">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <MonitorDot className="size-5 text-primary" />
                  POS Methods & Staging
                </CardTitle>
                <CardDescription>Setup methods like PhonePe or POS Cash. Map them to real Bank/Cash accounts.</CardDescription>
              </div>
              <Button onClick={handleAddPOSMethod} size="sm" className="gap-2 font-bold">
                <Plus className="size-4" /> Add Method
              </Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {posMethods?.map((method) => (
                  <div key={method.id} className="p-4 rounded-xl border bg-muted/5 group space-y-4">
                    <div className="flex items-center gap-4">
                      <div className="relative size-12 shrink-0 rounded-lg overflow-hidden border bg-white flex items-center justify-center">
                        {method.logoUrl ? (
                          <Image src={method.logoUrl} alt="" fill className="object-contain p-1" />
                        ) : (
                          <Upload className="size-4 text-muted-foreground/40" />
                        )}
                        <input 
                          type="file" 
                          className="absolute inset-0 opacity-0 cursor-pointer" 
                          accept="image/*" 
                          onChange={(e) => handleLogoUpload(method.id, e)} 
                        />
                      </div>
                      <div className="flex-1 grid grid-cols-1 md:grid-cols-[1fr_1fr_80px_40px] gap-4 items-center">
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase font-black text-muted-foreground">Method Name</Label>
                          <Input 
                            defaultValue={method.name} 
                            className="h-9 font-bold bg-white" 
                            onBlur={(e) => handleUpdatePOSMethod(method.id, 'name', e.target.value)}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase font-black text-muted-foreground flex items-center gap-1">
                            <LinkIcon className="size-2.5" /> Settles into Account
                          </Label>
                          <Select 
                            value={method.linkedAccountId} 
                            onValueChange={(val) => handleUpdatePOSMethod(method.id, 'linkedAccountId', val)}
                          >
                            <SelectTrigger className="h-9 font-bold bg-white">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {accounts?.map(acc => (
                                <SelectItem key={acc.id} value={acc.id}>
                                  <div className="flex items-center gap-2">
                                    {acc.logoUrl ? <Image src={acc.logoUrl} alt="" width={14} height={14} className="object-contain" /> : null}
                                    {acc.name}
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex flex-col items-center justify-center gap-1">
                          <Label className="text-[9px] uppercase font-black text-muted-foreground">Active</Label>
                          <Switch 
                            checked={method.isActive} 
                            onCheckedChange={(checked) => handleUpdatePOSMethod(method.id, 'isActive', checked)}
                          />
                        </div>
                        <div className="flex justify-end">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="size-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => handleDeletePOSMethod(method.id)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {(!posMethods || posMethods.length === 0) && (
                  <div className="text-center py-12 border border-dashed rounded-xl bg-muted/5">
                    <p className="text-muted-foreground text-sm font-medium">No POS Methods configured.</p>
                    <p className="text-[10px] text-muted-foreground/60 uppercase font-black mt-1">Add methods to begin Quick Billing.</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-none bg-white">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Layers className="size-5 text-primary" />
                Menu Categories
              </CardTitle>
              <CardDescription>Manage headers for your POS screen and Menu list.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Layers className="absolute left-3 top-3 size-4 text-muted-foreground" />
                  <Input 
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="pl-9 h-10" 
                    placeholder="e.g. Chinese, Indian, Shakes" 
                    onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
                  />
                </div>
                <Button onClick={handleAddCategory} className="font-bold">
                  <Plus className="size-4 mr-2" /> Add Category
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {activeCategories.map((cat) => (
                  <div key={cat} className="flex items-center justify-between p-3 bg-muted/30 border rounded-xl group">
                    {editingCategory === cat ? (
                      <div className="flex items-center gap-2 w-full">
                        <Input 
                          autoFocus
                          className="h-8 text-sm font-bold"
                          value={editCategoryValue}
                          onChange={(e) => setEditCategoryValue(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleRenameCategory(cat)}
                          onBlur={() => setEditingCategory(null)}
                        />
                        <Button size="icon" variant="ghost" className="size-8 text-primary" onMouseDown={(e) => e.preventDefault()} onClick={() => handleRenameCategory(cat)}><CheckCircle2 className="size-4" /></Button>
                      </div>
                    ) : (
                      <>
                        <span className="text-sm font-black text-[#00263b] uppercase tracking-tight">{cat}</span>
                        <div className="flex items-center gap-1">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="size-8 text-muted-foreground hover:text-primary"
                            onClick={() => { setEditingCategory(cat); setEditCategoryValue(cat); }}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="size-8 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDeleteCategory(cat)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="bg-primary/5 border-primary/20 shadow-none border-dashed">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase tracking-widest text-primary">Configuration Tips</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-3 leading-relaxed">
              <p>• <strong>Logos:</strong> Uploading small logos for Bank accounts and POS Methods helps cashiers quickly identify the correct payment channel.</p>
              <p>• <strong>Categories:</strong> Renaming a category here will automatically update all dishes belonging to it.</p>
              <p>• <strong>POS Methods:</strong> If you use multiple machines or QR codes, create a method for each to track daily collection accurately.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
