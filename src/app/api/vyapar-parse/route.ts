import { NextRequest, NextResponse } from 'next/server';
import AdmZip from 'adm-zip';
import initSqlJs from 'sql.js';
import path from 'path';
import fs from 'fs';

export const runtime = 'nodejs';
export const maxDuration = 60;

function toDateStr(raw: any): string {
  if (!raw) return '';
  const s = String(raw).split(' ')[0]; // take date part from datetime
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return '';
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());

    // Extract the .vyp (SQLite) file from the .vyb (ZIP) archive
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    const sqliteEntry = entries.find(e => e.entryName.endsWith('.vyp'));
    if (!sqliteEntry) {
      return NextResponse.json({ error: 'No .vyp database file found inside the .vyb archive' }, { status: 400 });
    }
    const sqliteBuffer = sqliteEntry.getData();

    // Load sql.js WASM (Node.js runtime — reads from disk)
    const wasmPath = path.join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm');
    const wasmBinary = fs.readFileSync(wasmPath);
    const SQL = await initSqlJs({ wasmBinary });
    const db = new SQL.Database(sqliteBuffer);

    // ── 1. Payment types (accounts in Vyapar) ────────────────────────────────
    const ptRes = db.exec('SELECT paymentType_id, paymentType_name, paymentType_type FROM kb_paymentTypes');
    const paymentTypes: { id: number; name: string; type: string }[] = (ptRes[0]?.values || []).map(
      ([id, name, type]: any) => ({ id: Number(id), name: String(name || ''), type: String(type || 'BANK') })
    );

    // ── 2. Parties / vendors (kb_names) ──────────────────────────────────────
    const namesRes = db.exec(
      'SELECT name_id, full_name, phone_number, name_type, name_expense_type FROM kb_names WHERE name_is_active = 1'
    );
    const parties: { id: number; name: string; phone: string; nameType: number; expenseType: string }[] = (
      namesRes[0]?.values || []
    ).map(([id, name, phone, nameType, expenseType]: any) => ({
      id: Number(id),
      name: String(name || ''),
      phone: String(phone || ''),
      nameType: Number(nameType || 1),
      expenseType: String(expenseType || ''),
    }));

    // ── 3. Sale invoice lineitems (txn_type=1) — revenue by payment method ───
    // Each lineitem item_name represents a payment channel (e.g. "Cash Sale", "Sale Paytm").
    // Filter to only payment-channel items — exclude actual product names (Breakfast, Water, etc.)
    const saleLinRes = db.exec(`
      SELECT t.txn_date, i.item_name, li.total_amount
      FROM kb_lineitems li
      JOIN kb_transactions t ON li.lineitem_txn_id = t.txn_id
      JOIN kb_items i ON li.item_id = i.item_id
      WHERE t.txn_type = 1 AND li.total_amount > 0
        AND (
          LOWER(i.item_name) LIKE 'cash%'
          OR LOWER(i.item_name) LIKE 'sale%'
          OR LOWER(i.item_name) LIKE '%paytm%'
          OR LOWER(i.item_name) LIKE '%upi%'
          OR LOWER(i.item_name) LIKE '%gpay%'
          OR LOWER(i.item_name) LIKE '%phonepe%'
          OR LOWER(i.item_name) LIKE '%phone pe%'
          OR LOWER(i.item_name) LIKE '%online%'
          OR LOWER(i.item_name) LIKE '%swiggy%'
          OR LOWER(i.item_name) LIKE '%zomato%'
          OR LOWER(i.item_name) LIKE '%card%'
          OR LOWER(i.item_name) LIKE '%neft%'
          OR LOWER(i.item_name) LIKE '%rtgs%'
          OR LOWER(i.item_name) LIKE '%imps%'
        )
      ORDER BY t.txn_date
    `);
    const saleLineitems: { txnDate: string; itemName: string; amount: number }[] = (
      saleLinRes[0]?.values || []
    )
      .map(([txnDate, itemName, amount]: any) => ({
        txnDate: toDateStr(txnDate),
        itemName: String(itemName || ''),
        amount: Number(amount) || 0,
      }))
      .filter((r: any) => r.txnDate && r.amount > 0);

    // ── 4. Purchase invoices (txn_type=2) — accrual expenses ─────────────────
    const purchRes = db.exec(`
      SELECT t.txn_id, t.txn_date, n.full_name, ABS(COALESCE(t.txn_balance_amount, t.txn_cash_amount, 0)) as amount,
             t.txn_ref_number_char, n.name_expense_type
      FROM kb_transactions t
      LEFT JOIN kb_names n ON t.txn_name_id = n.name_id
      WHERE t.txn_type = 2
      ORDER BY t.txn_date
    `);
    const purchaseInvoices: { id: number; txnDate: string; partyName: string; amount: number; refNumber: string; expenseType: string }[] = (
      purchRes[0]?.values || []
    )
      .map(([id, txnDate, partyName, amount, refNumber, expenseType]: any) => ({
        id: Number(id),
        txnDate: toDateStr(txnDate),
        partyName: String(partyName || ''),
        amount: Number(amount) || 0,
        refNumber: String(refNumber || ''),
        expenseType: String(expenseType || ''),
      }))
      .filter((r: any) => r.txnDate && r.amount > 0);

    // ── 5. Payment outs (txn_type=4) — actual cash/bank payments to vendors ──
    const payoutRes = db.exec(`
      SELECT t.txn_id, t.txn_date, n.full_name, t.txn_cash_amount as amount,
             t.txn_ref_number_char, pt.paymentType_name, n.name_expense_type
      FROM kb_transactions t
      LEFT JOIN kb_names n ON t.txn_name_id = n.name_id
      LEFT JOIN kb_paymentTypes pt ON t.txn_payment_type_id = pt.paymentType_id
      WHERE t.txn_type = 4 AND t.txn_cash_amount > 0
      ORDER BY t.txn_date
    `);
    const paymentOuts: { id: number; txnDate: string; partyName: string; amount: number; refNumber: string; paymentType: string; expenseType: string }[] = (
      payoutRes[0]?.values || []
    )
      .map(([id, txnDate, partyName, amount, refNumber, paymentType, expenseType]: any) => ({
        id: Number(id),
        txnDate: toDateStr(txnDate),
        partyName: String(partyName || ''),
        amount: Number(amount) || 0,
        refNumber: String(refNumber || ''),
        paymentType: String(paymentType || ''),
        expenseType: String(expenseType || ''),
      }))
      .filter((r: any) => r.txnDate && r.amount > 0);

    db.close();

    return NextResponse.json({
      paymentTypes,
      parties,
      saleLineitems,
      purchaseInvoices,
      paymentOuts,
      summary: {
        paymentTypesCount: paymentTypes.length,
        partiesCount: parties.length,
        saleLineitemsCount: saleLineitems.length,
        purchaseInvoicesCount: purchaseInvoices.length,
        paymentOutsCount: paymentOuts.length,
      },
    });
  } catch (err: any) {
    console.error('Vyapar parse error:', err);
    return NextResponse.json({ error: err?.message || 'Failed to parse Vyapar file' }, { status: 500 });
  }
}
