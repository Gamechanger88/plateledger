import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { addDays, format } from "date-fns"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * For non-Cash accounts, payment-IN is settled the next day at 03:30 (T+1 settlement).
 * This mirrors how online/bank settlements work in practice.
 * 
 * @param paymentDate - The original payment date string (yyyy-MM-dd)
 * @param accountType - The type of the sales account ('Cash' | 'Online Payment Gateway' | 'Bank Account')
 * @returns { date: string, time: string } - The effective settlement date and time
 */
export function getSettlementDate(
  paymentDate: string,
  accountType: string | undefined
): { date: string; time: string } {
  if (!paymentDate) return { date: paymentDate, time: '03:30' };
  
  // Only Cash accounts settle same-day
  if (accountType === 'Cash') {
    return { date: paymentDate, time: '03:30' };
  }
  
  // All other accounts (Bank, Online) settle T+1 at 03:30
  try {
    const nextDay = addDays(new Date(paymentDate), 1);
    return { date: format(nextDay, 'yyyy-MM-dd'), time: '03:30' };
  } catch {
    return { date: paymentDate, time: '03:30' };
  }
}
