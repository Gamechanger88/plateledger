import {
  collection,
  query,
  where,
  getDocs,
  doc,
  setDoc,
  writeBatch,
  DocumentReference,
  serverTimestamp,
} from 'firebase/firestore';

export interface VyaparImportJob {
  id: string;
  fileName: string;
  status: 'running' | 'done' | 'error';
  totalRows: number;
  processedRows: number;
  salesCount: number;
  expenseCount: number;
  transferCount: number;
  startedAt: any;
  finishedAt?: any;
  error?: string;
}

const CHUNK_SIZE = 200;
const yieldToUI = () => new Promise<void>(resolve => setTimeout(resolve, 10));

/** Determine the MainCategory for a party/expense based on name and expenseType */
function inferCategory(name: string, expenseType: string): { main: string; sub: string } {
  const lower = (name + ' ' + expenseType).toLowerCase();
  if (lower.includes('salary') || lower.includes('wages') || lower.includes('staff')) {
    return { main: 'Fixed Cost', sub: 'Salary' };
  }
  if (lower.includes('rent') || lower.includes('lease')) {
    return { main: 'Fixed Cost', sub: 'Rent' };
  }
  if (lower.includes('electricity') || lower.includes('electric') || lower.includes('power') || lower.includes('light')) {
    return { main: 'Fixed Cost', sub: 'Electricity' };
  }
  if (lower.includes('gas') || lower.includes('lpg') || lower.includes('fuel') || lower.includes('petrol')) {
    return { main: 'Variable Cost', sub: 'Gas & Fuel' };
  }
  if (lower.includes('mandi') || lower.includes('vegetable') || lower.includes('sabzi') || lower.includes('provision')) {
    return { main: 'Variable Cost', sub: 'Raw Materials' };
  }
  if (lower.includes('dairy') || lower.includes('milk')) {
    return { main: 'Variable Cost', sub: 'Raw Materials' };
  }
  if (lower.includes('transport') || lower.includes('delivery') || lower.includes('logistics')) {
    return { main: 'Variable Cost', sub: 'Transport' };
  }
  return { main: 'Variable Cost', sub: 'Purchase' };
}

/** Map Vyapar sale item name to an account type and cleaned name.
 *  Returns null if the item doesn't look like a payment channel (skip it). */
function mapSaleItemToAccount(itemName: string): { accountName: string; accountType: string } | null {
  const lower = itemName.toLowerCase();
  // Strip leading "Sale " or trailing " Sale" to get a clean channel name
  const clean = itemName.replace(/^sale\s+/i, '').replace(/\s+sale$/i, '').trim() || itemName;

  if (lower.includes('cash')) {
    return { accountName: 'Cash', accountType: 'Cash' };
  }
  if (lower.includes('paytm')) {
    return { accountName: 'Paytm', accountType: 'Online Payment Gateway' };
  }
  if (lower.includes('gpay') || lower.includes('google pay')) {
    return { accountName: 'GPay', accountType: 'Online Payment Gateway' };
  }
  if (lower.includes('phonepe') || lower.includes('phone pe')) {
    return { accountName: 'PhonePe', accountType: 'Online Payment Gateway' };
  }
  if (lower.includes('upi')) {
    return { accountName: clean, accountType: 'Online Payment Gateway' };
  }
  if (lower.includes('swiggy')) {
    return { accountName: 'Swiggy', accountType: 'Online Payment Gateway' };
  }
  if (lower.includes('zomato')) {
    return { accountName: 'Zomato', accountType: 'Online Payment Gateway' };
  }
  if (lower.includes('online')) {
    return { accountName: clean, accountType: 'Online Payment Gateway' };
  }
  if (lower.includes('card') || lower.includes('neft') || lower.includes('rtgs') || lower.includes('imps')) {
    return { accountName: clean, accountType: 'Bank Account' };
  }
  // Item starts with "sale" but doesn't match known payment keywords — still import as online
  if (lower.startsWith('sale')) {
    return { accountName: clean, accountType: 'Online Payment Gateway' };
  }
  // Unknown: skip
  return null;
}

/**
 * Main Vyapar (.vyb) importer.
 *
 * Flow:
 *  1. Upload the .vyb file to the /api/vyapar-parse route (server parses ZIP + SQLite)
 *  2. Receive structured JSON data
 *  3. Create / find salesAccounts for each unique sale payment method
 *  4. Create / find parties for each vendor
 *  5. Write salePayments from sale invoice lineitems (revenue by channel)
 *  6. Write expenses from purchase invoices (accrual) and payment outs (cash paid)
 */
export async function processVyaparImport(
  file: File,
  restaurantId: string,
  members: any,
  db: any,
  importJobRef: DocumentReference,
  onProgress: (msg: string) => void,
) {
  try {
  // ── Step 1: Upload file to API route for parsing ───────────────────────────
  onProgress('Uploading file to server for parsing...');
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/vyapar-parse', { method: 'POST', body: formData });
  if (!response.ok) {
    const errBody = await response.json().catch(() => ({ error: 'Unknown server error' }));
    throw new Error(errBody.error || `Server error ${response.status}`);
  }

  const data = await response.json();
  const { paymentTypes, parties, saleLineitems, purchaseInvoices, paymentOuts, summary } = data;

  const totalRows = saleLineitems.length + purchaseInvoices.length + paymentOuts.length;
  onProgress(`Parsed: ${summary.saleLineitemsCount} sales + ${summary.purchaseInvoicesCount} purchases + ${summary.paymentOutsCount} payments. Setting up accounts & parties...`);

  await setDoc(importJobRef, { totalRows }, { merge: true });

  // ── Step 2: Create / find salesAccounts ───────────────────────────────────
  // Load existing salesAccounts
  const existingAccSnap = await getDocs(collection(db, 'restaurants', restaurantId, 'salesAccounts'));
  const accountByName = new Map<string, string>(); // lower(name) → id
  existingAccSnap.docs.forEach(d => {
    const n = (d.data().name as string || '').trim().toLowerCase();
    if (n) accountByName.set(n, d.id);
  });

  // Collect unique account names from sale lineitems
  const uniqueSaleItems: string[] = Array.from(new Set(saleLineitems.map((r: any) => r.itemName as string).filter(Boolean)));
  const accountIdMap = new Map<string, string>(); // itemName → salesAccountId

  for (const itemName of uniqueSaleItems) {
    const mapped = mapSaleItemToAccount(itemName);
    if (!mapped) continue; // non-payment item — no account to create
    const { accountName, accountType } = mapped;
    const lower = accountName.toLowerCase();
    if (accountByName.has(lower)) {
      accountIdMap.set(itemName, accountByName.get(lower)!);
    } else {
      const newRef = doc(collection(db, 'restaurants', restaurantId, 'salesAccounts'));
      await setDoc(newRef, {
        id: newRef.id,
        restaurantId,
        name: accountName,
        type: accountType,
        isActive: true,
        isActiveForBilling: false,
        restaurantMembers: members,
      });
      accountIdMap.set(itemName, newRef.id);
      accountByName.set(lower, newRef.id);
    }
  }

  // ── Step 3: Create / find parties (vendors) ───────────────────────────────
  const existingPartiesSnap = await getDocs(collection(db, 'restaurants', restaurantId, 'parties'));
  const partyByName = new Map<string, string>(); // lower(name) → id
  existingPartiesSnap.docs.forEach(d => {
    const n = (d.data().name as string || '').trim().toLowerCase();
    if (n) partyByName.set(n, d.id);
  });

  // All unique vendor names from purchase invoices and payment outs
  const allVendorNames = Array.from(new Set([
    ...purchaseInvoices.map((r: any) => r.partyName as string),
    ...paymentOuts.map((r: any) => r.partyName as string),
    ...parties.filter((p: any) => p.nameType === 1 && p.name).map((p: any) => p.name as string),
  ].filter(Boolean)));

  const partyIdMap = new Map<string, string>(); // name → partyId
  // Build a lookup from Vyapar party list for extra info (phone, expenseType)
  const vyaparPartyInfo = new Map<string, { phone: string; expenseType: string }>();
  parties.forEach((p: any) => {
    if (p.name) vyaparPartyInfo.set(p.name, { phone: p.phone || '', expenseType: p.expenseType || '' });
  });

  for (const vendorName of allVendorNames) {
    const lower = vendorName.toLowerCase();
    if (partyByName.has(lower)) {
      partyIdMap.set(vendorName, partyByName.get(lower)!);
      continue;
    }
    const info = vyaparPartyInfo.get(vendorName) || { phone: '', expenseType: '' };
    const { main, sub } = inferCategory(vendorName, info.expenseType);
    const newRef = doc(collection(db, 'restaurants', restaurantId, 'parties'));
    await setDoc(newRef, {
      id: newRef.id,
      restaurantId,
      name: vendorName,
      mainCategory: main,
      subCategory: sub,
      ...(info.phone ? { contactInfo: info.phone } : {}),
      restaurantMembers: members,
    });
    partyIdMap.set(vendorName, newRef.id);
    partyByName.set(lower, newRef.id);
  }

  // ── Step 4: Write salePayments from sale invoice lineitems ────────────────
  onProgress(`Writing ${saleLineitems.length} sale payments...`);
  let salesCount = 0;
  let processedRows = 0;

  for (let i = 0; i < saleLineitems.length; i += CHUNK_SIZE) {
    const chunk = saleLineitems.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);

    for (const row of chunk) {
      const mapped = mapSaleItemToAccount(row.itemName);
      if (!mapped) continue; // skip non-payment items
      const salesAccountId = accountIdMap.get(row.itemName) || null;
      const accountEntry = existingAccSnap.docs.find(d => d.id === salesAccountId);
      const accountType = accountEntry?.data().type || mapped.accountType;
      const isCash = accountType === 'Cash';

      const newRef = doc(collection(db, 'restaurants', restaurantId, 'salePayments'));
      batch.set(newRef, {
        id: newRef.id,
        restaurantId,
        amount: row.amount,
        businessDate: row.txnDate,
        paymentDate: row.txnDate,
        paymentTime: isCash ? '23:00' : '23:00',
        paymentMethod: mapped.accountName,
        salesAccountId,
        saleTransactionId: 'vyapar-import',
        description: `${row.itemName} (Vyapar)`,
        restaurantMembers: members,
      });
      salesCount++;
    }

    await batch.commit();
    processedRows += chunk.length;
    await setDoc(importJobRef, { processedRows, salesCount, expenseCount: 0, transferCount: 0 }, { merge: true });
    onProgress(`Sales: ${processedRows} / ${saleLineitems.length} (${Math.round((processedRows / Math.max(saleLineitems.length, 1)) * 100)}%)...`);
    await yieldToUI();
  }

  // ── Step 5: Write purchase invoices as accrual expenses ───────────────────
  onProgress(`Writing ${purchaseInvoices.length} purchase invoices...`);
  let expenseCount = 0;
  let expProcessed = 0;

  for (let i = 0; i < purchaseInvoices.length; i += CHUNK_SIZE) {
    const chunk = purchaseInvoices.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);

    for (const row of chunk) {
      const partyId = partyIdMap.get(row.partyName) || null;
      const { main, sub } = inferCategory(row.partyName, row.expenseType);

      const newRef = doc(collection(db, 'restaurants', restaurantId, 'expenses'));
      batch.set(newRef, {
        id: newRef.id,
        restaurantId,
        invoiceDate: row.txnDate,
        paymentDate: row.txnDate,
        amount: row.amount,
        vendor: row.partyName,
        partyId,
        category: main,
        subCategory: sub,
        description: row.partyName || 'Purchase Invoice',
        expenseCategoryId: sub,
        isAccrual: true,
        accountId: null,
        ...(row.refNumber ? { remark: `Ref: ${row.refNumber}` } : {}),
        restaurantMembers: members,
      });
      expenseCount++;
    }

    await batch.commit();
    expProcessed += chunk.length;
    await setDoc(importJobRef, { processedRows: processedRows + expProcessed, salesCount, expenseCount, transferCount: 0 }, { merge: true });
    onProgress(`Purchase invoices: ${expProcessed} / ${purchaseInvoices.length}...`);
    await yieldToUI();
  }

  processedRows += expProcessed;

  // ── Step 6: Write payment outs as actual-payment expenses ─────────────────
  onProgress(`Writing ${paymentOuts.length} payment outs...`);
  let poProcessed = 0;

  for (let i = 0; i < paymentOuts.length; i += CHUNK_SIZE) {
    const chunk = paymentOuts.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);

    for (const row of chunk) {
      const partyId = partyIdMap.get(row.partyName) || null;
      const { main, sub } = inferCategory(row.partyName, row.expenseType);

      // Try to find accountId for the payment type used
      const accountId = row.paymentType ? (accountByName.get(row.paymentType.toLowerCase()) || null) : null;

      const newRef = doc(collection(db, 'restaurants', restaurantId, 'expenses'));
      batch.set(newRef, {
        id: newRef.id,
        restaurantId,
        invoiceDate: row.txnDate,
        paymentDate: row.txnDate,
        amount: row.amount,
        vendor: row.partyName,
        partyId,
        category: main,
        subCategory: sub,
        description: row.partyName || 'Payment Out',
        expenseCategoryId: sub,
        isAccrual: false,
        accountId,
        ...(row.refNumber ? { remark: `Ref: ${row.refNumber}` } : {}),
        restaurantMembers: members,
      });
      expenseCount++;
    }

    await batch.commit();
    poProcessed += chunk.length;
    await setDoc(importJobRef, { processedRows: processedRows + poProcessed, salesCount, expenseCount, transferCount: 0 }, { merge: true });
    onProgress(`Payment outs: ${poProcessed} / ${paymentOuts.length}...`);
    await yieldToUI();
  }

  processedRows += poProcessed;

  // ── Done ──────────────────────────────────────────────────────────────────
  await setDoc(importJobRef, {
    status: 'done',
    processedRows: totalRows,
    salesCount,
    expenseCount,
    transferCount: 0,
    finishedAt: serverTimestamp(),
  }, { merge: true });

  onProgress(`Done! ${salesCount} sales + ${expenseCount} expenses imported from Vyapar.`);
  } catch (err: any) {
    console.error('Vyapar import error', err);
    await setDoc(importJobRef, {
      status: 'error',
      error: err?.message || 'Unknown error',
      finishedAt: serverTimestamp(),
    }, { merge: true }).catch(() => {});
    throw err;
  }
}
