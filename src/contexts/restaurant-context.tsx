'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { collection, doc, setDoc, getDoc, query, where } from 'firebase/firestore';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { useAuth } from '@/firebase';
import { Restaurant } from '@/lib/types';
import { initiateAnonymousSignIn } from '@/firebase/non-blocking-login';

const DEFAULT_MENU_CATEGORIES = ["Starters", "Main Course", "Fast Food", "Drinks", "Desserts", "Sides"];

interface RestaurantContextValue {
  restaurant: Restaurant | null;
  restaurants: Restaurant[] | undefined;
  isLoading: boolean;
  forcedReauth: boolean;
  userId: string | undefined;
  createInitialRestaurant: (data: { name: string; mobile: string; passcode: string }) => Promise<string | undefined>;
  setActiveRestaurantId: (id: string) => void;
  clearActiveRestaurant: () => void;
}

const RestaurantContext = createContext<RestaurantContextValue | null>(null);

export function RestaurantProvider({ children }: { children: ReactNode }) {
  const { user, isUserLoading } = useUser();
  const firestore = useFirestore();
  const auth = useAuth();

  // Ensure user is signed in
  useEffect(() => {
    if (!isUserLoading && !user && auth) {
      initiateAnonymousSignIn(auth);
    }
  }, [isUserLoading, user, auth]);

  // Find restaurants where this UID is a member
  const restaurantsQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return query(
      collection(firestore, 'restaurants'),
      where(`members.${user.uid}`, 'in', ['admin', 'manager', 'staff'])
    );
  }, [firestore, user?.uid]);

  const { data: restaurants, isLoading: isRestaurantsLoading } = useCollection<Restaurant>(restaurantsQuery);

  // ── Shared active restaurant ID (single source of truth) ──────────────────
  const [activeRestaurantId, setActiveRestaurantIdState] = useState<string | null>(null);
  const [forcedReauth, setForcedReauth] = useState(false);
  const [isSilentlyRelinking, setIsSilentlyRelinking] = useState(false);

  // Hydrate from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ledger_restaurant_id');
      if (saved) setActiveRestaurantIdState(saved);
    }
  }, []);

  // If stored ID isn't accessible by this UID, attempt silent re-link (UID changed) or force re-auth
  useEffect(() => {
    if (isUserLoading) return;
    if (isRestaurantsLoading) return;
    if (!activeRestaurantId) return;
    const accessible = restaurants?.find(r => r.id === activeRestaurantId);
    if (!accessible && restaurants !== undefined) {
      const deviceWasAuthorized = typeof window !== 'undefined' &&
        localStorage.getItem('ledger_unlocked') === 'true';

      if (deviceWasAuthorized && user && firestore) {
        // UID changed but this device was previously authorized — silently re-link
        setIsSilentlyRelinking(true);
        const restRef = doc(firestore, 'restaurants', activeRestaurantId);
        getDoc(restRef).then((snap) => {
          if (!snap.exists()) throw new Error('not-found');
          const data = snap.data();
          return setDoc(restRef, { members: { ...data.members, [user.uid]: 'admin' } }, { merge: true });
        }).then(() => {
          setIsSilentlyRelinking(false);
          // onSnapshot will re-fire and pick up the new membership
        }).catch(() => {
          setIsSilentlyRelinking(false);
          if (typeof window !== 'undefined') localStorage.removeItem('ledger_unlocked');
          setForcedReauth(true);
        });
      } else {
        if (typeof window !== 'undefined') localStorage.removeItem('ledger_unlocked');
        setForcedReauth(true);
      }
    } else {
      setForcedReauth(false);
    }
  }, [restaurants, activeRestaurantId, isRestaurantsLoading, isUserLoading, user, firestore]);

  const setActiveRestaurantId = (id: string) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('ledger_restaurant_id', id);
    }
    setActiveRestaurantIdState(id);
  };

  const clearActiveRestaurant = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('ledger_restaurant_id');
      localStorage.removeItem('ledger_unlocked');
    }
    setActiveRestaurantIdState(null);
  };

  const activeRestaurant = restaurants?.find(r => r.id === activeRestaurantId) || restaurants?.[0] || null;

  const createInitialRestaurant = async (data: { name: string; mobile: string; passcode: string }) => {
    if (!user || !firestore) return;
    const restaurantId = doc(collection(firestore, 'restaurants')).id;
    const restaurantRef = doc(firestore, 'restaurants', restaurantId);
    await setDoc(restaurantRef, {
      id: restaurantId,
      name: data.name,
      mobileNumber: data.mobile,
      passcode: data.passcode,
      currency: 'INR',
      members: { [user.uid]: 'admin' },
      menuCategories: DEFAULT_MENU_CATEGORIES,
    });
    return restaurantId;
  };

  return (
    <RestaurantContext.Provider value={{
      restaurant: activeRestaurant,
      restaurants: (restaurants ?? undefined) as Restaurant[] | undefined,
      isLoading: isUserLoading || isRestaurantsLoading || isSilentlyRelinking,
      forcedReauth,
      userId: user?.uid,
      createInitialRestaurant,
      setActiveRestaurantId,
      clearActiveRestaurant,
    }}>
      {children}
    </RestaurantContext.Provider>
  );
}

export function useRestaurantContext() {
  const ctx = useContext(RestaurantContext);
  if (!ctx) throw new Error('useRestaurantContext must be used within RestaurantProvider');
  return ctx;
}
