import * as XLSX from 'xlsx';
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

/** Shape of an import job document stored in Firestore */
export interface ImportJob {
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

const CHUNK_SIZE = 200; // rows per writeBatch commit

/** Yield to the event loop so the UI stays responsive between chunks */
const yieldToUI = () => new Promise<void>(resolve => setTimeout(resolve, 10));

export async function processExcelImport(
  file: File,
  restaurantId: string,
  members: any,
  db: any,
  importJobRef: DocumentReference,
  onProgress: (msg: string) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary', cellDates: false });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        // raw:false + dateNF gives dates as 'yyyy-mm-dd' strings — no JS Date / timezone involved
        const rows: any[] = XLSX.utils.sheet_to_json(worksheet, { raw: false, dateNF: 'yyyy-mm-dd' });
        const parseNum = (v: any) => parseFloat(String(v ?? '0').replace(/,/g, '')) || 0;

        const totalRows = rows.length;
        onProgress(`Parsed ${totalRows} rows. Setting up accounts & parties...`);

        // ── 0. Load ALL existing accounts (case-insensitive name → id) ────────
        // This lets us detect when a "Party Name" is actually a bank/cash account
        // (e.g. "BFE" being a sub-account), so we can create a Transfer instead
        // of a vendor expense.
        const existingAccountsSnap = await getDocs(
          collection(db, 'restaurants', restaurantId, 'salesAccounts')
        );
        const existingAccountByName = new Map<string, string>(); // lower(name) → id
        existingAccountsSnap.docs.forEach(d => {
          const name = d.data().name as string;
          if (name) existingAccountByName.set(name.trim().toLowerCase(), d.id);
        });

        // ── 1. Ensure Payment Type accounts exist ──────────────────────────────
        const paymentTypes = Array.from(new Set(rows.map(r => (r['Payment Type'] || '').trim()).filter(Boolean)));
        const partyNames   = Array.from(new Set(rows.map(r => (r['Party Name']   || '').trim()).filter(Boolean)));

        const accountMap = new Map<string, string>(); // name → id
        for (const pt of paymentTypes) {
          const lower = pt.toLowerCase();
          if (existingAccountByName.has(lower)) {
            accountMap.set(pt, existingAccountByName.get(lower)!);
            continue;
          }
          const accQ = query(
            collection(db, 'restaurants', restaurantId, 'salesAccounts'),
            where('name', '==', pt)
          );
          const accSnap = await getDocs(accQ);
          if (accSnap.empty) {
            const newRef = doc(collection(db, 'restaurants', restaurantId, 'salesAccounts'));
            await setDoc(newRef, {
              id: newRef.id,
              restaurantId,
              name: pt,
              type: pt.toLowerCase().includes('cash') ? 'Cash' : 'Bank',
              isActive: true,
              restaurantMembers: members,
            });
            accountMap.set(pt, newRef.id);
            existingAccountByName.set(lower, newRef.id);
          } else {
            accountMap.set(pt, accSnap.docs[0].id);
            existingAccountByName.set(lower, accSnap.docs[0].id);
          }
        }

        // ── 2. Ensure vendor parties exist (skip names that are accounts) ──────
        const partyMap = new Map<string, string>(); // name → id
        for (const name of partyNames) {
          const lower = name.toLowerCase();

          // Skip: Revenue, salary-like names, and names that are actually accounts
          if (
            name === 'Revenue' ||
            lower.includes('salary') ||
            existingAccountByName.has(lower)
          ) continue;

          const partyQ = query(
            collection(db, 'restaurants', restaurantId, 'parties'),
            where('name', '==', name)
          );
          const pSnap = await getDocs(partyQ);
          if (pSnap.empty) {
            const newRef = doc(collection(db, 'restaurants', restaurantId, 'parties'));
            await setDoc(newRef, {
              id: newRef.id,
              restaurantId,
              name,
              mobile: '',
              mainCategory: 'Variable Cost',
              subCategory: 'Imported',
              isActive: true,
              restaurantMembers: members,
            });
            partyMap.set(name, newRef.id);
          } else {
            partyMap.set(name, pSnap.docs[0].id);
          }
        }

        // ── 3. Write transactions in chunks ────────────────────────────────────
        onProgress(`Writing ${totalRows} rows to database...`);

        let salesCount    = 0;
        let expenseCount  = 0;
        let transferCount = 0;
        let processedRows = 0;

        for (let chunkStart = 0; chunkStart < rows.length; chunkStart += CHUNK_SIZE) {
          const chunk = rows.slice(chunkStart, chunkStart + CHUNK_SIZE);
          const batch = writeBatch(db);

          for (const row of chunk) {
            // Parse date — dateNF:'yyyy-mm-dd' gives us a clean string, no timezone math needed
            const rawDate = row['Date'];
            let dateStr = '';
            if (typeof rawDate === 'string') {
              // Expect 'yyyy-mm-dd' from dateNF, or fallback dd/MM/yyyy text cell
              if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
                dateStr = rawDate;
              } else {
                const dmy = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
                if (dmy) {
                  dateStr = `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
                } else continue;
              }
            } else continue;

            const txType     = row['Transaction Type'];
            const partyName  = (row['Party Name']   || '').trim();
            const paymentType = (row['Payment Type'] || '').trim();

            const amount      = parseNum(row['Amount']);
            const receivedAmt = parseNum(row['Received Amount']);
            const paidAmt     = parseNum(row['Paid Amount']);

            if (txType === 'Payment-in') {
              // ── Inbound payment → salePayments ─────────────────────────────
              const newRef = doc(collection(db, 'restaurants', restaurantId, 'salePayments'));
              batch.set(newRef, {
                id: newRef.id,
                restaurantId,
                amount: receivedAmt > 0 ? receivedAmt : amount,
                businessDate: dateStr,
                paymentDate: dateStr,
                paymentMethod: paymentType,
                salesAccountId: accountMap.get(paymentType) || null,
                saleTransactionId: row['Ref No.']?.toString() || 'import',
                restaurantMembers: members,
              });
              salesCount++;

            } else if (txType === 'Payment-out' || txType === 'Purchase') {
              const expAmount = txType === 'Purchase' ? amount : (paidAmt > 0 ? paidAmt : amount);
              if (expAmount <= 0) continue;

              const partyNameLower = partyName.toLowerCase();

              // ── If party name matches a known account → Transfer ────────────
              if (existingAccountByName.has(partyNameLower)) {
                const toAccountId   = existingAccountByName.get(partyNameLower)!;
                const fromAccountId = accountMap.get(paymentType) || null;

                const newRef = doc(collection(db, 'restaurants', restaurantId, 'transfers'));
                batch.set(newRef, {
                  id: newRef.id,
                  restaurantId,
                  fromAccountId,
                  toAccountId,
                  amount: expAmount,
                  date: dateStr,
                  description: row['Ref No.'] ? `Ref: ${row['Ref No.']}` : `Transfer to ${partyName}`,
                  restaurantMembers: members,
                });
                transferCount++;

              } else {
                // ── Regular vendor/staff expense ────────────────────────────
                const isAccrual = txType === 'Purchase';
                const isStaff   = partyNameLower.includes('salary');

                const newRef = doc(collection(db, 'restaurants', restaurantId, 'expenses'));
                batch.set(newRef, {
                  id: newRef.id,
                  restaurantId,
                  amount: expAmount,
                  invoiceDate: dateStr,
                  paymentDate: dateStr,
                  category:    isStaff ? 'Fixed Cost' : 'Variable Cost',
                  subCategory: isStaff ? 'Salary' : 'Imported',
                  description: row['Ref No.'] ? `Ref: ${row['Ref No.']}` : 'Imported',
                  vendor:          isStaff ? null : partyName,
                  staffEntryType:  isStaff ? 'Regular' : null,
                  isAccrual,
                  accountId: isAccrual ? null : (accountMap.get(paymentType) || null),
                  partyId:   partyMap.get(partyName) || null,
                  restaurantMembers: members,
                });
                expenseCount++;
              }
            }
            // 'Sale' rows are ignored
          }

          // Commit this chunk
          await batch.commit();
          processedRows += chunk.length;

          // Update progress in Firestore
          await setDoc(importJobRef, {
            processedRows,
            salesCount,
            expenseCount,
            transferCount,
          }, { merge: true });

          const pct = Math.round((processedRows / totalRows) * 100);
          onProgress(`Imported ${processedRows} / ${totalRows} rows (${pct}%)...`);

          await yieldToUI();
        }

        // Mark job as done
        await setDoc(importJobRef, {
          status: 'done',
          processedRows: totalRows,
          salesCount,
          expenseCount,
          transferCount,
          finishedAt: serverTimestamp(),
        }, { merge: true });

        onProgress(`Done! ${salesCount} sales + ${expenseCount} expenses + ${transferCount} transfers imported.`);
        resolve();
      } catch (err: any) {
        console.error('Import error', err);
        await setDoc(importJobRef, {
          status: 'error',
          error: err?.message || 'Unknown error',
          finishedAt: serverTimestamp(),
        }, { merge: true }).catch(() => {});
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsBinaryString(file);
  });
}

/**
 * Dedicated importer for Payment In (Sale) files.
 *
 * Expected columns: Date | Party Name | Category | Transaction Type | Ref No | Amount | Payment Type | Received Amount
 *
 * Business rules:
 *  - Payment Type = account name (e.g. "Bombay Food Express" | "Cash")
 *  - Cash sales   → paymentDate = invoiceDate,     paymentTime = "23:00"
 *  - Bank/account → paymentDate = invoiceDate + 1, paymentTime = "03:30", businessDate = invoiceDate
 */
export async function importPaymentIn(
  file: File,
  restaurantId: string,
  members: any,
  db: any,
  importJobRef: DocumentReference,
  onProgress: (msg: string) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary', cellDates: false });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        // raw:false + dateNF gives dates as 'yyyy-mm-dd' strings — no JS Date / timezone involved
        const rows: any[] = XLSX.utils.sheet_to_json(worksheet, { raw: false, dateNF: 'yyyy-mm-dd' });
        const parseNum = (v: any) => parseFloat(String(v ?? '0').replace(/,/g, '')) || 0;

        const totalRows = rows.length;
        onProgress(`Parsed ${totalRows} rows. Mapping accounts...`);

        // ── Load existing accounts ────────────────────────────────────────────
        const existingSnap = await getDocs(
          collection(db, 'restaurants', restaurantId, 'salesAccounts')
        );
        const accountByName = new Map<string, { id: string; type: string }>();
        existingSnap.docs.forEach(d => {
          const name = (d.data().name as string || '').trim().toLowerCase();
          if (name) accountByName.set(name, { id: d.id, type: d.data().type });
        });

        // ── Ensure all Payment Type accounts exist ────────────────────────────
        const paymentTypes = Array.from(
          new Set(rows.map(r => (r['Payment Type'] || '').trim()).filter(Boolean))
        );
        const accountMap = new Map<string, { id: string; type: string }>();
        for (const pt of paymentTypes) {
          const lower = pt.toLowerCase();
          if (accountByName.has(lower)) {
            accountMap.set(pt, accountByName.get(lower)!);
            continue;
          }
          // Create it
          const isCash = lower.includes('cash');
          const newRef = doc(collection(db, 'restaurants', restaurantId, 'salesAccounts'));
          await setDoc(newRef, {
            id: newRef.id,
            restaurantId,
            name: pt,
            type: isCash ? 'Cash' : 'Bank Account',
            isActive: true,
            isActiveForBilling: true,
            restaurantMembers: members,
          });
          const entry = { id: newRef.id, type: isCash ? 'Cash' : 'Bank Account' };
          accountMap.set(pt, entry);
          accountByName.set(lower, entry);
        }

        // ── Write transactions ────────────────────────────────────────────────
        onProgress(`Writing ${totalRows} rows...`);
        let salesCount = 0;
        let processedRows = 0;

        for (let chunkStart = 0; chunkStart < rows.length; chunkStart += CHUNK_SIZE) {
          const chunk = rows.slice(chunkStart, chunkStart + CHUNK_SIZE);
          const batch = writeBatch(db);

          for (const row of chunk) {
            // ── Parse date — dateNF:'yyyy-mm-dd' gives clean string, no timezone ──
            const rawDate = row['Date'];
            let invoiceDateStr = '';
            if (typeof rawDate === 'string') {
              if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
                invoiceDateStr = rawDate;
              } else {
                // Fallback: dd/MM/yyyy text cell
                const dmy = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
                if (dmy) {
                  invoiceDateStr = `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
                } else continue;
              }
            } else continue;

            const txType = (row['Transaction Type'] || '').trim();
            // Only process Payment-in rows
            if (txType !== 'Payment-in' && txType !== 'Payment In' && txType !== 'payment_in') continue;

            const paymentType = (row['Payment Type'] || '').trim();
            const amount = parseNum(row['Received Amount']) || parseNum(row['Amount']);
            if (amount <= 0) continue;

            const accountEntry = accountMap.get(paymentType);

            // ── Settlement rule: same day 23:00 for both Cash and Bank ─────────
            const paymentDate = invoiceDateStr;
            const paymentTime = '23:00';
            const businessDate = invoiceDateStr;

            const newRef = doc(collection(db, 'restaurants', restaurantId, 'salePayments'));
            batch.set(newRef, {
              id: newRef.id,
              restaurantId,
              amount,
              businessDate,
              paymentDate,
              paymentTime,
              paymentMethod: paymentType || 'Cash',
              salesAccountId: accountEntry?.id || null,
              saleTransactionId: row['Ref No.']?.toString() || row['Ref No']?.toString() || 'import',
              description: `${paymentType || 'Cash'} Sale`,
              restaurantMembers: members,
            });
            salesCount++;
          }

          await batch.commit();
          processedRows += chunk.length;

          await setDoc(importJobRef, {
            processedRows,
            salesCount,
            expenseCount: 0,
            transferCount: 0,
          }, { merge: true });

          const pct = Math.round((processedRows / totalRows) * 100);
          onProgress(`Imported ${processedRows} / ${totalRows} rows (${pct}%)...`);
          await yieldToUI();
        }

        await setDoc(importJobRef, {
          status: 'done',
          processedRows: totalRows,
          salesCount,
          expenseCount: 0,
          transferCount: 0,
          finishedAt: serverTimestamp(),
        }, { merge: true });

        onProgress(`Done! ${salesCount} Payment In (Sale) entries imported.`);
        resolve();
      } catch (err: any) {
        console.error('Payment In import error', err);
        await setDoc(importJobRef, {
          status: 'error',
          error: err?.message || 'Unknown error',
          finishedAt: serverTimestamp(),
        }, { merge: true }).catch(() => {});
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsBinaryString(file);
  });
}


/**
 * Dedicated importer for Payment Out files.
 *
 * Expected columns: Date | Party Name | Category | Transaction Type | Ref No. | Amount | Payment Type | Paid Amount
 *
 * Business rules:
 *  - Each "Payment-out" row → expenses collection
 *  - Party Name is matched/created in the parties collection
 *  - Payment Type is matched/created in the salesAccounts collection
 */
export async function importPaymentOut(
  file: File,
  restaurantId: string,
  members: any,
  db: any,
  importJobRef: DocumentReference,
  onProgress: (msg: string) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary', cellDates: false });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(worksheet, { raw: false, dateNF: 'yyyy-mm-dd' });
        const parseNum = (v: any) => parseFloat(String(v ?? '0').replace(/,/g, '')) || 0;

        const totalRows = rows.length;
        onProgress(`Parsed ${totalRows} rows. Processing payment outs...`);

        // ── Load existing parties ─────────────────────────────────────────────
        const partiesSnap = await getDocs(collection(db, 'restaurants', restaurantId, 'parties'));
        const partyByName = new Map<string, string>(); // lower(name) → id
        partiesSnap.docs.forEach(d => {
          const name = (d.data().name as string || '').trim().toLowerCase();
          if (name) partyByName.set(name, d.id);
        });

        // ── Load existing salesAccounts (for payment method) ─────────────────
        const accountsSnap = await getDocs(collection(db, 'restaurants', restaurantId, 'salesAccounts'));
        const accountByName = new Map<string, string>(); // lower(name) → id
        accountsSnap.docs.forEach(d => {
          const name = (d.data().name as string || '').trim().toLowerCase();
          if (name) accountByName.set(name, d.id);
        });

        // ── Pre-create missing payment type accounts ──────────────────────────
        const paymentTypes = Array.from(new Set(rows.map(r => (r['Payment Type'] || '').trim()).filter(Boolean)));
        const accountIdMap = new Map<string, string>(); // pt → id
        for (const pt of paymentTypes) {
          const lower = pt.toLowerCase();
          if (accountByName.has(lower)) {
            accountIdMap.set(pt, accountByName.get(lower)!);
          } else {
            const isCash = lower.includes('cash');
            const newRef = doc(collection(db, 'restaurants', restaurantId, 'salesAccounts'));
            await setDoc(newRef, {
              id: newRef.id, restaurantId, name: pt,
              type: isCash ? 'Cash' : 'Bank Account',
              isActive: true, restaurantMembers: members,
            });
            accountIdMap.set(pt, newRef.id);
            accountByName.set(lower, newRef.id);
          }
        }

        // ── Pre-create missing parties ────────────────────────────────────────
        const partyNames = Array.from(new Set(rows.map(r => (r['Party Name'] || '').trim()).filter(Boolean)));
        const partyIdMap = new Map<string, string>(); // name → id
        for (const pn of partyNames) {
          const lower = pn.toLowerCase();
          if (partyByName.has(lower)) {
            partyIdMap.set(pn, partyByName.get(lower)!);
          } else {
            const newRef = doc(collection(db, 'restaurants', restaurantId, 'parties'));
            await setDoc(newRef, {
              id: newRef.id, restaurantId, name: pn,
              mainCategory: 'Variable Cost', subCategory: 'Payment Out',
              restaurantMembers: members,
            });
            partyIdMap.set(pn, newRef.id);
            partyByName.set(lower, newRef.id);
          }
        }

        let expenseCount = 0;
        let processedRows = 0;

        for (let chunkStart = 0; chunkStart < rows.length; chunkStart += CHUNK_SIZE) {
          const chunk = rows.slice(chunkStart, chunkStart + CHUNK_SIZE);
          const batch = writeBatch(db);

          for (const row of chunk) {
            // ── Parse date ────────────────────────────────────────────────────
            const rawDate = row['Date'];
            let dateStr = '';
            if (typeof rawDate === 'string') {
              if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
                dateStr = rawDate;
              } else {
                const dmy = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
                if (dmy) dateStr = `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
                else continue;
              }
            } else continue;

            const txType = (row['Transaction Type'] || '').trim();
            if (txType !== 'Payment-out' && txType !== 'Payment Out' && txType !== 'payment_out') continue;

            const partyName = (row['Party Name'] || '').trim();
            const paymentType = (row['Payment Type'] || 'Cash').trim();
            const amount = parseNum(row['Paid Amount']) || parseNum(row['Amount']);
            if (amount <= 0) continue;

            const refNo = row['Ref No.']?.toString() || row['Ref No']?.toString() || '';
            const accountId = accountIdMap.get(paymentType) || null;
            const partyId = partyIdMap.get(partyName) || null;
            const category = (row['Category'] || 'Variable Cost').trim();

            const newRef = doc(collection(db, 'restaurants', restaurantId, 'expenses'));
            batch.set(newRef, {
              id: newRef.id, restaurantId,
              invoiceDate: dateStr, paymentDate: dateStr,
              amount, vendor: partyName, partyId, accountId,
              paymentMethod: paymentType,
              description: partyName || 'Payment Out',
              expenseCategoryId: 'General',
              category: category || 'Variable Cost',
              subCategory: 'Payment Out',
              isAccrual: false, refNo,
              restaurantMembers: members,
            });
            expenseCount++;
          }

          await batch.commit();
          processedRows += chunk.length;
          await setDoc(importJobRef, { processedRows, salesCount: 0, expenseCount, transferCount: 0 }, { merge: true });
          onProgress(`Imported ${processedRows} / ${totalRows} rows (${Math.round((processedRows / totalRows) * 100)}%)...`);
          await new Promise(r => setTimeout(r, 0));
        }

        await setDoc(importJobRef, {
          status: 'done', processedRows: totalRows,
          salesCount: 0, expenseCount, transferCount: 0,
          finishedAt: serverTimestamp(),
        }, { merge: true });
        onProgress(`Done! ${expenseCount} payment-out entries imported.`);
        resolve();
      } catch (err: any) {
        await setDoc(importJobRef, { status: 'error', error: err?.message || 'Unknown error', finishedAt: serverTimestamp() }, { merge: true }).catch(() => {});
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsBinaryString(file);
  });
}


/**
 * Dedicated importer for Purchase files.
 * Columns: Date | Party Name | Category | Transaction Type | Ref No. | Amount | Payment Type | Paid Amount
 * Each "Purchase" row → expenses collection.
 */
export async function importPurchase(
  file: File,
  restaurantId: string,
  members: any,
  db: any,
  importJobRef: DocumentReference,
  onProgress: (msg: string) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary', cellDates: false });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(worksheet, { raw: false, dateNF: 'yyyy-mm-dd' });
        const parseNum = (v: any) => parseFloat(String(v ?? '0').replace(/,/g, '')) || 0;

        const totalRows = rows.length;
        onProgress(`Parsed ${totalRows} rows. Processing purchases...`);

        // Load existing parties
        const partiesSnap = await getDocs(collection(db, 'restaurants', restaurantId, 'parties'));
        const partyByName = new Map<string, string>();
        partiesSnap.docs.forEach(d => {
          const name = (d.data().name as string || '').trim().toLowerCase();
          if (name) partyByName.set(name, d.id);
        });

        // Load existing salesAccounts (for payment method)
        const accountsSnap = await getDocs(collection(db, 'restaurants', restaurantId, 'salesAccounts'));
        const accountByName = new Map<string, string>();
        accountsSnap.docs.forEach(d => {
          const name = (d.data().name as string || '').trim().toLowerCase();
          if (name) accountByName.set(name, d.id);
        });

        // Pre-create missing parties
        const vendorNames = Array.from(new Set(rows.map(r => (r['Party Name'] || '').trim()).filter(Boolean)));
        const partyIdMap = new Map<string, string>();
        for (const vn of vendorNames) {
          const lower = vn.toLowerCase();
          if (partyByName.has(lower)) {
            partyIdMap.set(vn, partyByName.get(lower)!);
          } else {
            const newRef = doc(collection(db, 'restaurants', restaurantId, 'parties'));
            await setDoc(newRef, {
              id: newRef.id, restaurantId, name: vn,
              mainCategory: 'Variable Cost', subCategory: 'Purchase',
              restaurantMembers: members,
            });
            partyIdMap.set(vn, newRef.id);
            partyByName.set(lower, newRef.id);
          }
        }

        let expenseCount = 0;
        let processedRows = 0;

        for (let chunkStart = 0; chunkStart < rows.length; chunkStart += CHUNK_SIZE) {
          const chunk = rows.slice(chunkStart, chunkStart + CHUNK_SIZE);
          const batch = writeBatch(db);

          for (const row of chunk) {
            const rawDate = row['Date'];
            let dateStr = '';
            if (typeof rawDate === 'string') {
              if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
                dateStr = rawDate;
              } else {
                const dmy = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
                if (dmy) dateStr = `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
                else continue;
              }
            } else continue;

            const txType = (row['Transaction Type'] || '').trim();
            if (txType !== 'Purchase') continue;

            const vendorName = (row['Party Name'] || '').trim();
            const amount = parseNum(row['Amount']);
            if (amount <= 0) continue;

            const category = (row['Category'] || 'Variable Cost').trim();
            const paymentType = (row['Payment Type'] || 'Cash').trim();
            const accountId = accountByName.get(paymentType.toLowerCase()) || null;
            const partyId = partyIdMap.get(vendorName) || null;
            const refNo = row['Ref No.']?.toString() || row['Ref No']?.toString() || '';

            const newRef = doc(collection(db, 'restaurants', restaurantId, 'expenses'));
            batch.set(newRef, {
              id: newRef.id, restaurantId,
              invoiceDate: dateStr, paymentDate: dateStr,
              amount, vendor: vendorName, partyId, accountId,
              paymentMethod: paymentType,
              description: vendorName,
              expenseCategoryId: 'Purchase',
              category: category || 'Variable Cost',
              subCategory: 'Purchase',
              isAccrual: true, refNo,
              restaurantMembers: members,
            });
            expenseCount++;
          }

          await batch.commit();
          processedRows += chunk.length;
          await setDoc(importJobRef, { processedRows, salesCount: 0, expenseCount, transferCount: 0 }, { merge: true });
          onProgress(`Imported ${processedRows} / ${totalRows} rows (${Math.round((processedRows / totalRows) * 100)}%)...`);
          await new Promise(r => setTimeout(r, 0));
        }

        await setDoc(importJobRef, {
          status: 'done', processedRows: totalRows,
          salesCount: 0, expenseCount, transferCount: 0,
          finishedAt: serverTimestamp(),
        }, { merge: true });
        onProgress(`Done! ${expenseCount} purchase entries imported.`);
        resolve();
      } catch (err: any) {
        await setDoc(importJobRef, { status: 'error', error: err?.message || 'Unknown error', finishedAt: serverTimestamp() }, { merge: true }).catch(() => {});
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsBinaryString(file);
  });
}
