import type { LedgerCategory, LedgerTransactionType } from '../types';
import { createLedgerTransaction, createSavingsPlan, normalizeLedgerCategory, refreshLedgerContextSnapshot } from './ledgerStore';

export interface LedgerDirective {
  verb: 'EXPENSE' | 'INCOME' | 'SAVING';
  args: string[];
  raw: string;
}

const LEDGER_TAG_GLOBAL_RE = /\[\[LEDGER:(EXPENSE|INCOME|SAVING)(?:\|([^\]]*))?\]\]/gi;

export const extractLedgerDirectives = (content: string): { text: string; directives: LedgerDirective[] } => {
  const directives: LedgerDirective[] = [];
  const matches = [...content.matchAll(LEDGER_TAG_GLOBAL_RE)];
  for (const match of matches) {
    const verb = match[1].toUpperCase() as LedgerDirective['verb'];
    const args = (match[2] || '').split('|').map(part => part.trim());
    directives.push({ verb, args, raw: match[0] });
  }

  const text = content.replace(LEDGER_TAG_GLOBAL_RE, '').trim();
  return { text, directives };
};

const hashSource = (value: string): string => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const parseAmount = (raw: string): number | null => {
  const value = Number((raw || '').replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100) / 100;
};

const parseDateInput = (raw?: string): number | null => {
  const text = (raw || '').trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const timestamp = new Date(`${text}T00:00:00`).getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
  }
  const direct = Date.parse(text);
  return Number.isNaN(direct) ? null : direct;
};

const buildLedgerSourceKey = (charId: string, raw: string, index: number, messageTimestamp?: number): string => {
  const stable = `${charId}:${messageTimestamp ?? 'local'}:${index}:${raw}`;
  return `ledger:${hashSource(stable)}`;
};

/**
 * 解析 AI 回复中的 [[LEDGER:...]] 记账标签。
 * 写入 OmniLedger IndexedDB，并刷新给 ContextBuilder 使用的轻量快照。
 * 标签永远会从正文中剥掉，避免用户看到原始指令。
 */
export const executeLedgerDirectives = async (
  content: string,
  charId: string,
  addToast: (msg: string, type: 'info' | 'success' | 'error') => void,
  messageTimestamp?: number,
): Promise<string> => {
  const { text, directives } = extractLedgerDirectives(content);

  for (let index = 0; index < directives.length; index += 1) {
    const directive = directives[index];
    try {
      if (directive.verb === 'EXPENSE' || directive.verb === 'INCOME') {
        const amount = parseAmount(directive.args[0] || '');
        if (amount === null) {
          addToast('账本标签金额无效，已忽略这条记账', 'error');
          continue;
        }

        const type: LedgerTransactionType = directive.verb;
        const category = normalizeLedgerCategory(directive.args[1] || '其他') as LedgerCategory;
        const note = directive.args.slice(2).join(' | ').trim();
        const sourceKey = buildLedgerSourceKey(charId, directive.raw, index, messageTimestamp);
        const result = await createLedgerTransaction({
          amount,
          type,
          category,
          note,
          date: messageTimestamp ?? Date.now(),
          sourceKey,
        });

        if (result.status === 'created') {
          const label = type === 'EXPENSE' ? '支出' : '收入';
          addToast(`已帮你记账：${label} ${amount} 元 · ${category}`, 'success');
        }
      }

      if (directive.verb === 'SAVING') {
        const name = directive.args[0]?.trim();
        const targetAmount = parseAmount(directive.args[1] || '');
        if (!name) {
          addToast('存钱计划缺少名称，已忽略', 'error');
          continue;
        }
        if (targetAmount === null) {
          addToast('存钱计划目标金额无效，已忽略', 'error');
          continue;
        }
        const deadline = parseDateInput(directive.args[2]);
        const currentAmount = parseAmount(directive.args[3] || '0') ?? 0;
        const plan = await createSavingsPlan({ name, targetAmount, currentAmount, deadline });
        addToast(`已创建存钱计划「${plan.name}」`, 'success');
      }
    } catch (error) {
      console.warn('[OmniLedger] directive ignored:', directive.verb, error);
      addToast('账本写入失败，已忽略这条标签', 'error');
    }
  }

  await refreshLedgerContextSnapshot().catch(error => {
    console.warn('[OmniLedger] context snapshot refresh failed:', error);
  });

  return text;
};
