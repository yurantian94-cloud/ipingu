import type { LedgerSavingsPlan, LedgerTransaction } from '../types';
import { getLocalDateKey } from './localDate';
import { formatMoney } from './format';

export const LEDGER_CONTEXT_STORAGE_KEY = 'sully_omni_ledger_context_v1';

export interface LedgerPlanProgress {
  name: string;
  progress: number;
  currentAmount: number;
  targetAmount: number;
}

export interface LedgerContextSnapshot {
  monthKey: string;
  monthlyIncome: number;
  monthlyExpense: number;
  topExpenseCategory: string | null;
  activePlans: LedgerPlanProgress[];
  updatedAt: number;
}

const isSameMonth = (timestamp: number, monthKey: string): boolean => {
  try {
    return getLocalDateKey(new Date(timestamp)).startsWith(monthKey);
  } catch {
    return false;
  }
};

export const buildLedgerContextSnapshot = (
  transactions: LedgerTransaction[],
  plans: LedgerSavingsPlan[],
  now: number = Date.now(),
): LedgerContextSnapshot => {
  const nowDate = new Date(now);
  const monthKey = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}`;

  let monthlyIncome = 0;
  let monthlyExpense = 0;
  const expenseByCategory = new Map<string, number>();

  for (const tx of transactions) {
    if (!isSameMonth(tx.date, monthKey)) continue;
    const amount = Math.max(0, Number(tx.amount) || 0);
    if (tx.type === 'INCOME') {
      monthlyIncome += amount;
    } else if (tx.type === 'EXPENSE') {
      monthlyExpense += amount;
      const category = tx.category || '其他';
      expenseByCategory.set(category, (expenseByCategory.get(category) || 0) + amount);
    }
  }

  let topExpenseCategory: string | null = null;
  let topExpenseAmount = 0;
  for (const [category, amount] of expenseByCategory.entries()) {
    if (amount > topExpenseAmount) {
      topExpenseCategory = category;
      topExpenseAmount = amount;
    }
  }

  const activePlans: LedgerPlanProgress[] = plans
    .filter(plan => plan.status !== 'COMPLETED')
    .map(plan => ({
      name: plan.name,
      currentAmount: Math.max(0, Number(plan.currentAmount) || 0),
      targetAmount: Math.max(0, Number(plan.targetAmount) || 0),
      progress: plan.targetAmount > 0
        ? Math.min(100, Math.round((Math.max(0, Number(plan.currentAmount) || 0) / Number(plan.targetAmount)) * 100))
        : 0,
    }))
    .sort((a, b) => b.progress - a.progress);

  return {
    monthKey,
    monthlyIncome: roundMoney(monthlyIncome),
    monthlyExpense: roundMoney(monthlyExpense),
    topExpenseCategory,
    activePlans,
    updatedAt: now,
  };
};

export const readLedgerContextSnapshot = (): LedgerContextSnapshot | null => {
  try {
    const raw = localStorage.getItem(LEDGER_CONTEXT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LedgerContextSnapshot;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.monthlyExpense !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
};

export const writeLedgerContextSnapshot = (snapshot: LedgerContextSnapshot): void => {
  try {
    localStorage.setItem(LEDGER_CONTEXT_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // localStorage 不可用时 IndexedDB 仍是权威数据源，不阻塞账本写入。
  }
};

export const formatLedgerFinanceBlock = (snapshot?: LedgerContextSnapshot | null): string => {
  const snap = snapshot ?? readLedgerContextSnapshot();
  if (!snap) return '';

  const hasLedgerData = snap.monthlyExpense > 0 || snap.monthlyIncome > 0;
  const hasSavingsData = snap.activePlans.length > 0;
  if (!hasLedgerData && !hasSavingsData) return '';

  let block = '### 用户的财务状况 (OmniLedger)\n';
  block += `【财务状况】用户本月已支出 ${formatMoney(snap.monthlyExpense)} 元`;
  if (hasLedgerData && snap.topExpenseCategory) {
    block += `，主要花销在${snap.topExpenseCategory}`;
  }
  if (snap.activePlans[0]) {
    const plan = snap.activePlans[0];
    block += `。当前正在为「${plan.name}」存钱，进度 ${plan.progress}%。`;
  } else {
    block += '。当前没有进行中的存钱计划。';
  }
  block += '\n\n';
  return block;
};

export const roundMoney = (value: number): number => Math.round((Number(value) || 0) * 100) / 100;
