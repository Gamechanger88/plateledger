
"use client"

import React from 'react'
import Image from "next/image"
import { UtensilsCrossed, Plus, Minus, GripVertical } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MenuItem, OrderItem } from "@/lib/types"
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from "@/lib/utils"

interface SortableMenuItemProps {
  item: MenuItem;
  inCart: OrderItem | undefined;
  onAdd: (item: MenuItem) => void;
  onUpdateQty: (itemId: string, delta: number) => void;
  isReorderMode: boolean;
}

export function SortableMenuItem({ 
  item, 
  inCart, 
  onAdd, 
  onUpdateQty,
  isReorderMode
}: SortableMenuItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ 
    id: item.id,
    disabled: !isReorderMode 
  });

  const style = {
    transform: transform ? CSS.Transform.toString(transform) : undefined,
    transition,
    zIndex: isDragging ? 50 : 1,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div 
      ref={setNodeRef}
      style={style}
      className={cn(
        "bg-white rounded-xl p-1.5 flex flex-col gap-1.5 group transition-all duration-300 relative border-2 shadow-sm",
        !isReorderMode && "cursor-pointer active:scale-[0.97]",
        inCart ? "border-primary ring-4 ring-primary/5 shadow-md" : "border-transparent hover:shadow-md",
        isDragging && "scale-105 shadow-2xl border-primary",
        isReorderMode && "cursor-default active:scale-100"
      )}
      onClick={() => {
        if (!isDragging && !isReorderMode) onAdd(item);
      }}
    >
      <div className="aspect-[4/3] rounded-lg overflow-hidden relative bg-muted/10 shrink-0">
        {item.imageUrl ? (
          <Image src={item.imageUrl} alt={item.name} fill className="object-cover" />
        ) : (
          <div className="flex items-center justify-center h-full opacity-20"><UtensilsCrossed className="size-6" /></div>
        )}
        
        {/* Functional Handle - Re-engineered for visibility and grab hand cursor */}
        {isReorderMode && (
          <div 
            {...attributes} 
            {...listeners}
            className="absolute top-1 left-1 z-[60] flex items-center justify-center bg-white/90 backdrop-blur-sm rounded-lg shadow-xl p-2.5 cursor-grab active:cursor-grabbing border border-slate-200 hover:bg-white transition-colors touch-none"
            style={{ 
              cursor: 'grab',
              touchAction: 'none' // Crucial for mobile dragging
            }}
            onMouseDown={(e) => e.currentTarget.style.cursor = 'grabbing'}
            onMouseUp={(e) => e.currentTarget.style.cursor = 'grab'}
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="size-6 text-slate-800" />
          </div>
        )}

        {inCart && !isReorderMode && (
          <div className="absolute top-1 right-1 animate-in zoom-in-95 duration-200">
            <div className="bg-primary text-white font-black text-[10px] h-6 min-w-6 px-1 flex items-center justify-center rounded-full shadow-md border-2 border-white">
              {inCart.quantity}
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-col flex-1 px-0.5">
        <span className="font-headline font-black text-[#00263b] leading-tight text-[10px] line-clamp-2 uppercase tracking-tight">{item.name}</span>
        <span className="text-[10px] text-muted-foreground font-black mt-0.5">₹{item.price.toLocaleString('en-IN')}</span>
      </div>
      
      {!isReorderMode && (
        <div className="mt-auto pt-1">
          {inCart ? (
            <div className="flex items-center justify-between bg-primary/5 p-0.5 rounded-lg">
              <Button size="icon" variant="ghost" className="size-6 rounded-md bg-white shadow-sm text-primary hover:bg-primary/5 hover:text-primary" onClick={(e) => { e.stopPropagation(); onUpdateQty(item.id, -1); }}><Minus className="size-2.5" /></Button>
              <span className="font-black text-primary text-xs">{inCart.quantity}</span>
              <Button size="icon" variant="ghost" className="size-6 rounded-md bg-white shadow-sm text-primary hover:bg-primary/5 hover:text-primary" onClick={(e) => { e.stopPropagation(); onAdd(item); }}><Plus className="size-2.5" /></Button>
            </div>
          ) : (
            <div className="w-full h-7 rounded-lg bg-[#046b5e] hover:bg-[#046b5e]/90 text-white font-bold text-[9px] flex items-center justify-center shadow-sm uppercase">Add</div>
          )}
        </div>
      )}
    </div>
  );
}
