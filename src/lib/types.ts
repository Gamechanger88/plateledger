
export type AccountType = 'Cash' | 'Online Payment Gateway' | 'Bank Account';

export type MainCategory = 'Fixed Cost' | 'Variable Cost' | 'General';

export type SubCategory = string;

export interface Restaurant {
  id: string;
  name: string;
  currency: string;
  address?: string;
  mobileNumber?: string;
  passcode?: string;
  gstNumber?: string;
  members: Record<string, 'admin' | 'manager' | 'staff'>;
  menuCategories?: string[];
}

export interface POSMethod {
  id: string;
  name: string;
  restaurantId: string;
  linkedAccountId: string; // The SalesAccount this eventually settles into
  isActive: boolean;
  restaurantMembers: Record<string, string>;
  logoUrl?: string;
}

export interface MenuItem {
  id: string;
  restaurantId: string;
  name: string;
  category: string;
  price: number;
  isAvailable: boolean;
  gstIncluded: boolean;
  restaurantMembers: Record<string, string>;
  imageUrl?: string;
  sortOrder?: number;
  variantGroup?: string;
}

export interface OrderItem {
  itemId: string;
  name: string;
  price: number;
  quantity: number;
  gstIncluded: boolean;
  imageUrl?: string;
}

export interface SaleOrder {
  id: string;
  restaurantId: string;
  billNumber: string;
  dailySrNo?: number; // Sequential number for the day
  date: string;
  time: string;
  items: OrderItem[];
  subtotal: number;
  tax: number;
  total: number;
  paymentMethod: string; // The name of the POSMethod used
  posMethodId: string;   // Link to POSMethod entity
  accountId?: string;    // Only populated after settlement
  restaurantMembers: Record<string, string>;
  status?: 'pending' | 'completed' | 'abandoned';
  isSettled?: boolean;   // Tracks if this bill has been fully moved to the financial ledger
  settledAmount?: number; // How much of this specific bill total has been settled
  isActive?: boolean;    // For audit trail: true = current, false = voided
  auditStatus?: 'active' | 'edited' | 'deleted'; // Status label for audit
  previousVersionId?: string; // Links to the record this one replaced
  updatedAt?: string;
}

export interface Staff {
  id: string;
  restaurantId: string;
  name: string;
  monthlySalary: number;
  contactInfo?: string;
  joiningDate?: string;
  lastWorkingDate?: string;
  role?: string;
  restaurantMembers: Record<string, string>;
}

export interface SalesAccount {
  id: string;
  restaurantId: string;
  name: string;
  type: AccountType;
  description?: string;
  restaurantMembers: Record<string, string>;
  balance?: number;
  openingBalanceDate?: string;
  isActiveForBilling?: boolean;
  logoUrl?: string;
}

export interface Party {
  id: string;
  restaurantId: string;
  name: string;
  mainCategory: MainCategory;
  subCategory: SubCategory;
  contactInfo?: string;
  notes?: string;
  restaurantMembers: Record<string, string>;
  openingBalance?: number;
  openingBalanceDate?: string;
  balanceType?: 'Payable' | 'Receivable';
  monthlyAmount?: number;
}

export interface Expense {
  id: string;
  restaurantId: string;
  expenseCategoryId: string; 
  partyId?: string; 
  staffId?: string;
  invoiceDate: string; 
  invoiceTime?: string; 
  paymentDate: string; 
  paymentTime?: string; 
  description: string;
  remark?: string; 
  amount: number;
  vendor?: string; 
  restaurantMembers: Record<string, string>;
  category?: MainCategory; 
  subCategory?: SubCategory;
  accountId?: string;
  isAccrual?: boolean; 
  // Staff Specific Fields
  staffUnits?: number; // 1 for full day, 0.5 for half day, etc
  staffEntryType?: 'Regular' | 'Half Day' | 'Overtime' | 'Bonus' | 'Other';
}

export interface SalePayment {
  id: string;
  restaurantId: string;
  saleTransactionId: string; // Can be a POS Order ID or 'manual-ledger' or 'settlement-batch'
  salesAccountId: string;
  paymentDate: string;
  paymentTime?: string; 
  amount: number;
  paymentMethod: string;
  restaurantMembers: Record<string, string>;
  description?: string;
  remark?: string;
  businessDate?: string;
}

export interface Transfer {
  id: string;
  restaurantId: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  date: string;
  time?: string;
  description?: string;
  remark?: string;
  restaurantMembers: Record<string, string>;
}

export interface DayStatus {
  id: string; // date string yyyy-MM-dd
  restaurantId: string;
  isClosed: boolean;
  restaurantMembers: Record<string, string>;
}

export interface MonthlyBalance {
  id: string; // accountId_YYYY-MM or partyId_YYYY-MM
  restaurantId: string;
  accountId: string; // The ID of the Account or Party
  entityType?: 'account' | 'party'; // To distinguish between bank accounts and vendors/customers
  monthStr: string; // YYYY-MM
  actualOpeningBalance: number;
  restaurantMembers: Record<string, string>;
}
