import type { FocusSession, FocusTask } from '../types';

export const FOCUS_CONTEXT_STORAGE_KEY = 'sully_focus_context_v1';

export interface FocusContextSnapshot {
  dateKey: string;
  todaySeconds: number;
  todayByTask: Record<string, number>;
  taskNames: Record<string, string>;
  updatedAt: number;
}

const localDateKey = (timestamp: number): string => {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

export const buildFocusContextSnapshot = (
  tasks: FocusTask[],
  sessions: FocusSession[],
  now = Date.now(),
  activeSession?: Pick<FocusSession, 'taskId' | 'durationSeconds'>,
): FocusContextSnapshot => {
  const dateKey = localDateKey(now);
  const todayByTask: Record<string, number> = {};
  for (const session of sessions) {
    if (localDateKey(session.startTime) !== dateKey) continue;
    todayByTask[session.taskId] = (todayByTask[session.taskId] || 0) + Math.max(0, Number(session.durationSeconds) || 0);
  }
  if (activeSession && activeSession.durationSeconds > 0) {
    todayByTask[activeSession.taskId] = (todayByTask[activeSession.taskId] || 0) + Math.max(0, Number(activeSession.durationSeconds) || 0);
  }
  const taskNames: Record<string, string> = {};
  for (const task of tasks) taskNames[task.id] = task.name;
  return {
    dateKey,
    todaySeconds: Object.values(todayByTask).reduce((sum, seconds) => sum + seconds, 0),
    todayByTask,
    taskNames,
    updatedAt: now,
  };
};

export const readFocusContextSnapshot = (): FocusContextSnapshot | null => {
  try {
    const raw = localStorage.getItem(FOCUS_CONTEXT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FocusContextSnapshot;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.todaySeconds !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
};

export const writeFocusContextSnapshot = (snapshot: FocusContextSnapshot): void => {
  try {
    localStorage.setItem(FOCUS_CONTEXT_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // localStorage can be unavailable in private browsing; IndexedDB remains authoritative.
  }
};

export const syncFocusContextSnapshot = (
  tasks: FocusTask[],
  sessions: FocusSession[],
  activeSession?: Pick<FocusSession, 'taskId' | 'durationSeconds'>,
): FocusContextSnapshot => {
  const snapshot = buildFocusContextSnapshot(tasks, sessions, Date.now(), activeSession);
  writeFocusContextSnapshot(snapshot);
  return snapshot;
};

export const formatFocusHours = (seconds: number): string => {
  const hours = Math.floor(Math.max(0, seconds) / 3600);
  const minutes = Math.floor((Math.max(0, seconds) % 3600) / 60);
  if (hours > 0) return `${hours}小时${minutes ? ` ${minutes}分钟` : ''}`;
  return `${minutes}分钟`;
};
