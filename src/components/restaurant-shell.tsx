
"use client"

import { useState, useEffect, useRef } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useActiveRestaurant } from "@/hooks/use-active-restaurant"
import { Loader2, Lock, Smartphone, ArrowRight, Hash, Store, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { ReactNode } from "react"
import { useFirestore, useUser } from "@/firebase"
import { collection, query, where, getDocs, doc, setDoc } from "firebase/firestore"

type AuthStep = 'mobile' | 'select' | 'unlock' | 'setup'

export function RestaurantShell({ children }: { children: ReactNode }) {
  const { restaurant, restaurants, isLoading, createInitialRestaurant, setActiveRestaurantId, clearActiveRestaurant, forcedReauth } = useActiveRestaurant()
  const db = useFirestore()
  const { user } = useUser()
  const pathname = usePathname()
  const router = useRouter()

  const [step, setStep] = useState<AuthStep>('mobile')
  const [countryCode, setCountryCode] = useState("+91")
  const [mobileNumber, setMobileNumber] = useState("")
  const [identifiedRestaurants, setIdentifiedRestaurants] = useState<any[]>([])
  const [identifiedRestaurant, setIdentifiedRestaurant] = useState<any>(null)
  const [passcode, setPasscode] = useState(['', '', '', ''])
  const [error, setError] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)
  // Initialize from localStorage immediately to prevent auth flash on refresh
  const [isUnlocked, setIsUnlocked] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('ledger_unlocked') === 'true'
    }
    return false
  })
  const hasRestoredPath = useRef(false)
  const pinRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null)
  ]

  // Normalised mobile — strip ALL whitespace so storage is always consistent
  const fullMobile = `${countryCode}${mobileNumber}`.replace(/\s+/g, '');

  // Save current path while authenticated so we can restore it after refresh
  useEffect(() => {
    if (isUnlocked && restaurant && pathname) {
      localStorage.setItem('ledger_last_path', pathname)
    }
  }, [pathname, isUnlocked, restaurant])

  // Restore last active path on initial authenticated load
  useEffect(() => {
    if (isUnlocked && restaurant && !hasRestoredPath.current) {
      hasRestoredPath.current = true
      const lastPath = localStorage.getItem('ledger_last_path')
      if (lastPath && lastPath !== pathname) {
        router.replace(lastPath)
      }
    }
  }, [isUnlocked, restaurant])

  // Keep isUnlocked in sync with auth state
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedUnlocked = localStorage.getItem('ledger_unlocked')
      if (forcedReauth) {
        setIsUnlocked(false)
        setStep('mobile')
      } else if (storedUnlocked === 'true' && restaurant) {
        setIsUnlocked(true)
      }
      // Don't reset when restaurant is null — it may still be loading
    }
  }, [restaurant, forcedReauth])

  const handleIdentifyMobile = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!mobileNumber) return

    setIsProcessing(true)
    setError("")

    try {
      // Build all whitespace variants to match historical records with inconsistent spacing
      const rawDigits = mobileNumber.replace(/\s+/g, '');
      const spaced = `${rawDigits.slice(0,4)} ${rawDigits.slice(4,7)} ${rawDigits.slice(7)}`;
      const variants = Array.from(new Set([
        // ── no-space (canonical going forward) ──
        `${countryCode}${rawDigits}`,
        // ── +91 SPACE then digits ──
        `${countryCode} ${rawDigits}`,
        `${countryCode} ${spaced}`,
        // ── +91 directly then spaced digits (old format) ──
        `${countryCode}${spaced}`,
      ]));

      const q = query(collection(db, 'restaurants'), where('mobileNumber', 'in', variants))
      const snapshot = await getDocs(q)

      if (!snapshot.empty) {
        setIdentifiedRestaurants(snapshot.docs.map(d => ({ ...d.data(), id: d.id })))
        setStep('select')
      } else {
        setStep('setup')
      }
    } catch (err: any) {
      setError(err.message || "Connection error. Please try again.")
    } finally {
      setIsProcessing(false)
    }
  }

  const performUnlock = async (pin: string) => {
    if (!identifiedRestaurant || !user) return

    if (identifiedRestaurant.passcode === pin) {
      setIsProcessing(true)
      try {
        const restRef = doc(db, 'restaurants', identifiedRestaurant.id)
        const updatedMembers = {
          ...(identifiedRestaurant.members || {}),
          [user.uid]: 'admin'
        }

        await setDoc(restRef, {
          members: updatedMembers
        }, { merge: true })

        setActiveRestaurantId?.(identifiedRestaurant.id)
        localStorage.setItem('ledger_unlocked', 'true')
        setIsUnlocked(true)
        setError("")
      } catch (err: any) {
        setError("Failed to link account. Please check your permissions.")
      } finally {
        setIsProcessing(false)
      }
    } else {
      setError("Invalid passcode. Please try again.")
      setPasscode(['', '', '', ''])
      pinRefs[0].current?.focus()
    }
  }

  const handlePinChange = (index: number, value: string) => {
    if (value.length > 1) value = value.slice(-1)
    if (!/^\d*$/.test(value)) return

    const newPasscode = [...passcode]
    newPasscode[index] = value
    setPasscode(newPasscode)

    if (value && index < 3) {
      pinRefs[index + 1].current?.focus()
    } else if (value && index === 3) {
      performUnlock(newPasscode.join(''))
    }
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !passcode[index] && index > 0) {
      pinRefs[index - 1].current?.focus()
    }
  }

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault()
    performUnlock(passcode.join(''))
  }

  const handleSetup = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const name = formData.get('name') as string
    const code = formData.get('setup_passcode') as string

    if (!name || !code || !user) return

    setIsProcessing(true)
    try {
      const newId = await createInitialRestaurant({ 
        name, 
        mobile: fullMobile, 
        passcode: code 
      })
      if (newId) {
        setActiveRestaurantId(newId)
        localStorage.setItem('ledger_restaurant_id', newId)
      }
      localStorage.setItem('ledger_unlocked', 'true')
      setIsUnlocked(true)
    } catch (err) {
      setError("Setup failed. Please try again.")
    } finally {
      setIsProcessing(false)
    }
  }

  if (isLoading || isProcessing || (isUnlocked && !restaurant && !forcedReauth)) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="size-10 animate-spin text-primary" />
          <p className="text-sm font-medium text-muted-foreground animate-pulse">Accessing Ledger...</p>
        </div>
      </div>
    )
  }

  if (!isUnlocked) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background p-6">
        <Card className="w-full max-w-md shadow-2xl border-primary/20">
          <CardHeader className="text-center">
            <div className="mx-auto size-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              {step === 'setup' ? <Plus className="size-8 text-primary" /> : <Lock className="size-8 text-primary" />}
            </div>
            <CardTitle className="text-2xl font-bold">
              {step === 'mobile' && "Plate Ledger"}
              {step === 'select' && "Select Restaurant"}
              {step === 'unlock' && (identifiedRestaurant?.name || "Unlock Ledger")}
              {step === 'setup' && "Create Restaurant"}
            </CardTitle>
            <CardDescription>
              {step === 'mobile' && "Enter your mobile details to continue."}
              {step === 'select' && `Found ${identifiedRestaurants.length} restaurants for ${fullMobile}`}
              {step === 'unlock' && `Welcome back. Identity verified for ${fullMobile}`}
              {step === 'setup' && `Setting up a new account for ${fullMobile}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {step === 'mobile' && (
              <form onSubmit={handleIdentifyMobile} className="space-y-4">
                <div className="space-y-2">
                  <Label>Mobile Number</Label>
                  <div className="flex gap-2">
                    <div className="w-24 relative">
                      <Hash className="absolute left-2.5 top-3.5 size-3.5 text-muted-foreground" />
                      <Input 
                        placeholder="+91" 
                        value={countryCode}
                        onChange={(e) => setCountryCode(e.target.value)}
                        className="pl-7 h-12 font-bold"
                        required 
                      />
                    </div>
                    <div className="flex-1 relative">
                      <Smartphone className="absolute left-3 top-3.5 size-4 text-muted-foreground" />
                      <Input 
                        placeholder="Mobile Number" 
                        className="pl-9 h-12 text-lg font-bold" 
                        value={mobileNumber}
                        onChange={(e) => {
                          let val = e.target.value.replace(/\D/g, '');
                          if (val.length > 10) val = val.slice(0, 10);
                          let formatted = val;
                          if (val.length > 4) {
                            formatted = val.slice(0,4) + ' ' + val.slice(4);
                          }
                          if (val.length > 7) {
                            formatted = val.slice(0,4) + ' ' + val.slice(4,7) + ' ' + val.slice(7);
                          }
                          setMobileNumber(formatted);
                        }}
                        required 
                      />
                    </div>
                  </div>
                </div>
                {error && <p className="text-sm text-destructive text-center font-medium">{error}</p>}
                <Button type="submit" className="w-full h-12 font-bold text-lg gap-2 mt-2">
                  Continue <ArrowRight className="size-5" />
                </Button>
              </form>
            )}

            {step === 'select' && (
              <div className="space-y-4">
                <Label className="text-center block text-muted-foreground uppercase tracking-widest text-[10px] font-bold">Your Restaurants</Label>
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {identifiedRestaurants.map((rest: any) => (
                    <Button 
                      key={rest.id} 
                      variant="outline" 
                      className="w-full h-14 justify-start font-bold text-lg relative group overflow-hidden"
                      onClick={() => {
                        setIdentifiedRestaurant(rest)
                        setStep('unlock')
                        setError('')
                      }}
                    >
                      <div className="absolute inset-y-0 left-0 w-1 bg-primary group-hover:w-1.5 transition-all" />
                      <Store className="size-5 mx-3 text-primary shrink-0" />
                      <span className="truncate">{rest.name}</span>
                    </Button>
                  ))}
                  <Button 
                    variant="ghost" 
                    className="w-full h-12 text-muted-foreground border border-dashed mt-4 hover:bg-muted/50 hover:text-primary transition-colors"
                    onClick={() => {
                      setStep('setup')
                      setError('')
                    }}
                  >
                    <Plus className="size-4 mr-2" /> Create another restaurant
                  </Button>
                </div>
                <Button variant="ghost" onClick={() => { setStep('mobile'); setError(''); }} className="w-full text-xs text-muted-foreground mt-2">
                  Change Mobile Number
                </Button>
              </div>
            )}

            {step === 'unlock' && (
              <form onSubmit={handleUnlock} className="space-y-6">
                <div className="space-y-4">
                  <Label className="text-center block text-muted-foreground uppercase tracking-widest text-[10px] font-bold">Enter 4-Digit Passcode</Label>
                  <div className="flex justify-center gap-3">
                    {passcode.map((digit, idx) => (
                      <Input
                        key={idx}
                        ref={pinRefs[idx]}
                        type="password"
                        inputMode="numeric"
                        value={digit}
                        onChange={(e) => handlePinChange(idx, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(idx, e)}
                        className="w-14 h-16 text-center text-3xl font-bold bg-muted/20 border-primary/20 focus:border-primary focus:ring-primary rounded-xl"
                        maxLength={1}
                        autoFocus={idx === 0}
                        required
                      />
                    ))}
                  </div>
                </div>
                {error && <p className="text-sm text-destructive text-center font-medium">{error}</p>}
                <div className="space-y-2">
                  <Button type="submit" className="w-full h-12 font-bold text-lg">
                    Unlock Ledger
                  </Button>
                  <Button variant="ghost" onClick={() => { setStep('select'); setError(''); setPasscode(['','','','']); }} className="w-full text-xs text-muted-foreground">
                    Switch Restaurant
                  </Button>
                </div>
              </form>
            )}

            {step === 'setup' && (
              <form onSubmit={handleSetup} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Restaurant Name</Label>
                  <Input id="name" name="name" placeholder="e.g. Bombay Food Express" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="setup_passcode">Set 4-Digit Security Passcode</Label>
                  <Input 
                    id="setup_passcode" 
                    name="setup_passcode" 
                    type="password" 
                    placeholder="1234" 
                    maxLength={4} 
                    className="text-lg font-bold h-12 text-center tracking-[0.5em]" 
                    required 
                  />
                </div>
                {error && <p className="text-sm text-destructive text-center font-medium">{error}</p>}
                <div className="space-y-2">
                  <Button type="submit" className="w-full h-12 font-bold text-lg bg-primary">
                    Create Account
                  </Button>
                  <Button variant="ghost" onClick={() => setStep('mobile')} className="w-full text-xs text-muted-foreground">
                    Cancel & Go Back
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }


  return <>{children}</>
}

