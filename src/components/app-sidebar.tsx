"use client"

import { useState } from "react"
import { LayoutDashboard, ReceiptText, Users, Wallet, FileText, ArrowLeftRight, MapPin, Store, Contact2, UtensilsCrossed, MonitorDot, Settings, BookOpen, ChevronsUpDown, Plus, Check, PanelLeftClose, PanelLeftOpen } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useActiveRestaurant } from "@/hooks/use-active-restaurant"
import { cn } from "@/lib/utils"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const mainItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Quick Billing", url: "/pos", icon: MonitorDot },
  { title: "Menu Items", url: "/menu", icon: UtensilsCrossed },
  { title: "Invoices", url: "/invoices", icon: ReceiptText },
  { title: "Transactions", url: "/transactions", icon: ArrowLeftRight },
  { title: "Reports", url: "/reports", icon: FileText },
  { title: "Balance", url: "/balance", icon: BookOpen },
]

const settingsItems = [
  { title: "Parties", url: "/parties", icon: Users },
  { title: "Staff", url: "/staff", icon: Contact2 },
  { title: "Accounts", url: "/accounts", icon: Wallet },
  { title: "General Settings", url: "/settings", icon: Settings },
]

export function AppSidebar() {
  const pathname = usePathname()
  const { restaurant, restaurants, setActiveRestaurantId, clearActiveRestaurant } = useActiveRestaurant()
  const { setOpenMobile, toggleSidebar, open } = useSidebar()
  const [showRestaurantMenu, setShowRestaurantMenu] = useState(false)

  return (
    <Sidebar collapsible="icon">
      {/* Header: collapse toggle only */}
      <SidebarHeader className="border-b flex items-center h-12 px-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
        <button
          onClick={toggleSidebar}
          className="size-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
        >
          {open ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
        </button>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="px-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">Operations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="px-2 gap-1 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:items-center">
              {mainItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.url}
                    tooltip={item.title}
                    className={cn(
                      "h-9 px-3 transition-all duration-200",
                      pathname === item.url
                        ? "bg-primary/15 text-primary shadow-sm hover:bg-primary/20 hover:text-primary"
                        : "hover:bg-muted/50"
                    )}
                    onClick={() => setOpenMobile(false)}
                  >
                    <Link href={item.url}>
                      <item.icon className="size-5" />
                      <span className="font-bold">{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="px-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">Settings & Setup</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="px-2 gap-1 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:items-center">
              {settingsItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.url}
                    tooltip={item.title}
                    className={cn(
                      "h-9 px-3 transition-all duration-200",
                      pathname === item.url
                        ? "bg-primary/15 text-primary shadow-sm hover:bg-primary/20 hover:text-primary"
                        : "hover:bg-muted/50"
                    )}
                    onClick={() => setOpenMobile(false)}
                  >
                    <Link href={item.url}>
                      <item.icon className="size-5" />
                      <span className="font-bold">{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-3 border-t bg-muted/5 flex flex-col gap-2 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-2">
        {/* Restaurant switcher */}
        <DropdownMenu open={showRestaurantMenu} onOpenChange={setShowRestaurantMenu}>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-white/60 transition-colors w-full text-left group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0">
              <div className="size-8 rounded-lg bg-accent/10 flex items-center justify-center text-accent ring-1 ring-accent/20 shrink-0">
                <Store className="size-4" />
              </div>
              <div className="flex flex-col overflow-hidden flex-1 group-data-[collapsible=icon]:hidden">
                <span className="text-xs font-bold truncate">{restaurant?.name || 'My Restaurant'}</span>
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium truncate">
                  <MapPin className="size-3 shrink-0" />
                  <span>{restaurant?.address || 'Set location in settings'}</span>
                </div>
              </div>
              <ChevronsUpDown className="size-3.5 text-muted-foreground shrink-0 group-data-[collapsible=icon]:hidden" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" className="w-56 mb-1">
            <div className="px-2 py-1.5 border-b mb-1">
              <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">Your Restaurants</p>
            </div>
            {(restaurants || []).map(r => (
              <DropdownMenuItem
                key={r.id}
                onClick={() => { setActiveRestaurantId(r.id); setShowRestaurantMenu(false); }}
                className="gap-2 cursor-pointer"
              >
                <div className={cn(
                  "size-5 rounded-full flex items-center justify-center text-[8px] font-black shrink-0",
                  r.id === restaurant?.id ? "bg-primary text-white" : "bg-muted text-muted-foreground"
                )}>
                  {r.id === restaurant?.id ? <Check className="size-3" /> : r.name?.[0]?.toUpperCase()}
                </div>
                <span className="text-xs font-semibold truncate">{r.name}</span>
              </DropdownMenuItem>
            ))}
            <div className="border-t mt-1 pt-1">
              <DropdownMenuItem
                onClick={() => { clearActiveRestaurant(); setShowRestaurantMenu(false); }}
                className="gap-2 cursor-pointer text-emerald-700 focus:text-emerald-700 focus:bg-emerald-50"
              >
                <div className="size-5 rounded-full bg-emerald-50 flex items-center justify-center shrink-0">
                  <Plus className="size-3 text-emerald-600" />
                </div>
                <span className="text-xs font-semibold">Login / Add Restaurant</span>
              </DropdownMenuItem>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Brand — bottom of sidebar */}
        <div className="flex items-center gap-2 px-1.5 py-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <div className="size-7 rounded-lg bg-primary flex items-center justify-center text-white shadow-sm ring-1 ring-primary/20 shrink-0">
            <ReceiptText className="size-3.5" />
          </div>
          <span className="font-headline font-black text-xs tracking-widest uppercase text-muted-foreground group-data-[collapsible=icon]:hidden">
            Plate Ledger
          </span>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
