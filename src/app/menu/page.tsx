
"use client"

import { useState, useMemo } from "react"
import Image from "next/image"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, UtensilsCrossed, Loader2, Trash2, Pencil, Search, SlidersHorizontal, Info, Upload, X, EyeOff, Copy, ChevronUp, ChevronDown, GripVertical } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { useActiveRestaurant } from "@/hooks/use-active-restaurant"
import { useCollection, useMemoFirebase, useFirestore } from "@/firebase"
import { collection, doc, query, limit, getDocs } from "firebase/firestore"
import { setDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking } from "@/firebase/non-blocking-updates"
import { MenuItem, SaleOrder } from "@/lib/types"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

const DEFAULT_CATEGORIES = ["Starters", "Main Course", "Fast Food", "Drinks", "Desserts", "Sides"];

type DisplayEntry =
  | { type: 'single'; item: MenuItem }
  | { type: 'variant'; groupId: string; items: MenuItem[]; baseName: string };

function getCommonPrefix(names: string[]): string {
  if (names.length <= 1) return names[0] || '';
  const wordArrays = names.map(n => n.trim().split(/\s+/));
  const minLen = Math.min(...wordArrays.map(w => w.length));
  let commonCount = 0;
  for (let i = 0; i < minLen - 1; i++) {
    if (wordArrays.every(w => w[i].toLowerCase() === wordArrays[0][i].toLowerCase())) {
      commonCount = i + 1;
    } else {
      break;
    }
  }
  return commonCount > 0 ? wordArrays[0].slice(0, commonCount).join(' ') : names[0];
}

function toDisplayEntries(items: MenuItem[]): DisplayEntry[] {
  const variantMap = new Map<string, MenuItem[]>();
  items.forEach(item => {
    if (item.variantGroup) {
      const g = variantMap.get(item.variantGroup) || [];
      g.push(item);
      variantMap.set(item.variantGroup, g);
    }
  });

  const processedGroups = new Set<string>();
  const result: DisplayEntry[] = [];
  const sorted = [...items].sort((a, b) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999));

  sorted.forEach(item => {
    if (item.variantGroup) {
      if (!processedGroups.has(item.variantGroup)) {
        processedGroups.add(item.variantGroup);
        const groupItems = [...(variantMap.get(item.variantGroup) || [])]
          .sort((a, b) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999));
        if (groupItems.length === 1) {
          result.push({ type: 'single', item: groupItems[0] });
        } else {
          const baseName = getCommonPrefix(groupItems.map(i => i.name));
          result.push({ type: 'variant', groupId: item.variantGroup, items: groupItems, baseName });
        }
      }
    } else {
      result.push({ type: 'single', item });
    }
  });
  return result;
}

export default function MenuPage() {
  const { restaurant, isLoading: isRestLoading } = useActiveRestaurant()
  const db = useFirestore()
  const { toast } = useToast()

  const [showAdd, setShowAdd] = useState(false)
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null)
  const [isDuplicating, setIsDuplicating] = useState(false)
  const [pendingVariantGroup, setPendingVariantGroup] = useState<string | undefined>(undefined)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [search, setSearch] = useState("")
  const [filterCat, setFilterCat] = useState("all")
  const [sortMode, setSortMode] = useState(false)
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>({})

  // Item form states
  const [gstIncluded, setGstIncluded] = useState(true)
  const [isAvailable, setIsAvailable] = useState(true)
  const [imagePreview, setImagePreview] = useState<string | null>(null)

  const menuRef = useMemoFirebase(() =>
    restaurant ? collection(db, 'restaurants', restaurant.id, 'menuItems') : null
  , [db, restaurant?.id]);

  const { data: menu, isLoading: isMenuLoading } = useCollection<MenuItem>(menuRef);

  const categories = useMemo(() => {
    return restaurant?.menuCategories && restaurant.menuCategories.length > 0
      ? restaurant.menuCategories
      : DEFAULT_CATEGORIES;
  }, [restaurant]);

  const groupedMenu = useMemo(() => {
    const groups: Map<string, MenuItem[]> = new Map();
    const sortedCats = [...categories].sort();
    sortedCats.forEach(cat => groups.set(cat, []));
    (menu || []).forEach(item => {
      const matchesSearch = item.name.toLowerCase().includes(search.toLowerCase());
      const matchesCatFilter = filterCat === "all" || item.category === filterCat;
      if (matchesSearch && matchesCatFilter) {
        const list = groups.get(item.category) || [];
        list.push(item);
        groups.set(item.category, list);
      }
    });
    return groups;
  }, [menu, categories, search, filterCat]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 1024 * 1024) {
        alert("Image size must be less than 1MB. Please use a smaller photo.");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleOpenAdd = () => {
    setEditingItem(null);
    setIsDuplicating(false);
    setPendingVariantGroup(undefined);
    setGstIncluded(true);
    setIsAvailable(true);
    setImagePreview(null);
    setShowAdd(true);
  };

  const handleOpenEdit = (item: MenuItem) => {
    setEditingItem(item);
    setIsDuplicating(false);
    setPendingVariantGroup(item.variantGroup);
    setGstIncluded(item.gstIncluded ?? true);
    setIsAvailable(item.isAvailable ?? true);
    setImagePreview(item.imageUrl || null);
    setShowAdd(true);
  };

  const handleDuplicate = (item: MenuItem) => {
    if (!menuRef) return;
    let groupId = item.variantGroup;
    if (!groupId) {
      groupId = doc(menuRef).id;
      // Link the source item to this new group
      setDocumentNonBlocking(doc(menuRef, item.id), { variantGroup: groupId }, { merge: true });
    }
    setPendingVariantGroup(groupId);
    setEditingItem(item);
    setIsDuplicating(true);
    setGstIncluded(item.gstIncluded ?? true);
    setIsAvailable(item.isAvailable ?? true);
    setImagePreview(item.imageUrl || null);
    setShowAdd(true);
  };

  const handleSaveItem = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!restaurant || !menuRef) return;

    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const category = formData.get('category') as string;
    const price = parseFloat(formData.get('price') as string) || 0;

    const isEditing = editingItem && !isDuplicating;
    const wasDuplicating = isDuplicating;
    const itemId = isEditing ? editingItem.id : doc(menuRef).id;

    const data: Record<string, unknown> = {
      id: itemId,
      restaurantId: restaurant.id,
      name,
      category,
      price,
      isAvailable,
      gstIncluded,
      imageUrl: imagePreview || "",
      restaurantMembers: restaurant.members,
    };
    if (pendingVariantGroup) {
      data.variantGroup = pendingVariantGroup;
    }

    setIsSubmitting(true);
    setDocumentNonBlocking(doc(menuRef, itemId), data, { merge: true });
    setIsSubmitting(false);
    setShowAdd(false);
    setEditingItem(null);
    setIsDuplicating(false);
    setPendingVariantGroup(undefined);
    setImagePreview(null);
    toast({ title: isEditing ? "Item Updated" : wasDuplicating ? "Variant Added" : "Item Added" });
  };

  const handleDeleteItem = async (id: string) => {
    if (!restaurant || !menuRef) return;
    setIsSubmitting(true);
    try {
      const ordersRef = collection(db, 'restaurants', restaurant.id, 'orders');
      const q = query(ordersRef, limit(100));
      const snapshot = await getDocs(q);
      const isSold = snapshot.docs.some(d => {
        const order = d.data() as SaleOrder;
        return order.items?.some(item => item.itemId === id);
      });
      if (isSold) {
        toast({ variant: "destructive", title: "Cannot Delete Item", description: "This item has sales history. Disable it instead to hide from POS." });
        setIsSubmitting(false);
        return;
      }
      if (!confirm("Are you sure? This item will be permanently removed.")) {
        setIsSubmitting(false);
        return;
      }
      deleteDocumentNonBlocking(doc(menuRef, id));
      toast({ title: "Item Deleted" });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Could not verify sales history." });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMoveEntry = (entries: DisplayEntry[], entryIdx: number, direction: 'up' | 'down') => {
    if (!menuRef) return;
    const swapIdx = direction === 'up' ? entryIdx - 1 : entryIdx + 1;
    if (swapIdx < 0 || swapIdx >= entries.length) return;

    const newEntries = [...entries];
    [newEntries[entryIdx], newEntries[swapIdx]] = [newEntries[swapIdx], newEntries[entryIdx]];

    newEntries.forEach((entry, idx) => {
      const items = entry.type === 'single' ? [entry.item] : entry.items;
      items.forEach(item => updateDocumentNonBlocking(doc(menuRef, item.id), { sortOrder: idx * 10 }));
    });
  };

  if (isRestLoading || isMenuLoading) {
    return <div className="flex h-[80vh] items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>;
  }

  if (!restaurant) return null;

  return (
    <div className="space-y-8 pb-20">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div />
        <div className="flex gap-2">
          <Button
            variant={sortMode ? "default" : "outline"}
            onClick={() => setSortMode(!sortMode)}
            className={cn("gap-2 font-bold h-12 px-5", sortMode && "bg-amber-500 hover:bg-amber-600 border-amber-500 text-white")}
          >
            <GripVertical className="size-4" />
            {sortMode ? 'Done Sorting' : 'Sort Items'}
          </Button>
          <Button onClick={handleOpenAdd} className="gap-2 font-bold shadow-md h-12 px-6">
            <Plus className="size-5" />
            Add Menu Item
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 bg-white p-4 rounded-xl border shadow-sm">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Search dish name..."
            className="pl-9 h-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="size-4 text-muted-foreground" />
          <Select value={filterCat} onValueChange={setFilterCat}>
            <SelectTrigger className="w-[160px] h-10">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-12">
        {Array.from(groupedMenu.entries()).map(([cat, catItems]) => {
          const entries = toDisplayEntries(catItems);
          return (entries.length > 0 || (filterCat !== 'all' && filterCat === cat)) && (
            <div key={cat} className="space-y-6">
              <div className="flex items-center gap-3 border-b pb-2">
                <h2 className="text-xl font-black text-[#00263b] tracking-tight uppercase">{cat}</h2>
                <Badge variant="secondary" className="font-bold text-[10px] px-2">{catItems.length} Items</Badge>
              </div>
              <div className={cn("grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4", sortMode && "pl-8")}>
                {entries.map((entry, entryIdx) => {
                  if (entry.type === 'single') {
                    const item = entry.item;
                    return (
                      <div key={item.id} className="relative">
                        {sortMode && (
                          <div className="absolute -left-8 top-1/2 -translate-y-1/2 flex flex-col gap-0.5 z-10">
                            <Button size="icon" variant="ghost" className="size-6 rounded" disabled={entryIdx === 0} onClick={() => handleMoveEntry(entries, entryIdx, 'up')}>
                              <ChevronUp className="size-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="size-6 rounded" disabled={entryIdx === entries.length - 1} onClick={() => handleMoveEntry(entries, entryIdx, 'down')}>
                              <ChevronDown className="size-3" />
                            </Button>
                          </div>
                        )}
                        <Card className={cn("hover:border-primary/50 transition-all shadow-sm group bg-white overflow-hidden border-none ring-1 ring-slate-200", !item.isAvailable && "opacity-60 grayscale-[0.5]")}>
                          <div className="h-36 w-full relative bg-muted/20">
                            {item.imageUrl ? (
                              <Image src={item.imageUrl} alt={item.name} fill className="object-cover group-hover:scale-105 transition-transform" />
                            ) : (
                              <div className="flex items-center justify-center h-full">
                                <UtensilsCrossed className="size-8 text-muted-foreground/20" />
                              </div>
                            )}
                            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button variant="secondary" size="icon" className="size-8 shadow-md" title="Duplicate / Add variant" onClick={() => handleDuplicate(item)}>
                                <Copy className="size-4" />
                              </Button>
                              <Button variant="secondary" size="icon" className="size-8 shadow-md" onClick={() => handleOpenEdit(item)}>
                                <Pencil className="size-4" />
                              </Button>
                              <Button variant="destructive" size="icon" className="size-8 shadow-md" onClick={() => handleDeleteItem(item.id)} disabled={isSubmitting}>
                                {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                              </Button>
                            </div>
                            {!item.gstIncluded && (
                              <div className="absolute top-2 left-2 px-2 py-0.5 bg-orange-500 text-white rounded text-[8px] font-black uppercase tracking-widest shadow-sm">+5% Tax</div>
                            )}
                            {!item.isAvailable && (
                              <div className="absolute inset-0 bg-black/40 flex items-center justify-center backdrop-blur-[1px]">
                                <Badge variant="destructive" className="font-black text-[10px] uppercase tracking-widest gap-1 shadow-lg">
                                  <EyeOff className="size-3" /> Inactive
                                </Badge>
                              </div>
                            )}
                          </div>
                          <CardContent className="p-5">
                            <h3 className="font-bold text-lg truncate mb-1 text-[#00263b] uppercase tracking-tight">{item.name}</h3>
                            <div className="flex items-baseline gap-1">
                              <p className="text-2xl font-black text-primary">₹{(item.price || 0).toLocaleString('en-IN')}</p>
                              {item.gstIncluded && <span className="text-[9px] font-bold text-muted-foreground uppercase">(MRP)</span>}
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    );
                  } else {
                    // Variant group card
                    const { groupId, items: variantItems, baseName } = entry;
                    const selectedId = selectedVariants[groupId] || variantItems[0]?.id;
                    const selectedItem = variantItems.find(i => i.id === selectedId) || variantItems[0];
                    const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const getLabel = (name: string) =>
                      name.replace(new RegExp(`^${escapedBase}\\s*`, 'i'), '').trim() || name;

                    return (
                      <div key={groupId} className="relative">
                        {sortMode && (
                          <div className="absolute -left-8 top-1/2 -translate-y-1/2 flex flex-col gap-0.5 z-10">
                            <Button size="icon" variant="ghost" className="size-6 rounded" disabled={entryIdx === 0} onClick={() => handleMoveEntry(entries, entryIdx, 'up')}>
                              <ChevronUp className="size-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="size-6 rounded" disabled={entryIdx === entries.length - 1} onClick={() => handleMoveEntry(entries, entryIdx, 'down')}>
                              <ChevronDown className="size-3" />
                            </Button>
                          </div>
                        )}
                        <Card className="hover:border-primary/50 transition-all shadow-sm group bg-white overflow-hidden border-none ring-1 ring-primary/20">
                          <div className="h-36 w-full relative bg-muted/20">
                            {selectedItem?.imageUrl ? (
                              <Image src={selectedItem.imageUrl} alt={baseName} fill className="object-cover group-hover:scale-105 transition-transform" />
                            ) : (
                              <div className="flex items-center justify-center h-full">
                                <UtensilsCrossed className="size-8 text-muted-foreground/20" />
                              </div>
                            )}
                            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button variant="secondary" size="icon" className="size-8 shadow-md" title="Add another variant" onClick={() => handleDuplicate(selectedItem)}>
                                <Copy className="size-4" />
                              </Button>
                              <Button variant="secondary" size="icon" className="size-8 shadow-md" onClick={() => handleOpenEdit(selectedItem)}>
                                <Pencil className="size-4" />
                              </Button>
                              <Button variant="destructive" size="icon" className="size-8 shadow-md" onClick={() => handleDeleteItem(selectedItem.id)} disabled={isSubmitting}>
                                {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                              </Button>
                            </div>
                            {!selectedItem?.gstIncluded && (
                              <div className="absolute top-2 left-2 px-2 py-0.5 bg-orange-500 text-white rounded text-[8px] font-black uppercase tracking-widest shadow-sm">+5% Tax</div>
                            )}
                          </div>
                          <CardContent className="p-4">
                            <h3 className="font-bold text-base truncate mb-2.5 text-[#00263b] uppercase tracking-tight">{baseName}</h3>
                            <div className="flex flex-wrap gap-1.5">
                              {variantItems.map(variant => (
                                <button
                                  key={variant.id}
                                  onClick={() => setSelectedVariants(prev => ({ ...prev, [groupId]: variant.id }))}
                                  className={cn(
                                    "px-2.5 py-1.5 rounded-lg border text-left transition-all min-w-[56px]",
                                    variant.id === selectedId
                                      ? "bg-primary text-white border-primary shadow-sm"
                                      : "border-slate-200 text-slate-600 hover:border-primary/50",
                                    !variant.isAvailable && "opacity-40"
                                  )}
                                >
                                  <div className="text-[9px] font-black uppercase tracking-tight leading-none mb-0.5">{getLabel(variant.name)}</div>
                                  <div className={cn("text-sm font-black leading-none", variant.id === selectedId ? "text-white" : "text-primary")}>
                                    ₹{(variant.price || 0).toLocaleString('en-IN')}
                                  </div>
                                </button>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    );
                  }
                })}
                {entries.length === 0 && (
                  <div className="col-span-full py-12 text-center border-2 border-dashed rounded-xl bg-muted/5">
                    <p className="text-muted-foreground text-xs font-bold italic">No items found in this category.</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {menu?.length === 0 && (
          <div className="py-32 text-center border-2 border-dashed rounded-xl bg-muted/20">
            <UtensilsCrossed className="size-16 mx-auto text-muted-foreground/20 mb-4" />
            <p className="text-muted-foreground font-bold text-xl">Your menu is empty.</p>
            <p className="text-muted-foreground/60 text-sm mt-1">Start by adding your first dish using the button above.</p>
          </div>
        )}
      </div>

      <Dialog open={showAdd} onOpenChange={(open) => { setShowAdd(open); if (!open) { setEditingItem(null); setIsDuplicating(false); setPendingVariantGroup(undefined); setImagePreview(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isDuplicating ? 'Add Variant' : editingItem ? 'Edit Dish Details' : 'Add New Dish'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveItem} className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Dish Image</Label>
              <div className="flex flex-col gap-4">
                {imagePreview ? (
                  <div className="relative w-full h-40 rounded-xl overflow-hidden border-2 border-primary/20 bg-muted">
                    <Image src={imagePreview} alt="Preview" fill className="object-cover" />
                    <Button type="button" variant="destructive" size="icon" className="absolute top-2 right-2 size-8 rounded-full shadow-lg" onClick={() => setImagePreview(null)}>
                      <X className="size-4" />
                    </Button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-xl cursor-pointer bg-muted/30 hover:bg-muted/50 border-muted-foreground/20 transition-all">
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      <Upload className="w-8 h-8 mb-3 text-muted-foreground" />
                      <p className="mb-2 text-sm text-muted-foreground font-bold">Tap to upload photo</p>
                      <p className="text-[10px] text-muted-foreground/60 uppercase font-black">PNG, JPG (Max 1MB)</p>
                    </div>
                    <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
                  </label>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Item Name</Label>
              <Input id="name" name="name" defaultValue={editingItem?.name} placeholder="e.g. Paneer Butter Masala Half" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Select name="category" defaultValue={editingItem?.category || categories[0]}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="price">Price (₹)</Label>
                <Input type="number" name="price" className="font-bold text-lg" defaultValue={editingItem?.price} placeholder="0.00" onWheel={(e) => e.currentTarget.blur()} required />
              </div>
              <div className="space-y-2">
                <Label>Availability</Label>
                <div className="flex items-center space-x-2 bg-muted/30 p-2 rounded-lg border border-dashed h-[40px]">
                  <Switch id="is-available" checked={isAvailable} onCheckedChange={setIsAvailable} />
                  <Label htmlFor="is-available" className="text-[10px] font-black uppercase cursor-pointer">Active in POS</Label>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center space-x-2 bg-muted/30 p-2 rounded-lg border border-dashed h-[40px]">
                <Switch id="gst-included" checked={gstIncluded} onCheckedChange={setGstIncluded} />
                <Label htmlFor="gst-included" className="text-[10px] font-black uppercase cursor-pointer flex items-center gap-1">
                  GST Included
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="size-3 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p className="text-[10px] font-bold">ON: For MRP items (Water, Soda) or Final Price dishes.</p>
                        <p className="text-[10px] font-bold mt-1 text-primary">OFF: Adds 5% tax on top of your menu price.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </Label>
              </div>
            </div>

            <DialogFooter className="pt-4">
              <Button variant="outline" type="button" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button type="submit" className="font-bold" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="animate-spin mr-2" /> : null}
                {isDuplicating ? 'Save as New Variant' : editingItem ? 'Update Item' : 'Add to Menu'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
