import type {
  LedgerCategory,
  LedgerSavingsPlan,
  LedgerTransaction,
  LedgerTransactionType,
  LedgerWallet,
} from '../types';
import {
  buildLedgerContextSnapshot,
  type LedgerContextSnapshot,
  writeLedgerContextSnapshot,
} from './ledgerContext';

const DB_NAME = 'SullyOS_OmniLedger';
const DB_VERSION = 2;
const STORE_TRANSACTIONS = 'transactions';
const STORE_SAVINGS_PLANS = 'savings_plans';
const STORE_WALLETS = 'wallets';

const DEFAULT_WALLETS: Array<Pick<LedgerWallet, 'id' | 'name'>> = [
  { id: 'wallet-wechat', name: '微信' },
  { id: 'wallet-alipay', name: '支付宝' },
  { id: 'wallet-cash', name: '现金' },
  { id: 'wallet-bank', name: '银行卡' },
];

let dbPromise: Promise<IDBDatabase> | null = null;

export const LEDGER_CATEGORIES: LedgerCategory[] = ['餐饮', '交通', '购物', '娱乐', '居住', '工资', '其他'];

export const LEDGER_CATEGORY_LABELS: Record<string, string> = {
  餐饮: '餐饮',
  交通: '交通',
  购物: '购物',
  娱乐: '娱乐',
  居住: '居住',
  工资: '工资',
  其他: '其他',
};

export const normalizeLedgerCategory = (raw: string): LedgerCategory => {
  const text = (raw || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 32);
  if (!text) return '其他';
  if (LEDGER_CATEGORIES.includes(text as LedgerCategory)) return text as LedgerCategory;

  if (/饭|餐|吃|外卖|奶茶|咖啡|早餐|午餐|晚餐|夜宵|零食|食材|买菜/.test(text)) return '餐饮';
  if (/打车|地铁|公交|高铁|火车|飞机|机票|油费|停车|交通|出行/.test(text)) return '交通';
  if (/买|购物|衣服|鞋|包|化妆品|日用品|数码|淘宝|京东|网购/.test(text)) return '购物';
  if (/游戏|电影|演出|音乐|ktv|演唱会|旅游|娱乐|会员|视频/.test(text)) return '娱乐';
  if (/房租|房貸|房贷|水电|物业|燃气|家居|居住|酒店/.test(text)) return '居住';
  if (/工资|薪资|薪水|奖金|收入|报销|兼职|稿费/.test(text)) return '工资';
  // 保留用户明确输入的分类，月度看板与 AI 财务摘要会按它聚合。
  return text;
};

const openLedgerDB = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_TRANSACTIONS)) {
        const txStore = db.createObjectStore(STORE_TRANSACTIONS, { keyPath: 'id' });
        txStore.createIndex('date', 'date', { unique: false });
        txStore.createIndex('sourceKey', 'sourceKey', { unique: true });
      }
      if (!db.objectStoreNames.contains(STORE_SAVINGS_PLANS)) {
        db.createObjectStore(STORE_SAVINGS_PLANS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_WALLETS)) {
        db.createObjectStore(STORE_WALLETS, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };

    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };

    request.onblocked = () => {
      dbPromise = null;
      reject(new Error('OmniLedger IndexedDB upgrade blocked'));
    };
  });

  return dbPromise;
};

const runOnStore = <T>(
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  return openLedgerDB().then((db) => new Promise<T>((resolve, reject) => {
    let result: T | undefined;
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const request = operation(store);

    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve(result as T);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
};

export type SaveLedgerTransactionResult = 'created' | 'duplicate';

const getTransactionsBySourceKey = async (sourceKey: string): Promise<LedgerTransaction[]> => {
  return runOnStore<LedgerTransaction[]>(STORE_TRANSACTIONS, 'readonly', store =>
    store.index('sourceKey').getAll(sourceKey),
  );
};

const putTransaction = (tx: LedgerTransaction): Promise<void> =>
  runOnStore<IDBValidKey>(STORE_TRANSACTIONS, 'readwrite', store => store.put(tx)).then(() => undefined);

export const getAllTransactions = (): Promise<LedgerTransaction[]> =>
  runOnStore<LedgerTransaction[]>(STORE_TRANSACTIONS, 'readonly', store => store.getAll());

export const getAllSavingsPlans = (): Promise<LedgerSavingsPlan[]> =>
  runOnStore<LedgerSavingsPlan[]>(STORE_SAVINGS_PLANS, 'readonly', store => store.getAll());

export const getAllWallets = async (): Promise<LedgerWallet[]> => {
  const wallets = await runOnStore<LedgerWallet[]>(STORE_WALLETS, 'readonly', store => store.getAll());
  if (wallets.length > 0) return wallets;

  const defaults = DEFAULT_WALLETS.map(wallet => ({ ...wallet, openingBalance: 0, createdAt: Date.now() }));
  const db = await openLedgerDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_WALLETS, 'readwrite');
    const store = tx.objectStore(STORE_WALLETS);
    defaults.forEach(wallet => store.put(wallet));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  return defaults;
};

export const saveWallet = async (wallet: LedgerWallet): Promise<void> => {
  await runOnStore<IDBValidKey>(STORE_WALLETS, 'readwrite', store => store.put(wallet));
};

export const createWallet = async (name: string, openingBalance = 0): Promise<LedgerWallet> => {
  const wallet: LedgerWallet = {
    id: makeLedgerId('wallet'),
    name: name.trim().slice(0, 24) || '未命名钱包',
    openingBalance: Math.round((Number(openingBalance) || 0) * 100) / 100,
    createdAt: Date.now(),
  };
  await saveWallet(wallet);
  return wallet;
};

export const saveLedgerTransaction = async (tx: LedgerTransaction): Promise<SaveLedgerTransactionResult> => {
  if (tx.sourceKey) {
    const existing = await getTransactionsBySourceKey(tx.sourceKey);
    if (existing.length > 0) return 'duplicate';
  }

  try {
    await putTransaction(tx);
    return 'created';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'ConstraintError') return 'duplicate';
    throw error;
  }
};

export interface CreateLedgerTransactionInput {
  amount: number;
  type: LedgerTransactionType;
  category: LedgerCategory;
  note?: string;
  date?: number;
  sourceKey?: string;
  walletId?: string;
}

const makeLedgerId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

export const createLedgerTransaction = async (input: CreateLedgerTransactionInput) => {
  const amount = Math.round((Number(input.amount) || 0) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Ledger transaction amount must be greater than zero');
  }
  const tx: LedgerTransaction = {
    id: makeLedgerId('ledger'),
    amount,
    type: input.type,
    category: normalizeLedgerCategory(input.category),
    note: (input.note || '').trim(),
    date: input.date ?? Date.now(),
    ...(input.sourceKey ? { sourceKey: input.sourceKey } : {}),
    ...(input.walletId ? { walletId: input.walletId } : {}),
  };

  const status = await saveLedgerTransaction(tx);
  return { transaction: tx, status };
};

export const deleteLedgerTransaction = async (id: string): Promise<void> => {
  await runOnStore<undefined>(STORE_TRANSACTIONS, 'readwrite', store => store.delete(id));
};

export interface CreateSavingsPlanInput {
  name: string;
  targetAmount: number;
  currentAmount?: number;
  deadline?: number | null;
}

export const createSavingsPlan = async (input: CreateSavingsPlanInput): Promise<LedgerSavingsPlan> => {
  const currentAmount = Math.max(0, Math.round((Number(input.currentAmount) || 0) * 100) / 100);
  const targetAmount = Math.max(0, Math.round((Number(input.targetAmount) || 0) * 100) / 100);
  const plan: LedgerSavingsPlan = {
    id: makeLedgerId('saving'),
    name: (input.name || '').trim() || '未命名存钱计划',
    targetAmount,
    currentAmount,
    deadline: input.deadline ?? null,
    status: currentAmount >= targetAmount ? 'COMPLETED' : 'ACTIVE',
    createdAt: Date.now(),
    ...(currentAmount >= targetAmount ? { completedAt: Date.now() } : {}),
  };

  await runOnStore<IDBValidKey>(STORE_SAVINGS_PLANS, 'readwrite', store => store.put(plan));
  return plan;
};

export const saveSavingsPlan = async (plan: LedgerSavingsPlan): Promise<void> => {
  await runOnStore<IDBValidKey>(STORE_SAVINGS_PLANS, 'readwrite', store => store.put(plan));
};

export const deleteSavingsPlan = async (id: string): Promise<void> => {
  await runOnStore<undefined>(STORE_SAVINGS_PLANS, 'readwrite', store => store.delete(id));
};

export const addSavingsDeposit = async (id: string, amount: number): Promise<LedgerSavingsPlan | null> => {
  const plans = await getAllSavingsPlans();
  const plan = plans.find(item => item.id === id);
  if (!plan) return null;

  const deposit = Math.max(0, Math.round((Number(amount) || 0) * 100) / 100);
  const next = {
    ...plan,
    currentAmount: Math.round((Math.max(0, plan.currentAmount || 0) + deposit) * 100) / 100,
  };
  if (next.currentAmount >= next.targetAmount) {
    next.status = 'COMPLETED';
    next.completedAt = Date.now();
  }
  await saveSavingsPlan(next);
  return next;
};

export const refreshLedgerContextSnapshot = async (): Promise<LedgerContextSnapshot> => {
  const [transactions, plans] = await Promise.all([getAllTransactions(), getAllSavingsPlans()]);
  const snapshot = buildLedgerContextSnapshot(transactions, plans);
  writeLedgerContextSnapshot(snapshot);
  return snapshot;
};

export const LedgerStore = {
  getAllTransactions,
  getAllSavingsPlans,
  getAllWallets,
  saveWallet,
  createWallet,
  createLedgerTransaction,
  deleteLedgerTransaction,
  createSavingsPlan,
  saveSavingsPlan,
  deleteSavingsPlan,
  addSavingsDeposit,
  refreshLedgerContextSnapshot,
};
