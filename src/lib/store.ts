// This file is deprecated in favor of real-time Firestore hooks.
// It is kept temporarily for reference during the migration.

export const getFinancialSummary = (transactions: any[]) => {
  const revenue = transactions
    .filter(t => t.type === 'Revenue')
    .reduce((sum, t) => sum + t.amount, 0);
  const expenses = transactions
    .filter(t => t.type === 'Expense')
    .reduce((sum, t) => sum + t.amount, 0);
  return { revenue, expenses, profit: revenue - expenses };
};
