import { Capacitor, registerPlugin } from '@capacitor/core';

export interface ScreenTimeAppUsage {
  packageName: string;
  appName: string;
  foregroundMs: number;
  lastUsedMs?: number;
}

export interface ScreenTimeResult {
  startMs: number;
  endMs: number;
  totalForegroundMs: number;
  apps: ScreenTimeAppUsage[];
}

interface ScreenTimeNativePlugin {
  getStatus(): Promise<{ native: boolean; hasUsageAccess: boolean }>;
  openUsageAccessSettings(): Promise<void>;
  query(options: { startMs: number; endMs: number; limit?: number }): Promise<ScreenTimeResult>;
}

const NativeScreenTime = registerPlugin<ScreenTimeNativePlugin>('ScreenTime');
const ENABLED_KEY = 'sully_screen_time_enabled_v1';

export const isScreenTimePlatform = (): boolean => {
  try { return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'; }
  catch { return false; }
};

export const isScreenTimeEnabled = (): boolean => {
  try { return localStorage.getItem(ENABLED_KEY) === 'true'; } catch { return false; }
};

export const setScreenTimeEnabled = (enabled: boolean): void => {
  try { localStorage.setItem(ENABLED_KEY, String(enabled)); } catch { /* private mode */ }
};

export const getScreenTimeStatus = async () => {
  if (!isScreenTimePlatform()) return { native: false, hasUsageAccess: false };
  return NativeScreenTime.getStatus();
};

export const openScreenTimeSettings = async (): Promise<void> => {
  if (!isScreenTimePlatform()) throw new Error('屏幕使用时间只支持 Android App。');
  await NativeScreenTime.openUsageAccessSettings();
};

const dayStart = (date: Date): number => {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
};

export const queryScreenTime = async (days = 1): Promise<ScreenTimeResult> => {
  if (!isScreenTimePlatform()) throw new Error('屏幕使用时间只支持 Android App。');
  const safeDays = Math.max(1, Math.min(30, Math.floor(days)));
  const endMs = Date.now();
  const start = new Date(endMs);
  start.setDate(start.getDate() - (safeDays - 1));
  return NativeScreenTime.query({ startMs: dayStart(start), endMs, limit: 30 });
};

export const formatScreenTime = (result: ScreenTimeResult): string => {
  const minutes = Math.round(result.totalForegroundMs / 60000);
  const appLines = result.apps
    .filter(app => app.foregroundMs > 0)
    .slice(0, 20)
    .map((app, index) => `${index + 1}. ${app.appName || app.packageName}：${Math.round(app.foregroundMs / 60000)} 分钟`);
  return `统计区间：${new Date(result.startMs).toLocaleString()} 至 ${new Date(result.endMs).toLocaleString()}\n总使用时间：${minutes} 分钟\n${appLines.length ? `应用明细：\n${appLines.join('\n')}` : '应用明细：暂无数据'}`;
};

export const SCREEN_TIME_TOOL = {
  type: 'function' as const,
  function: {
    name: 'read_screen_time',
    description: '读取用户 Android 手机的屏幕使用时间。只有用户已授权时才能调用。用户问今天、最近几天用了多久或哪些应用用得多时使用。不要猜测结果，也不要频繁调用。',
    parameters: {
      type: 'object',
      properties: { days: { type: 'integer', minimum: 1, maximum: 30, description: '统计最近几天，默认 1 天，最多 30 天。' } },
    },
  },
};

export const executeScreenTimeTool = async (args: Record<string, unknown>): Promise<string> => {
  if (!isScreenTimeEnabled()) return '屏幕使用时间功能没有开启，请先在 SullyOS 设置中开启。';
  const status = await getScreenTimeStatus();
  if (!status.hasUsageAccess) return '用户还没有授予 Android 使用情况访问权限。请先在系统设置中允许 SullyOS 访问使用情况。';
  const result = await queryScreenTime(Number(args.days) || 1);
  return formatScreenTime(result);
};
