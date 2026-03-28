"use client"

import { usePathname } from "next/navigation"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { ReactNode, useEffect, useState, useRef } from "react"
import { useDateContext, DateMode } from "@/contexts/date-context"
import { format, startOfMonth, endOfMonth, addMonths, subMonths } from "date-fns"
import { ChevronLeft, ChevronRight, CalendarDays, LogOut, Camera, Smartphone, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
  DropdownMenuSeparator, DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover"
import { useActiveRestaurant } from "@/hooks/use-active-restaurant"
import { useAuth, useUser } from "@/firebase"
import { signOut } from "firebase/auth"
import { cn } from "@/lib/utils"

/* ── Profile button (top-right of header) ─────────────────────────── */
function ProfileButton() {
  const { restaurant, userId } = useActiveRestaurant()
  const { user } = useUser()
  const auth = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const storageKey = user?.uid ? `pl_profile_image_${user.uid}` : null
  const [profileImage, setProfileImage] = useState<string | null>(null)

  useEffect(() => {
    if (storageKey) {
      const saved = localStorage.getItem(storageKey)
      if (saved) setProfileImage(saved)
    }
  }, [storageKey])

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !storageKey) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const base64 = ev.target?.result as string
      localStorage.setItem(storageKey, base64)
      setProfileImage(base64)
    }
    reader.readAsDataURL(file)
  }

  const handleLogout = async () => {
    try {
      await signOut(auth)
      localStorage.removeItem('ledger_unlocked')
      window.location.href = "/"
    } catch (err) {
      console.error("Logout failed", err)
    }
  }

  const mobile = restaurant?.mobileNumber || ''
  const role = restaurant && userId ? (restaurant.members?.[userId] || 'staff') : 'staff'
  const initials = mobile.replace(/\D/g, '').slice(-4) || 'PL'

  return (
    <>
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="rounded-full ring-2 ring-primary/20 hover:ring-primary/50 transition-all focus:outline-none">
            <Avatar className="size-8">
              {profileImage && <AvatarImage src={profileImage} alt="Profile" className="object-cover" />}
              <AvatarFallback className="bg-primary/10 text-primary text-[10px] font-black">{initials}</AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 p-0 overflow-hidden">
          <div className="bg-primary/5 px-4 py-4 flex items-center gap-3">
            <div className="relative group">
              <Avatar className="size-14 ring-2 ring-primary/20">
                {profileImage && <AvatarImage src={profileImage} alt="Profile" className="object-cover" />}
                <AvatarFallback className="bg-primary/10 text-primary text-sm font-black">{initials}</AvatarFallback>
              </Avatar>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
              >
                <Camera className="size-4 text-white" />
              </button>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-bold text-foreground truncate">
                <Smartphone className="size-3 text-muted-foreground shrink-0" />
                <span>{mobile || 'No mobile set'}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <ShieldCheck className="size-3 text-primary shrink-0" />
                <span className="text-[10px] font-black uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded">{role}</span>
              </div>
              {restaurant?.name && <p className="text-[10px] text-muted-foreground mt-1 truncate font-medium">{restaurant.name}</p>}
            </div>
          </div>
          <DropdownMenuSeparator className="m-0" />
          <div className="p-1">
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()} className="gap-2 cursor-pointer h-9 text-xs font-semibold">
              <Camera className="size-4 text-muted-foreground" /> Change Profile Photo
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="gap-2 cursor-pointer h-9 text-destructive focus:text-destructive focus:bg-destructive/5 text-xs font-bold">
              <LogOut className="size-4" /> Log Out
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}

/* ── Rich date range picker ────────────────────────────────────────── */
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const AVAILABLE_YEARS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 2 + i)

function DateRangePicker() {
  const {
    mode, activeMonth, activeYear, activeQuarter, activeHalf,
    customStart, customEnd, displayLabel,
    setMode, setActiveMonth, setActiveYear, setActiveQuarter, setActiveHalf,
    setCustomRange, prevPeriod, nextPeriod,
  } = useDateContext()

  const [open, setOpen] = useState(false)
  const [tempStart, setTempStart] = useState(customStart)
  const [tempEnd, setTempEnd] = useState(customEnd)
  const [pickerYear, setPickerYear] = useState(activeYear)

  // sync picker year when context year changes
  useEffect(() => { setPickerYear(activeYear) }, [activeYear])

  const select = (m: DateMode) => { setMode(m); setOpen(false) }

  const pill = (label: string, active: boolean, onClick: () => void) => (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1 rounded-full text-[11px] font-bold transition-colors",
        active ? "bg-primary text-white" : "bg-muted hover:bg-muted/80 text-foreground"
      )}
    >
      {label}
    </button>
  )

  const canNav = !['today','yesterday','thisweek','custom'].includes(mode)

  return (
    <div className="flex items-center gap-0 h-8">
      {/* Prev */}
      <Button
        variant="ghost" size="icon"
        onClick={prevPeriod}
        disabled={!canNav}
        className="h-8 w-7 rounded-l-lg rounded-r-none border border-r-0 hover:bg-primary/10 disabled:opacity-30"
      >
        <ChevronLeft className="size-3.5" />
      </Button>

      {/* Label / trigger */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className="h-8 flex items-center gap-1.5 px-3 border border-x-0 bg-white hover:bg-primary/5 text-sm font-bold min-w-[150px] justify-center transition-colors">
            <CalendarDays className="size-3.5 text-primary shrink-0" />
            {displayLabel}
          </button>
        </PopoverTrigger>

        <PopoverContent align="center" className="w-72 p-0 shadow-xl" sideOffset={6}>
          {/* Quick */}
          <div className="p-3 border-b">
            <p className="text-[9px] font-black uppercase text-muted-foreground mb-2">Quick</p>
            <div className="flex flex-wrap gap-1.5">
              {pill('Today', mode === 'today', () => select('today'))}
              {pill('Yesterday', mode === 'yesterday', () => select('yesterday'))}
              {pill('This Week', mode === 'thisweek', () => select('thisweek'))}
            </div>
          </div>

          {/* Monthly */}
          <div className="p-3 border-b">
            <p className="text-[9px] font-black uppercase text-muted-foreground mb-2">Monthly</p>
            <div className="flex items-center justify-between gap-1">
              <button onClick={() => setActiveMonth(subMonths(activeMonth, 1))} className="p-1 rounded hover:bg-muted">
                <ChevronLeft className="size-3.5" />
              </button>
              <button
                onClick={() => { setMode('monthly'); setOpen(false) }}
                className={cn(
                  "flex-1 py-1 rounded text-xs font-bold text-center transition-colors",
                  mode === 'monthly' ? "bg-primary text-white" : "hover:bg-muted"
                )}
              >
                {format(activeMonth, 'MMMM yyyy')}
              </button>
              <button onClick={() => setActiveMonth(addMonths(activeMonth, 1))} className="p-1 rounded hover:bg-muted">
                <ChevronRight className="size-3.5" />
              </button>
            </div>
          </div>

          {/* Quarterly */}
          <div className="p-3 border-b">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[9px] font-black uppercase text-muted-foreground">Quarterly</p>
              <div className="flex items-center gap-1">
                <button onClick={() => setPickerYear(y => y - 1)} className="p-0.5 rounded hover:bg-muted"><ChevronLeft className="size-3" /></button>
                <span className="text-[11px] font-bold w-10 text-center">{pickerYear}</span>
                <button onClick={() => setPickerYear(y => y + 1)} className="p-0.5 rounded hover:bg-muted"><ChevronRight className="size-3" /></button>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {[1,2,3,4].map(q => (
                <button
                  key={q}
                  onClick={() => { setActiveYear(pickerYear); setActiveQuarter(q); select('quarterly') }}
                  className={cn(
                    "py-1 rounded text-[11px] font-bold transition-colors",
                    mode === 'quarterly' && activeQuarter === q && activeYear === pickerYear
                      ? "bg-primary text-white"
                      : "bg-muted hover:bg-muted/80"
                  )}
                >
                  Q{q}
                </button>
              ))}
            </div>
          </div>

          {/* Half-Year */}
          <div className="p-3 border-b">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[9px] font-black uppercase text-muted-foreground">Half-Year</p>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {[1,2].map(h => (
                <button
                  key={h}
                  onClick={() => { setActiveYear(pickerYear); setActiveHalf(h); select('halfyear') }}
                  className={cn(
                    "py-1 rounded text-[11px] font-bold transition-colors",
                    mode === 'halfyear' && activeHalf === h && activeYear === pickerYear
                      ? "bg-primary text-white"
                      : "bg-muted hover:bg-muted/80"
                  )}
                >
                  H{h} · {h === 1 ? 'Jan–Jun' : 'Jul–Dec'}
                </button>
              ))}
            </div>
          </div>

          {/* Yearly */}
          <div className="p-3 border-b">
            <p className="text-[9px] font-black uppercase text-muted-foreground mb-2">Yearly</p>
            <div className="flex flex-wrap gap-1">
              {AVAILABLE_YEARS.map(y => (
                <button
                  key={y}
                  onClick={() => { setActiveYear(y); select('yearly') }}
                  className={cn(
                    "px-2 py-0.5 rounded text-[11px] font-bold transition-colors",
                    mode === 'yearly' && activeYear === y ? "bg-primary text-white" : "bg-muted hover:bg-muted/80"
                  )}
                >
                  {y}
                </button>
              ))}
            </div>
          </div>

          {/* Custom */}
          <div className="p-3">
            <p className="text-[9px] font-black uppercase text-muted-foreground mb-2">Custom Range</p>
            <div className="flex items-center gap-1.5">
              <Input
                type="date" value={tempStart}
                onChange={e => setTempStart(e.target.value)}
                className="h-7 text-[11px] flex-1 px-2"
              />
              <span className="text-[10px] text-muted-foreground font-bold">–</span>
              <Input
                type="date" value={tempEnd}
                onChange={e => setTempEnd(e.target.value)}
                className="h-7 text-[11px] flex-1 px-2"
              />
              <Button
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => { if (tempStart && tempEnd) { setCustomRange(tempStart, tempEnd); select('custom') } }}
              >
                Apply
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* Next */}
      <Button
        variant="ghost" size="icon"
        onClick={nextPeriod}
        disabled={!canNav}
        className="h-8 w-7 rounded-r-lg rounded-l-none border border-l-0 hover:bg-primary/10 disabled:opacity-30"
      >
        <ChevronRight className="size-3.5" />
      </Button>
    </div>
  )
}

/* ── Global header ─────────────────────────────────────────────────── */
function GlobalHeader() {
  const { setActiveMonth } = useDateContext()

  return (
    <header className="shrink-0 z-40 flex items-center justify-between h-12 px-4 border-b bg-white/95 backdrop-blur-sm shadow-sm">
      <div className="w-24" />
      <DateRangePicker />
      <div className="flex items-center gap-2 w-24 justify-end">
        <Button
          variant="outline" size="sm"
          onClick={() => setActiveMonth(new Date())}
          className="h-8 text-xs font-bold hidden sm:flex"
        >
          Today
        </Button>
        <ProfileButton />
      </div>
    </header>
  )
}

/* ── Main layout ───────────────────────────────────────────────────── */
export function MainLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [sidebarOpen, setSidebarOpen] = useState(true)

  useEffect(() => {
    const check = () => setSidebarOpen(window.innerWidth >= 1200)
    check()
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [])

  const isFullscreenMode = pathname.startsWith('/pos') || pathname === '/revenue'

  if (isFullscreenMode) {
    return (
      <div className="min-h-screen w-full bg-background overflow-hidden flex flex-col">
        <main className="flex-1 p-1 overflow-hidden">{children}</main>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <GlobalHeader />
      <SidebarProvider
        defaultOpen={sidebarOpen}
        style={{ minHeight: 0 }}
        className="flex-1 overflow-hidden"
      >
        <AppSidebar />
        <SidebarInset
          style={{ minHeight: 0 }}
          className="min-w-0 overflow-x-hidden overflow-y-auto"
        >
          <main className="p-2 md:p-3 lg:p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </div>
  )
}
