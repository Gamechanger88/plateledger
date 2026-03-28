'use client';

// This hook is now a thin wrapper around the shared RestaurantContext.
// All components in the app share the same activeRestaurantId state — switching
// restaurants in the shell immediately reflects in every page.
export { useRestaurantContext as useActiveRestaurant } from '@/contexts/restaurant-context';
