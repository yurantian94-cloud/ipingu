import { describe, expect, it } from 'vitest';
import type { LedgerSavingsPlan, LedgerTransaction } from '../types';
import { buildLedgerContextSnapshot, formatLedgerFinanceBlock } from './ledgerContext';
import { normalizeLedgerCategory } from './ledgerStore';

describe('OmniLedger finance context', () => {
  it('keeps a concise custom category while normalizing whitespace', () => {
    expect(normalizeLedgerCategory('  宠物\n用品  ')).toBe('宠物 用品');
  });

  it('aggregates only the current month and preserves a custom category', () => {
    const now = new Date(2026, 8, 18, 12).getTime();
    const transactions: LedgerTransaction[] = [
      { id: 'food', amount: 28.5, type: 'EXPENSE', category: '餐饮', date: new Date(2026, 8, 2).getTime(), note: '' },
      { id: 'pet', amount: 88, type: 'EXPENSE', category: '宠物', date: new Date(2026, 8, 4).getTime(), note: '' },
      { id: 'income', amount: 5000, type: 'INCOME', category: '工资', date: new Date(2026, 8, 1).getTime(), note: '' },
      { id: 'old', amount: 999, type: 'EXPENSE', category: '购物', date: new Date(2026, 7, 31).getTime(), note: '' },
    ];
    const plans: LedgerSavingsPlan[] = [{
      id: 'printer', name: '3D 打印机基金', targetAmount: 3000, currentAmount: 750,
      deadline: null, status: 'ACTIVE', createdAt: now,
    }];

    const snapshot = buildLedgerContextSnapshot(transactions, plans, now);

    expect(snapshot.monthlyExpense).toBe(116.5);
    expect(snapshot.monthlyIncome).toBe(5000);
    expect(snapshot.topExpenseCategory).toBe('宠物');
    expect(snapshot.activePlans[0]?.progress).toBe(25);
    expect(formatLedgerFinanceBlock(snapshot)).toContain('本月已支出 116.5 元，主要花销在宠物');
    expect(formatLedgerFinanceBlock(snapshot)).toContain('3D 打印机基金」存钱，进度 25%');
  });
});
