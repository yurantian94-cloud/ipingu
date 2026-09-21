import React, { useEffect, useMemo, useState } from 'react';
import { useOS } from '../context/OSContext';
import type {
  LedgerCategory,
  LedgerSavingsPlan,
  LedgerTransaction,
  LedgerTransactionType,
  LedgerWallet,
} from '../types';
import { LEDGER_CATEGORIES, LedgerStore } from '../utils/ledgerStore';
import { formatMoney } from '../utils/format';
import { getLocalDateKey } from '../utils/localDate';
import {
  CalendarBlank,
  CaretLeft,
  ChartDonut,
  CheckCircle,
  PiggyBank,
  Plus,
  Receipt,
  Trash,
  Wallet,
  X,
} from '@phosphor-icons/react';

type LedgerTab = 'dashboard' | 'transactions' | 'wallets' | 'savings';
type TransactionFilter = 'ALL' | LedgerTransactionType;

const CATEGORY_COLORS: Record<string, string> = {
  餐饮: '#fb7185',
  交通: '#38bdf8',
  购物: '#fbbf24',
  娱乐: '#a78bfa',
  居住: '#34d399',
  工资: '#22c55e',
  其他: '#94a3b8',
};

const CATEGORY_EMOJI: Record<string, string> = {
  餐饮: '🍜',
  交通: '🚕',
  购物: '🛍️',
  娱乐: '🎮',
  居住: '🏠',
  工资: '💰',
  其他: '📌',
};

const WALLET_EMOJI: Record<string, string> = {
  'wallet-wechat': '💬',
  'wallet-alipay': '🔷',
  'wallet-cash': '💵',
  'wallet-bank': '🏦',
};

const TYPE_LABEL: Record<LedgerTransactionType, string> = {
  INCOME: '收入',
  EXPENSE: '支出',
};

const dateToInputValue = (timestamp: number): string => getLocalDateKey(new Date(timestamp));
const dateInputToTimestamp = (value: string): number => new Date(`${value}T00:00:00`).getTime();

const formatDateLabel = (timestamp: number): string => {
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
};

const formatDeadline = (plan: LedgerSavingsPlan): string => {
  if (!plan.deadline) return '无截止日';
  const date = new Date(plan.deadline);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
};

const getMonthKey = (timestamp: number): string => getLocalDateKey(new Date(timestamp)).slice(0, 7);

interface TxFormState {
  type: LedgerTransactionType;
  amount: string;
  category: LedgerCategory;
  date: string;
  note: string;
  walletId: string;
}

const EMPTY_TX_FORM: TxFormState = {
  type: 'EXPENSE',
  amount: '',
  category: '餐饮',
  date: getLocalDateKey(),
  note: '',
  walletId: 'wallet-wechat',
};

interface PlanFormState {
  name: string;
  targetAmount: string;
  currentAmount: string;
  deadline: string;
}

const EMPTY_PLAN_FORM: PlanFormState = {
  name: '',
  targetAmount: '',
  currentAmount: '',
  deadline: '',
};

const OmniLedgerApp: React.FC = () => {
  const { closeApp, addToast } = useOS();
  const [tab, setTab] = useState<LedgerTab>('dashboard');
  const [transactions, setTransactions] = useState<LedgerTransaction[]>([]);
  const [plans, setPlans] = useState<LedgerSavingsPlan[]>([]);
  const [wallets, setWallets] = useState<LedgerWallet[]>([]);
  const [loading, setLoading] = useState(true);

  const [txFilter, setTxFilter] = useState<TransactionFilter>('ALL');
  const [showTxForm, setShowTxForm] = useState(false);
  const [txForm, setTxForm] = useState<TxFormState>(EMPTY_TX_FORM);
  const [customCategory, setCustomCategory] = useState('');
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [planForm, setPlanForm] = useState<PlanFormState>(EMPTY_PLAN_FORM);
  const [depositTarget, setDepositTarget] = useState<LedgerSavingsPlan | null>(null);
  const [depositAmount, setDepositAmount] = useState('');
  const [editingWallet, setEditingWallet] = useState<LedgerWallet | null>(null);
  const [walletBalanceInput, setWalletBalanceInput] = useState('');

  const loadData = async () => {
    try {
      const [nextTransactions, nextPlans, nextWallets] = await Promise.all([
        LedgerStore.getAllTransactions(),
        LedgerStore.getAllSavingsPlans(),
        LedgerStore.getAllWallets(),
      ]);
      setTransactions(nextTransactions.sort((a, b) => b.date - a.date));
      setPlans(nextPlans);
      setWallets(nextWallets);
      await LedgerStore.refreshLedgerContextSnapshot();
    } catch (error) {
      console.warn('[OmniLedger] load data failed:', error);
      addToast('记账本读取失败，请稍后重试', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const monthKey = getMonthKey(Date.now());
  const monthlyTransactions = useMemo(
    () => transactions.filter(tx => getMonthKey(tx.date) === monthKey),
    [transactions, monthKey],
  );

  const dashboard = useMemo(() => {
    let income = 0;
    let expense = 0;
    const expenseByCategory = new Map<LedgerCategory, number>();

    for (const tx of monthlyTransactions) {
      if (tx.type === 'INCOME') {
        income += tx.amount;
      } else {
        expense += tx.amount;
        expenseByCategory.set(tx.category, (expenseByCategory.get(tx.category) || 0) + tx.amount);
      }
    }

    const categoryData = Array.from(expenseByCategory.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);

    return { income, expense, balance: income - expense, categoryData };
  }, [monthlyTransactions]);

  const visibleTransactions = useMemo(() => {
    return txFilter === 'ALL' ? transactions : transactions.filter(tx => tx.type === txFilter);
  }, [transactions, txFilter]);

  const walletBalances = useMemo(() => wallets.map(wallet => ({
    ...wallet,
    balance: transactions.reduce((total, tx) => {
      const walletId = tx.walletId || 'wallet-cash';
      if (walletId !== wallet.id) return total;
      return total + (tx.type === 'INCOME' ? tx.amount : -tx.amount);
    }, wallet.openingBalance),
  })), [wallets, transactions]);

  const handleSaveTransaction = async () => {
    const amount = Number(txForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      addToast('请输入有效金额', 'error');
      return;
    }
    if (!txForm.date) {
      addToast('请选择日期', 'error');
      return;
    }

    try {
      await LedgerStore.createLedgerTransaction({
        amount,
        type: txForm.type,
        category: customCategory.trim() || txForm.category,
        note: txForm.note,
        date: dateInputToTimestamp(txForm.date),
        walletId: txForm.walletId,
      });
      await loadData();
      addToast('已记一笔', 'success');
      setTxForm({ ...EMPTY_TX_FORM, date: getLocalDateKey() });
      setCustomCategory('');
      setShowTxForm(false);
    } catch (error) {
      console.warn('[OmniLedger] save transaction failed:', error);
      addToast('写入失败，请重试', 'error');
    }
  };

  const handleDeleteTransaction = async (id: string) => {
    try {
      await LedgerStore.deleteLedgerTransaction(id);
      await loadData();
      addToast('已删除这笔流水', 'info');
    } catch (error) {
      console.warn('[OmniLedger] delete transaction failed:', error);
      addToast('删除失败', 'error');
    }
  };

  const handleSavePlan = async () => {
    const targetAmount = Number(planForm.targetAmount);
    const currentAmount = Number(planForm.currentAmount || '0');
    if (!planForm.name.trim()) {
      addToast('请填写计划名称', 'error');
      return;
    }
    if (!Number.isFinite(targetAmount) || targetAmount <= 0) {
      addToast('请输入有效的目标金额', 'error');
      return;
    }

    try {
      const plan = await LedgerStore.createSavingsPlan({
        name: planForm.name,
        targetAmount,
        currentAmount: Number.isFinite(currentAmount) ? currentAmount : 0,
        deadline: planForm.deadline ? dateInputToTimestamp(planForm.deadline) : null,
      });
      await loadData();
      addToast(plan.status === 'COMPLETED' ? '目标已完成 🎉' : '存钱计划已创建', 'success');
      setPlanForm(EMPTY_PLAN_FORM);
      setShowPlanForm(false);
    } catch (error) {
      console.warn('[OmniLedger] save plan failed:', error);
      addToast('写入失败，请重试', 'error');
    }
  };

  const handleSaveWalletBalance = async () => {
    if (!editingWallet) return;
    const openingBalance = Number(walletBalanceInput);
    if (!Number.isFinite(openingBalance)) {
      addToast('请输入有效余额', 'error');
      return;
    }
    const currentBalance = walletBalances.find(wallet => wallet.id === editingWallet.id)?.balance ?? editingWallet.openingBalance;
    const transactionDelta = currentBalance - editingWallet.openingBalance;
    await LedgerStore.saveWallet({ ...editingWallet, openingBalance: Math.round((openingBalance - transactionDelta) * 100) / 100 });
    await loadData();
    setEditingWallet(null);
    setWalletBalanceInput('');
    addToast('钱包余额已更新', 'success');
  };

  const handleDeletePlan = async (id: string) => {
    try {
      await LedgerStore.deleteSavingsPlan(id);
      await loadData();
      addToast('已删除存钱计划', 'info');
    } catch (error) {
      console.warn('[OmniLedger] delete plan failed:', error);
      addToast('删除失败', 'error');
    }
  };

  const handleDeposit = async () => {
    if (!depositTarget) return;
    const amount = Number(depositAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      addToast('请输入有效金额', 'error');
      return;
    }

    try {
      await LedgerStore.addSavingsDeposit(depositTarget.id, amount);
      await loadData();
      addToast(`已向「${depositTarget.name}」存入 ${formatMoney(amount)} 元`, 'success');
      setDepositTarget(null);
      setDepositAmount('');
    } catch (error) {
      console.warn('[OmniLedger] deposit failed:', error);
      addToast('存钱失败，请重试', 'error');
    }
  };

  return (
    <div className="h-full w-full flex flex-col overflow-hidden text-slate-800 animate-fade-in bg-gradient-to-b from-emerald-50 via-slate-50 to-white">
      <header
        className="shrink-0 bg-white/40 backdrop-blur-2xl border-b border-white/50"
        style={{ paddingTop: 'var(--safe-top)' }}
      >
        <div className="flex items-center gap-1 px-4 py-3">
          <button
            onClick={closeApp}
            className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform"
            aria-label="返回"
          >
            <CaretLeft className="w-6 h-6 text-slate-600" weight="regular" />
          </button>
          <div className="flex items-center gap-2">
            <span className="w-9 h-9 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shadow-[0_8px_18px_-10px_rgba(5,150,105,0.9)]">
              <Wallet className="w-5 h-5" weight="regular" />
            </span>
            <div>
              <h1 className="text-lg font-black text-slate-800 tracking-tight leading-none">智能记账本</h1>
              <p className="text-[10px] text-slate-400 mt-1">本地优先 · 数据只在你的设备上</p>
            </div>
          </div>
          <button
            onClick={() => {
              setTxForm({ ...EMPTY_TX_FORM, date: getLocalDateKey() });
              setCustomCategory('');
              setShowTxForm(true);
            }}
            className="ml-auto px-3 py-2 rounded-xl bg-emerald-500 text-white text-xs font-bold shadow-[0_10px_22px_-12px_rgba(5,150,105,0.9)] active:scale-95 transition"
          >
            <span className="inline-flex items-center gap-1"><Plus className="w-4 h-4" weight="bold" /> 记一笔</span>
          </button>
        </div>

      </header>

      <main className="flex-1 overflow-y-auto px-4 pt-5 pb-28">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-sm text-slate-400 animate-pulse">正在读取本地账本…</div>
          </div>
        ) : (
          <>
            {tab === 'dashboard' && (
              <div className="space-y-4">
                <section className="relative overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-500 p-5 text-white shadow-[0_20px_42px_-20px_rgba(5,150,105,0.7)]">
                  <div className="absolute -right-10 -top-10 w-36 h-36 rounded-full bg-white/10" />
                  <div className="absolute -left-8 -bottom-16 w-32 h-32 rounded-full bg-slate-950/10" />
                  <div className="relative">
                    <div className="flex items-center justify-between text-xs text-white/70">
                      <span className="font-bold">本月总支出</span>
                      <span>{monthKey.replace('-', ' 年 ') + ' 月'}</span>
                    </div>
                    <p className="mt-2 text-4xl leading-none font-black tracking-tight">¥ {formatMoney(dashboard.expense)}</p>
                    <div className="mt-5 grid grid-cols-2 gap-4 border-t border-white/20 pt-4">
                      <div><p className="text-[10px] text-white/65">本月收入</p><p className="mt-1 text-base font-black">¥ {formatMoney(dashboard.income)}</p></div>
                      <div className="border-l border-white/20 pl-4"><p className="text-[10px] text-white/65">本月结余</p><p className="mt-1 text-base font-black">{dashboard.balance < 0 ? '-' : ''}¥ {formatMoney(Math.abs(dashboard.balance))}</p></div>
                    </div>
                  </div>
                </section>

                <GlassCard className="p-5">
                  <div className="flex items-center gap-2">
                    <ChartDonut className="w-4 h-4 text-emerald-500" weight="bold" />
                    <h2 className="text-sm font-bold text-slate-700">月度收支对比</h2>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1 mb-4">本月总支出 vs 总收入</p>
                  <div className="flex items-end justify-center gap-10 h-36">
                    <div className="flex flex-col items-center gap-2">
                      <span className="text-[11px] font-bold text-slate-500">{formatMoney(dashboard.expense)}</span>
                      <div className="w-12 rounded-t-2xl bg-gradient-to-t from-rose-400 to-rose-300" style={{ height: `${barHeight(dashboard.expense, dashboard.expense, dashboard.income)}px` }} />
                      <span className="text-[10px] text-rose-400 font-bold">支出</span>
                    </div>
                    <div className="flex flex-col items-center gap-2">
                      <span className="text-[11px] font-bold text-slate-500">{formatMoney(dashboard.income)}</span>
                      <div className="w-12 rounded-t-2xl bg-gradient-to-t from-emerald-400 to-emerald-300" style={{ height: `${barHeight(dashboard.income, dashboard.expense, dashboard.income)}px` }} />
                      <span className="text-[10px] text-emerald-500 font-bold">收入</span>
                    </div>
                  </div>
                </GlassCard>

                <GlassCard className="p-5">
                  <div className="flex items-center gap-2">
                    <ChartDonut className="w-4 h-4 text-purple-500" weight="bold" />
                    <h2 className="text-sm font-bold text-slate-700">支出分类占比</h2>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1 mb-4">钱都花在哪了</p>
                  {dashboard.categoryData.length === 0 ? (
                    <div className="py-10 text-center text-xs text-slate-400">本月还没有支出记录</div>
                  ) : (
                    <div className="flex items-center gap-4">
                      <CategoryDonut data={dashboard.categoryData} total={dashboard.expense} />
                      <div className="flex-1 min-w-0 space-y-2">
                        {dashboard.categoryData.map(item => (
                          <div key={item.category} className="flex items-center gap-2 text-xs">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ background: CATEGORY_COLORS[item.category] || '#64748b' }} />
                            <span className="text-slate-500">{item.category}</span>
                            <span className="ml-auto font-bold text-slate-600">{Math.round((item.amount / dashboard.expense) * 100)}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </GlassCard>
              </div>
            )}

            {tab === 'transactions' && (
              <div className="space-y-4">
                <div className="flex gap-2">
                  {(['ALL', 'EXPENSE', 'INCOME'] as const).map(filter => (
                    <button
                      key={filter}
                      onClick={() => setTxFilter(filter)}
                      className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors ${
                        txFilter === filter ? 'bg-slate-800 text-white' : 'bg-white/50 text-slate-400'
                      }`}
                    >
                      {filter === 'ALL' ? '全部' : TYPE_LABEL[filter]}
                    </button>
                  ))}
                </div>

                {visibleTransactions.length === 0 ? (
                  <GlassCard className="p-8 text-center">
                    <Receipt className="w-8 h-8 mx-auto text-slate-300" weight="duotone" />
                    <p className="text-xs text-slate-400 mt-3">还没有流水，点右上角「记一笔」开始吧</p>
                  </GlassCard>
                ) : (
                  visibleTransactions.map(tx => (
                    <GlassCard key={tx.id} className="p-3.5">
                      <div className="flex items-center gap-3">
                        <span className="w-10 h-10 rounded-2xl bg-white/70 flex items-center justify-center text-lg">
                          {CATEGORY_EMOJI[tx.category] || '🏷️'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-slate-700">{tx.category}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/60 text-slate-400">{TYPE_LABEL[tx.type]}</span>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                            {formatDateLabel(tx.date)}
                            {' · '}{wallets.find(wallet => wallet.id === (tx.walletId || 'wallet-cash'))?.name || '现金'}
                            {tx.note ? ` · ${tx.note}` : ''}
                          </p>
                        </div>
                        <p className={`shrink-0 text-right font-black tabular-nums ${tx.type === 'EXPENSE' ? 'text-rose-500' : 'text-emerald-600'}`}>
                          {tx.type === 'EXPENSE' ? '-' : '+'}{formatMoney(tx.amount)}
                        </p>
                        <button
                          onClick={() => handleDeleteTransaction(tx.id)}
                          className="ml-1 p-1.5 rounded-full text-slate-300 hover:text-rose-400 hover:bg-rose-50 active:scale-90 transition"
                          aria-label="删除"
                        >
                          <Trash className="w-4 h-4" weight="regular" />
                        </button>
                      </div>
                    </GlassCard>
                  ))
                )}

              </div>
            )}

            {tab === 'wallets' && (
              <div className="space-y-4">
                <section className="rounded-[1.75rem] bg-slate-800 p-5 text-white shadow-[0_18px_36px_-22px_rgba(15,23,42,0.8)]">
                  <p className="text-xs font-bold text-white/60">全部钱包余额</p>
                  <p className="mt-2 text-3xl font-black tabular-nums">¥ {formatMoney(walletBalances.reduce((sum, wallet) => sum + wallet.balance, 0))}</p>
                  <p className="mt-2 text-[10px] text-white/50">收入和支出会自动同步到所选钱包</p>
                </section>
                <div className="grid grid-cols-2 gap-3">
                  {walletBalances.map(wallet => (
                    <GlassCard key={wallet.id} className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xl">{WALLET_EMOJI[wallet.id] || '💳'}</span>
                        <button
                          onClick={() => { setEditingWallet(wallet); setWalletBalanceInput(String(wallet.balance)); }}
                          className="text-[10px] font-bold text-emerald-600 hover:text-emerald-700"
                        >调整余额</button>
                      </div>
                      <p className="mt-3 text-xs font-bold text-slate-500">{wallet.name}</p>
                      <p className={`mt-1 text-xl font-black tabular-nums ${wallet.balance < 0 ? 'text-rose-500' : 'text-slate-800'}`}>¥ {formatMoney(wallet.balance)}</p>
                    </GlassCard>
                  ))}
                </div>
              </div>
            )}

            {tab === 'savings' && (
              <div className="space-y-4">
                {plans.length === 0 ? (
                  <GlassCard className="p-8 text-center">
                    <PiggyBank className="w-8 h-8 mx-auto text-slate-300" weight="duotone" />
                    <p className="text-xs text-slate-400 mt-3">还没有存钱计划，点下方按钮新建一个</p>
                  </GlassCard>
                ) : (
                  plans.map(plan => {
                    const progress = plan.targetAmount > 0
                      ? Math.min(100, Math.round((plan.currentAmount / plan.targetAmount) * 100))
                      : 0;
                    return (
                      <GlassCard key={plan.id} className="p-5">
                        <div className="flex items-start gap-3">
                          <span className="w-10 h-10 rounded-2xl bg-white/70 flex items-center justify-center text-lg">
                            {plan.status === 'COMPLETED' ? '🎉' : '🐷'}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <h3 className="text-sm font-bold text-slate-700 truncate">{plan.name}</h3>
                              {plan.status === 'COMPLETED' && <CheckCircle className="w-4 h-4 text-emerald-500" weight="fill" />}
                            </div>
                            <p className="text-[10px] text-slate-400 mt-1">
                              {formatMoney(plan.currentAmount)} / {formatMoney(plan.targetAmount)} 元 · {formatDeadline(plan)}
                            </p>
                          </div>
                          <button
                            onClick={() => handleDeletePlan(plan.id)}
                            className="p-1.5 rounded-full text-slate-300 hover:text-rose-400 hover:bg-rose-50 active:scale-90 transition"
                            aria-label="删除计划"
                          >
                            <Trash className="w-4 h-4" weight="regular" />
                          </button>
                        </div>

                        <div className="mt-4 h-4 rounded-full bg-white/60 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${progress >= 100 ? 'bg-emerald-400' : 'bg-gradient-to-r from-sky-400 to-emerald-400'}`}
                            style={{ width: `${Math.max(4, progress)}%` }}
                          />
                        </div>

                        <div className="flex items-center justify-between mt-2">
                          <span className="text-[10px] text-slate-400">{progress}%</span>
                          {plan.status !== 'COMPLETED' && (
                            <button
                              onClick={() => {
                                setDepositTarget(plan);
                                setDepositAmount('');
                              }}
                              className="px-3 py-1.5 rounded-full bg-emerald-500 text-white text-[11px] font-bold active:scale-95 transition"
                            >
                              存一笔
                            </button>
                          )}
                        </div>
                      </GlassCard>
                    );
                  })
                )}

                <button
                  onClick={() => {
                    setPlanForm(EMPTY_PLAN_FORM);
                    setShowPlanForm(true);
                  }}
                  className="w-full py-3 rounded-3xl bg-white/50 border border-dashed border-emerald-300 text-emerald-600 text-xs font-bold flex items-center justify-center gap-2 active:scale-[0.99] transition"
                >
                  <Plus className="w-4 h-4" weight="bold" />
                  新建存钱计划
                </button>
              </div>
            )}
          </>
        )}
      </main>

      <nav
        className="shrink-0 bg-white/45 backdrop-blur-2xl border-t border-white/50 flex items-stretch"
        style={{ paddingBottom: 'var(--safe-bottom)' }}
      >
        {([
          ['dashboard', '看板', ChartDonut],
          ['transactions', '流水', Receipt],
          ['wallets', '钱包', Wallet],
          ['savings', '存钱', PiggyBank],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-bold transition-colors ${
              tab === key ? 'text-emerald-600' : 'text-slate-400'
            }`}
          >
            <Icon className={`w-5 h-5 ${tab === key ? 'text-emerald-600' : 'text-slate-300'}`} weight={tab === key ? 'fill' : 'regular'} />
            {label}
          </button>
        ))}
      </nav>

      {showTxForm && (
        <BottomSheet title="记一笔" onClose={() => setShowTxForm(false)}>
          <div className="flex gap-2 mb-4">
            {(['EXPENSE', 'INCOME'] as const).map(type => (
              <button
                key={type}
                onClick={() => setTxForm(prev => ({ ...prev, type }))}
                className={`flex-1 py-2.5 rounded-2xl text-xs font-bold transition ${
                  txForm.type === type
                    ? type === 'EXPENSE' ? 'bg-rose-500 text-white' : 'bg-emerald-500 text-white'
                    : 'bg-white/60 text-slate-400'
                }`}
              >
                {TYPE_LABEL[type]}
              </button>
            ))}
          </div>

          <FormLabel>金额</FormLabel>
          <input
            type="number"
            inputMode="decimal"
            value={txForm.amount}
            onChange={e => setTxForm(prev => ({ ...prev, amount: e.target.value }))}
            placeholder="0.00"
            className="w-full h-12 rounded-2xl bg-white/70 border border-white/70 px-4 text-lg font-bold text-slate-700 outline-none focus:border-emerald-300 mb-4"
          />

          <FormLabel>{txForm.type === 'INCOME' ? '收入到哪个钱包' : '从哪个钱包支出'}</FormLabel>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {wallets.map(wallet => (
              <button
                key={wallet.id}
                onClick={() => setTxForm(prev => ({ ...prev, walletId: wallet.id }))}
                className={`flex items-center gap-2 rounded-2xl px-3 py-2.5 text-xs font-bold transition ${
                  txForm.walletId === wallet.id ? 'bg-emerald-500 text-white shadow-sm' : 'bg-white/60 text-slate-500'
                }`}
              >
                <span>{WALLET_EMOJI[wallet.id] || '💳'}</span><span className="truncate">{wallet.name}</span>
              </button>
            ))}
          </div>

          <FormLabel>分类</FormLabel>
          <div className="flex flex-wrap gap-2 mb-4">
            {LEDGER_CATEGORIES.map(category => (
              <button
                key={category}
                onClick={() => {
                  setCustomCategory('');
                  setTxForm(prev => ({ ...prev, category }));
                }}
                className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition ${
                  txForm.category === category ? 'bg-slate-800 text-white' : 'bg-white/60 text-slate-400'
                }`}
              >
                {CATEGORY_EMOJI[category] || '🏷️'} {category}
              </button>
            ))}
          </div>

          <input
            value={customCategory}
            maxLength={32}
            onChange={e => setCustomCategory(e.target.value)}
            placeholder="或输入自定义分类，例如：宠物、学习"
            className="w-full h-11 rounded-2xl bg-white/70 border border-white/70 px-4 text-sm text-slate-700 outline-none focus:border-emerald-300 mb-4"
          />

          <FormLabel>日期</FormLabel>
          <div className="relative mb-4">
            <CalendarBlank className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" weight="regular" />
            <input
              type="date"
              value={txForm.date}
              onChange={e => setTxForm(prev => ({ ...prev, date: e.target.value }))}
              className="w-full h-12 rounded-2xl bg-white/70 border border-white/70 pl-10 pr-4 text-sm font-bold text-slate-700 outline-none focus:border-emerald-300"
            />
          </div>

          <FormLabel>备注</FormLabel>
          <textarea
            value={txForm.note}
            onChange={e => setTxForm(prev => ({ ...prev, note: e.target.value }))}
            placeholder="午餐 / 九月工资…"
            rows={2}
            className="w-full rounded-2xl bg-white/70 border border-white/70 px-4 py-3 text-sm text-slate-700 resize-none outline-none focus:border-emerald-300 mb-5"
          />

          <button
            onClick={handleSaveTransaction}
            className="w-full py-3.5 rounded-2xl bg-emerald-500 text-white text-sm font-black active:scale-[0.98] transition"
          >
            保存流水
          </button>
        </BottomSheet>
      )}

      {showPlanForm && (
        <BottomSheet title="新建存钱计划" onClose={() => setShowPlanForm(false)}>
          <FormLabel>计划名称</FormLabel>
          <input
            value={planForm.name}
            onChange={e => setPlanForm(prev => ({ ...prev, name: e.target.value }))}
            placeholder="买 3D 打印机基金"
            className="w-full h-12 rounded-2xl bg-white/70 border border-white/70 px-4 text-sm font-bold text-slate-700 outline-none focus:border-emerald-300 mb-4"
          />

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <FormLabel>目标金额</FormLabel>
              <input
                type="number"
                inputMode="decimal"
                value={planForm.targetAmount}
                onChange={e => setPlanForm(prev => ({ ...prev, targetAmount: e.target.value }))}
                placeholder="3000"
                className="w-full h-12 rounded-2xl bg-white/70 border border-white/70 px-4 text-sm font-bold text-slate-700 outline-none focus:border-emerald-300"
              />
            </div>
            <div>
              <FormLabel>已存金额</FormLabel>
              <input
                type="number"
                inputMode="decimal"
                value={planForm.currentAmount}
                onChange={e => setPlanForm(prev => ({ ...prev, currentAmount: e.target.value }))}
                placeholder="0"
                className="w-full h-12 rounded-2xl bg-white/70 border border-white/70 px-4 text-sm font-bold text-slate-700 outline-none focus:border-emerald-300"
              />
            </div>
          </div>

          <FormLabel>目标日期（可选）</FormLabel>
          <div className="relative mb-5">
            <CalendarBlank className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" weight="regular" />
            <input
              type="date"
              value={planForm.deadline}
              onChange={e => setPlanForm(prev => ({ ...prev, deadline: e.target.value }))}
              className="w-full h-12 rounded-2xl bg-white/70 border border-white/70 pl-10 pr-4 text-sm font-bold text-slate-700 outline-none focus:border-emerald-300"
            />
          </div>

          <button
            onClick={handleSavePlan}
            className="w-full py-3.5 rounded-2xl bg-emerald-500 text-white text-sm font-black active:scale-[0.98] transition"
          >
            创建计划
          </button>
        </BottomSheet>
      )}

      {depositTarget && (
        <BottomSheet title={`向「${depositTarget.name}」存钱`} onClose={() => setDepositTarget(null)}>
          <FormLabel>存入金额</FormLabel>
          <input
            type="number"
            inputMode="decimal"
            value={depositAmount}
            onChange={e => setDepositAmount(e.target.value)}
            placeholder="0.00"
            autoFocus
            className="w-full h-12 rounded-2xl bg-white/70 border border-white/70 px-4 text-lg font-bold text-slate-700 outline-none focus:border-emerald-300 mb-5"
          />
          <button
            onClick={handleDeposit}
            className="w-full py-3.5 rounded-2xl bg-emerald-500 text-white text-sm font-black active:scale-[0.98] transition"
          >
            确认存入
          </button>
        </BottomSheet>
      )}

      {editingWallet && (
        <BottomSheet title={`调整${editingWallet.name}余额`} onClose={() => setEditingWallet(null)}>
          <p className="mb-4 text-xs leading-relaxed text-slate-400">填写该钱包当前实际余额。系统会自动校准起始余额，已有流水不会丢失。</p>
          <FormLabel>当前余额</FormLabel>
          <input
            type="number"
            inputMode="decimal"
            value={walletBalanceInput}
            onChange={e => setWalletBalanceInput(e.target.value)}
            placeholder="0.00"
            autoFocus
            className="w-full h-12 rounded-2xl bg-white/70 border border-white/70 px-4 text-lg font-bold text-slate-700 outline-none focus:border-emerald-300 mb-5"
          />
          <button
            onClick={handleSaveWalletBalance}
            className="w-full py-3.5 rounded-2xl bg-emerald-500 text-white text-sm font-black active:scale-[0.98] transition"
          >
            保存余额
          </button>
        </BottomSheet>
      )}
    </div>
  );
};

const barHeight = (value: number, expense: number, income: number): number => {
  const max = Math.max(expense, income, 1);
  return Math.max(16, Math.round((value / max) * 118));
};

const GlassCard: React.FC<{ className?: string; children: React.ReactNode }> = ({ className = '', children }) => (
  <div className={`rounded-[1.75rem] bg-white/40 backdrop-blur-xl border border-white/60 shadow-[0_12px_36px_-18px_rgba(80,70,120,0.35)] ${className}`}>
    {children}
  </div>
);

const CategoryDonut: React.FC<{ data: Array<{ category: LedgerCategory; amount: number }>; total: number }> = ({ data, total }) => {
  const safeTotal = Math.max(total, 1);
  let cursor = 0;
  const segments = data.map(item => {
    const from = (cursor / safeTotal) * 360;
    cursor += item.amount;
    const to = (cursor / safeTotal) * 360;
    return `${CATEGORY_COLORS[item.category] || '#64748b'} ${from}deg ${to}deg`;
  }).join(', ');

  return (
    <div className="relative w-28 h-28 shrink-0 rounded-full" style={{ background: `conic-gradient(${segments})` }}>
      <div className="absolute inset-3 rounded-full bg-white/75 backdrop-blur flex items-center justify-center">
        <span className="text-[10px] font-bold text-slate-400">支出</span>
      </div>
    </div>
  );
};

const FormLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <label className="block text-[10px] font-bold text-slate-400 tracking-widest mb-1.5">{children}</label>
);

const BottomSheet: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div
    className="absolute inset-0 z-40 flex items-end bg-slate-900/25 backdrop-blur-sm"
    onClick={onClose}
  >
    <div
      className="w-full rounded-t-[2rem] bg-white/80 backdrop-blur-2xl border-t border-white/70 px-5 pt-3 max-h-[88%] overflow-y-auto"
      style={{ paddingBottom: 'calc(var(--safe-bottom) + 16px)' }}
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-black text-slate-700">{title}</h2>
        <button onClick={onClose} className="p-2 rounded-full bg-white/70 text-slate-400 hover:text-slate-600 active:scale-90 transition">
          <X className="w-4 h-4" weight="bold" />
        </button>
      </div>
      {children}
    </div>
  </div>
);

export default OmniLedgerApp;
