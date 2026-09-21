import React, { useEffect, useMemo, useState } from 'react';
import { Archive, ArrowCounterClockwise, ArrowLeft, Bell, CalendarBlank, CaretLeft, CaretRight, Check, Drop, Lightning, Minus, Plus, Smiley, SmileyMeh, SmileySad, Trash, X } from '@phosphor-icons/react';
import { LocalNotifications } from '@capacitor/local-notifications';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { ContextBuilder } from '../utils/context';
import { safeResponseJson } from '../utils/safeApi';
import { injectMemoryPalace } from '../utils/memoryPalace/pipeline';
import { expandCalendarDateRange } from '../utils/calendarRange';
import { unlockAchievement } from '../utils/starlightAchievements';
import type { Anniversary, CalendarEvent, CalendarEventType, MenstrualCycle, MenstrualFlow, MenstrualDailyLog, MenstrualPeriodRecord, Task } from '../types';

type Tab = 'schedule';
type EntrySource = 'calendar' | 'task' | 'anniversary';

interface ScheduleEntry {
  key: string;
  source: EntrySource;
  title: string;
  date: string;
  type: CalendarEventType;
  description: string;
  isCompleted: boolean;
  dueDate?: string;
  reminderAt?: string;
  archivedAt?: number;
  record: CalendarEvent | Task | Anniversary;
}

const TYPE_META: Record<CalendarEventType, { label: string; dot: string; chip: string }> = {
  TODO: { label: '待办', dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700 border-sky-100' },
  DEADLINE: { label: 'Deadline', dot: 'bg-violet-500', chip: 'bg-violet-50 text-violet-700 border-violet-100' },
  ANNIVERSARY: { label: '纪念日', dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700 border-rose-100' },
  MENSTRUATION: { label: '生理期', dot: 'bg-pink-400', chip: 'bg-pink-50 text-pink-700 border-pink-100' },
};

const pad = (value: number) => String(value).padStart(2, '0');
const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const todayKey = () => dateKey(new Date());
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const notificationId = (value: string) => Array.from(value).reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) & 0x7fffffff, 17);

const addDays = (key: string, amount: number) => {
  const date = new Date(`${key}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return dateKey(date);
};

const formatDate = (key: string) => {
  const [year, month, day] = key.split('-').map(Number);
  return `${year}年${month}月${day}日`;
};

const monthTitle = (cursor: Date) => `${cursor.getFullYear()} 年 ${cursor.getMonth() + 1} 月`;

const getMonthDays = (cursor: Date) => {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const offset = first.getDay();
  const total = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - offset + 1;
    return day > 0 && day <= total ? new Date(cursor.getFullYear(), cursor.getMonth(), day) : null;
  });
};

const getMonthDaysMondayFirst = (cursor: Date) => {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const total = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - offset + 1;
    return day > 0 && day <= total ? new Date(cursor.getFullYear(), cursor.getMonth(), day) : null;
  });
};

const cycleStarts = (cycle: MenstrualCycle | null) => {
  const starts = (cycle?.periods || []).map(period => period.startDate).filter(Boolean);
  if (cycle?.lastPeriodDate) starts.push(cycle.lastPeriodDate);
  return Array.from(new Set(starts)).sort();
};

const calculatedCycleDays = (cycle: MenstrualCycle | null) => {
  const starts = cycleStarts(cycle).map(value => new Date(`${value}T12:00:00`).getTime()).sort((a, b) => a - b);
  const gaps = starts.slice(1).map((value, index) => Math.round((value - starts[index]) / 86400000)).filter(value => value >= 15 && value <= 60);
  if (!gaps.length) return cycle?.averageCycleDays || 28;
  const weighted = gaps.reduce((sum, value, index) => sum + value * (index + 1), 0);
  return Math.round(weighted / ((gaps.length * (gaps.length + 1)) / 2));
};

const predictPeriodStarts = (cycle: MenstrualCycle | null, count = 4) => {
  const starts = cycleStarts(cycle);
  const latest = starts.at(-1);
  const average = calculatedCycleDays(cycle);
  if (!latest || !average) return [];
  const base = new Date(`${latest}T12:00:00`);
  return Array.from({ length: count }, (_, index) => {
    const predicted = new Date(base);
    predicted.setDate(base.getDate() + average * (index + 1));
    return dateKey(predicted);
  });
};

const IconButton: React.FC<{ label: string; onClick: () => void; children: React.ReactNode; className?: string }> = ({ label, onClick, children, className = '' }) => (
  <button type="button" aria-label={label} title={label} onClick={onClick} className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition active:scale-95 ${className}`}>{children}</button>
);

/** 月历下拉出的当日安排：保持紧凑，让月历仍是首要信息。 */
const SelectedScheduleList: React.FC<{
  date: string;
  entries: ScheduleEntry[];
  onAdd: () => void;
  onToggle: (entry: ScheduleEntry) => void;
  onRemove: (entry: ScheduleEntry) => void;
}> = ({ date, entries, onAdd, onToggle, onRemove }) => <div className="mt-3 border-t border-slate-100 pt-3">
  <div className="mb-2 flex items-center justify-between"><div><h2 className="text-sm font-bold text-slate-800">{formatDate(date)}</h2><p className="text-[10px] text-slate-400">{entries.length ? `${entries.length} 项安排` : '暂无安排'}</p></div><IconButton label="添加日程" onClick={onAdd} className="h-8 w-8 bg-slate-800 text-white shadow-sm"><Plus size={16} weight="bold" /></IconButton></div>
  <div className="space-y-1.5">{entries.map(entry => {
    const canComplete = entry.type === 'TODO' || entry.type === 'DEADLINE';
    return <div key={entry.key} className="flex min-h-10 items-center gap-2 rounded-xl bg-white/80 px-2.5 py-1.5 ring-1 ring-slate-100">
      {canComplete ? <button aria-label={entry.isCompleted ? '标记未完成' : '标记完成'} onClick={() => onToggle(entry)} className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${entry.isCompleted ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white'}`}>{entry.isCompleted && <Check size={10} weight="bold" />}</button> : <span className={`h-2 w-2 shrink-0 rounded-full ${TYPE_META[entry.type].dot}`} />}
      <div className="min-w-0 flex-1"><p className={`truncate text-xs font-semibold ${entry.isCompleted ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{entry.title}</p><p className="truncate text-[9px] text-slate-400">{entry.dueDate && entry.dueDate !== entry.date ? `至 ${formatDate(entry.dueDate)} · ` : ''}{TYPE_META[entry.type].label}</p></div>
      <button aria-label="删除日程" onClick={() => onRemove(entry)} className="p-1 text-slate-300 hover:text-rose-500"><Trash size={14} /></button>
    </div>;
  })}{!entries.length && <p className="py-3 text-center text-[11px] text-slate-400">点右侧 + 留下一件小事吧。</p>}</div>
</div>;

const OmniCalendarApp: React.FC = () => {
  const { closeApp, addToast, characters, apiConfig, userProfile } = useOS();
  const [tab, setTab] = useState<Tab>('schedule');
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [legacyTasks, setLegacyTasks] = useState<Task[]>([]);
  const [legacyAnniversaries, setLegacyAnniversaries] = useState<Anniversary[]>([]);
  const [cycle, setCycle] = useState<MenstrualCycle | null>(null);
  const [monthCursor, setMonthCursor] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [showEventForm, setShowEventForm] = useState(false);
  const [eventTitle, setEventTitle] = useState('');
  const [eventDescription, setEventDescription] = useState('');
  const [eventDate, setEventDate] = useState(todayKey());
  const [eventDueDate, setEventDueDate] = useState('');
  const [eventReminderAt, setEventReminderAt] = useState('');
  const [eventType, setEventType] = useState<CalendarEventType>('TODO');
  const [linkedCharacterId, setLinkedCharacterId] = useState('');
  const [showArchive, setShowArchive] = useState(false);
  const [lastPeriodDate, setLastPeriodDate] = useState('');
  const [averageCycleDays, setAverageCycleDays] = useState(28);
  const [periods, setPeriods] = useState<MenstrualPeriodRecord[]>([]);
  const [cycleLogs, setCycleLogs] = useState<MenstrualDailyLog[]>([]);
  const [periodEndDate, setPeriodEndDate] = useState('');
  const [periodPain, setPeriodPain] = useState(0);
  const [periodFlow, setPeriodFlow] = useState<MenstrualFlow>('medium');
  const [periodMood, setPeriodMood] = useState<'happy' | 'neutral' | 'low'>('neutral');
  const [periodNotes, setPeriodNotes] = useState('');

  const loadData = async () => {
    try {
      const [loadedEvents, loadedTasks, loadedAnniversaries, loadedCycle] = await Promise.all([
        DB.getAllCalendarEvents(), DB.getAllTasks(), DB.getAllAnniversaries(), DB.getMenstrualCycle(),
      ]);
      setEvents(loadedEvents.sort((a, b) => a.date.localeCompare(b.date)));
      setLegacyTasks(loadedTasks.sort((a, b) => b.createdAt - a.createdAt));
      setLegacyAnniversaries(loadedAnniversaries.sort((a, b) => a.date.localeCompare(b.date)));
      setCycle(loadedCycle);
      setLastPeriodDate(loadedCycle?.lastPeriodDate || '');
      setAverageCycleDays(loadedCycle?.averageCycleDays || 28);
      setPeriods(loadedCycle?.periods || []);
      setCycleLogs(loadedCycle?.logs || []);
    } catch (error) {
      console.error('Failed to load OmniCalendar data', error);
      addToast('日历数据读取失败，请稍后重试', 'error');
    }
  };

  useEffect(() => { void loadData(); }, []);

  const characterNames = useMemo(() => new Map(characters.map(character => [character.id, character.name])), [characters]);
  const allScheduleEntries = useMemo<ScheduleEntry[]>(() => [
    ...events.map(event => ({
      key: `calendar:${event.id}`, source: 'calendar' as const, title: event.title, date: event.date,
      type: event.type, description: event.description, isCompleted: event.isCompleted, dueDate: event.dueDate,
      reminderAt: event.reminderAt, archivedAt: event.archivedAt, record: event,
    })),
    ...legacyTasks.filter(task => Boolean(task.deadline)).map(task => ({
      key: `task:${task.id}`, source: 'task' as const, title: task.title, date: task.startDate || task.deadline!, type: 'TODO' as const,
      description: `角色监督：${characterNames.get(task.supervisorId) || '未知角色'}`, dueDate: task.deadline,
      isCompleted: task.isCompleted, reminderAt: task.reminderAt, archivedAt: task.archivedAt, record: task,
    })),
    ...legacyAnniversaries.map(anniversary => ({
      key: `anniversary:${anniversary.id}`, source: 'anniversary' as const, title: anniversary.title, date: anniversary.date,
      type: 'ANNIVERSARY' as const,
      description: `${characterNames.get(anniversary.charId) || '角色'}的纪念日${anniversary.aiThought ? ` · “${anniversary.aiThought}”` : ''}`,
      isCompleted: false, record: anniversary,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title)), [characterNames, events, legacyAnniversaries, legacyTasks]);
  const scheduleEntries = useMemo(() => allScheduleEntries.filter(entry => !entry.archivedAt), [allScheduleEntries]);
  const archivedEntries = useMemo(() => allScheduleEntries.filter(entry => entry.archivedAt).sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0)), [allScheduleEntries]);
  const entriesByDate = useMemo(() => {
    const result = new Map<string, ScheduleEntry[]>();
    scheduleEntries.forEach(entry => {
      expandCalendarDateRange(entry.date, entry.dueDate).forEach(date => {
        result.set(date, [...(result.get(date) || []), entry]);
      });
    });
    return result;
  }, [scheduleEntries]);
  const calendarDays = useMemo(() => getMonthDays(monthCursor), [monthCursor]);
  const cycleCalendarDays = useMemo(() => getMonthDaysMondayFirst(monthCursor), [monthCursor]);
  const eventsForSelectedDate = useMemo(() => entriesByDate.get(selectedDate) || [], [entriesByDate, selectedDate]);
  const inboxTasks = useMemo(() => legacyTasks.filter(task => !task.deadline && !task.archivedAt), [legacyTasks]);
  const predictedStarts = useMemo(() => predictPeriodStarts(cycle), [cycle]);
  const effectivePeriods = useMemo<MenstrualPeriodRecord[]>(() => {
    if (!cycle?.lastPeriodDate || periods.some(period => period.startDate === cycle.lastPeriodDate)) return periods;
    return [...periods, { id: `period-${cycle.lastPeriodDate}`, startDate: cycle.lastPeriodDate }];
  }, [cycle, periods]);
  const recordedPeriodDays = useMemo(() => new Set(effectivePeriods.flatMap(period => {
    const start = new Date(`${period.startDate}T12:00:00`);
    const end = period.endDate ? new Date(`${period.endDate}T12:00:00`) : new Date(`${todayKey()}T12:00:00`);
    const days = Math.max(1, Math.min(10, Math.round((end.getTime() - start.getTime()) / 86400000) + 1));
    return Array.from({ length: days }, (_, index) => { const day = new Date(start); day.setDate(start.getDate() + index); return dateKey(day); });
  })), [effectivePeriods]);
  const predictedPeriodDays = useMemo(() => new Set(predictedStarts.flatMap(start => {
    const initial = new Date(`${start}T12:00:00`);
    return Array.from({ length: 5 }, (_, index) => {
      const day = new Date(initial);
      day.setDate(initial.getDate() + index);
      return dateKey(day);
    });
  })), [predictedStarts]);
  const ovulationDays = useMemo(() => new Set(predictedStarts.map(start => addDays(start, -14))), [predictedStarts]);
  const fertileDays = useMemo(() => new Set(predictedStarts.flatMap(start => {
    const ovulation = addDays(start, -14);
    return Array.from({ length: 7 }, (_, index) => addDays(ovulation, index - 5));
  })), [predictedStarts]);
  const currentPeriod = useMemo(() => effectivePeriods.find(period => {
    const end = period.endDate || addDays(period.startDate, 9);
    return period.startDate <= todayKey() && end >= todayKey();
  }), [effectivePeriods]);
  const currentCycleDay = currentPeriod ? Math.max(1, Math.round((new Date(`${todayKey()}T12:00:00`).getTime() - new Date(`${currentPeriod.startDate}T12:00:00`).getTime()) / 86400000) + 1) : null;
  const nextPredictedStart = predictedStarts.find(start => start >= todayKey());
  const daysUntilNextPeriod = nextPredictedStart ? Math.max(0, Math.round((new Date(`${nextPredictedStart}T12:00:00`).getTime() - new Date(`${todayKey()}T12:00:00`).getTime()) / 86400000)) : null;
  const cycleLogDates = useMemo(() => new Set(cycleLogs.map(log => log.date)), [cycleLogs]);
  const selectedCycleLog = useMemo(() => cycleLogs.find(log => log.date === selectedDate), [cycleLogs, selectedDate]);

  const selectCycleDate = (key: string) => {
    setSelectedDate(key);
    const log = cycleLogs.find(item => item.date === key);
    setPeriodPain(log?.pain || 0);
    setPeriodFlow(log?.flow || 'medium');
    setPeriodMood(log?.mood === 'happy' || log?.mood === 'low' ? log.mood : 'neutral');
    setPeriodNotes(log?.notes || '');
  };

  // 日程页和生理期页共用所选日；切到生理期或点选日期时，表单始终回显该日已存状态。
  useEffect(() => {
    if (tab !== 'cycle') return;
    const log = cycleLogs.find(item => item.date === selectedDate);
    setPeriodPain(log?.pain || 0);
    setPeriodFlow(log?.flow || 'medium');
    setPeriodMood(log?.mood === 'happy' || log?.mood === 'low' ? log.mood : 'neutral');
    setPeriodNotes(log?.notes || '');
  }, [cycleLogs, selectedDate, tab]);

  const saveEvent = async () => {
    if (!eventTitle.trim()) return addToast('请先填写事件名称', 'info');
    if (eventDueDate && eventDueDate < eventDate) return addToast('截至日期不能早于开始日期', 'info');
    if (eventReminderAt && new Date(eventReminderAt).getTime() <= Date.now()) return addToast('提醒时间需要晚于现在', 'info');
    const title = eventTitle.trim();
    const recordId = uid();
    let savedRecordId = recordId;

    if (linkedCharacterId && (eventType === 'TODO' || eventType === 'DEADLINE')) {
      const task: Task = {
        id: `task-${recordId}`, title, supervisorId: linkedCharacterId, tone: 'gentle', startDate: eventDate,
        deadline: eventDueDate || eventDate, reminderAt: eventReminderAt || undefined, isCompleted: false, createdAt: Date.now(),
      };
      savedRecordId = task.id;
      await DB.saveTask(task);
      setLegacyTasks(current => [task, ...current].sort((a, b) => b.createdAt - a.createdAt));
    } else if (linkedCharacterId && eventType === 'ANNIVERSARY') {
      const anniversary: Anniversary = { id: `anni-${uid()}`, title, date: eventDate, charId: linkedCharacterId };
      await DB.saveAnniversary(anniversary);
      setLegacyAnniversaries(current => [...current, anniversary].sort((a, b) => a.date.localeCompare(b.date)));
    } else {
      const event: CalendarEvent = { id: recordId, title, date: eventDate, dueDate: eventDueDate || undefined, reminderAt: eventReminderAt || undefined, type: eventType, description: eventDescription.trim(), isCompleted: false };
      await DB.saveCalendarEvent(event);
      setEvents(current => [...current, event].sort((a, b) => a.date.localeCompare(b.date)));
    }

    if (eventReminderAt) {
      try {
        let permission = await LocalNotifications.checkPermissions();
        if (permission.display === 'prompt') permission = await LocalNotifications.requestPermissions();
        if (permission.display === 'granted') {
          await LocalNotifications.schedule({ notifications: [{ id: notificationId(savedRecordId), title: '全能日历提醒', body: title, schedule: { at: new Date(eventReminderAt) }, smallIcon: 'ic_stat_icon_config_sample' }] });
        } else addToast('日程已保存；通知权限未开启，提醒不会弹出', 'info');
      } catch (error) {
        console.warn('[OmniCalendar] reminder schedule failed', error);
        addToast('日程已保存，但提醒设置失败', 'info');
      }
    }

    setSelectedDate(eventDate);
    setEventTitle(''); setEventDescription(''); setEventDueDate(''); setEventReminderAt(''); setEventType('TODO'); setLinkedCharacterId(''); setShowEventForm(false);
    addToast('日程已添加', 'success');
  };

  const generateTaskReward = async (task: Task) => {
    const supervisor = characters.find(character => character.id === task.supervisorId);
    if (!supervisor || !apiConfig.apiKey) {
      addToast('任务已完成', 'success');
      return;
    }

    addToast(`${supervisor.name} 正在确认你的成果...`, 'info');
    try {
      await injectMemoryPalace(supervisor, undefined, task.title);
      const baseContext = ContextBuilder.buildCoreContext(supervisor, userProfile);
      const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiConfig.apiKey}` },
        body: JSON.stringify({
          model: apiConfig.model,
          messages: [
            { role: 'system', content: baseContext },
            { role: 'user', content: `用户（${userProfile.name}）刚刚完成了任务：“${task.title}”。你是其监督人，请依照自己的人设用用户常用语言只回复一句简短评价，不要加引号。` },
          ],
          temperature: 0.9,
          max_tokens: 8000,
        }),
      });
      if (!response.ok) throw new Error(`API Error ${response.status}`);
      const data = await safeResponseJson(response);
      const reply = data.choices?.[0]?.message?.content?.trim().replace(/^["']|["']$/g, '');
      if (!reply) return addToast('任务完成（角色暂时没有留下评价）', 'success');
      addToast(`${supervisor.name}: ${reply}`, 'success');
      await DB.saveMessage({
        charId: supervisor.id, role: 'system', type: 'text',
        content: `[系统: ${userProfile.name} 完成了任务 “${task.title}”。${supervisor.name} 评价道: “${reply}”]`,
      });
    } catch (error) {
      console.error('Task reward error', error);
      addToast('任务已完成，但角色评价生成失败', 'error');
    }
  };

  const toggleEntry = async (entry: ScheduleEntry) => {
    if (entry.source === 'anniversary' || entry.type === 'MENSTRUATION') return;
    if (entry.source === 'calendar') {
      const event = entry.record as CalendarEvent;
      const updated = { ...event, isCompleted: true, archivedAt: Date.now() };
      await DB.saveCalendarEvent(updated);
      setEvents(current => current.map(item => item.id === event.id ? updated : item));
    } else {
      const task = entry.record as Task;
      const updated = { ...task, isCompleted: true, completedAt: Date.now(), archivedAt: Date.now() };
      await DB.saveTask(updated);
      setLegacyTasks(current => current.map(item => item.id === task.id ? updated : item));
      await generateTaskReward(updated);
    }
    void unlockAchievement({ key: `calendar:${entry.record.id}`, title: entry.type === 'ANNIVERSARY' ? '值得记住的日子' : '一步一步完成', description: `完成了「${entry.title}」。`, coreItem: 'a luminous glass star trophy', notify: message => addToast(message, 'success') });
    try { await LocalNotifications.cancel({ notifications: [{ id: notificationId((entry.record as CalendarEvent | Task).id) }] }); } catch { /* web / no scheduled reminder */ }
    addToast('已完成并移入归档箱', 'success');
  };

  const restoreEntry = async (entry: ScheduleEntry) => {
    if (entry.source === 'calendar') {
      const event = entry.record as CalendarEvent;
      const updated = { ...event, isCompleted: false, archivedAt: undefined };
      await DB.saveCalendarEvent(updated);
      setEvents(current => current.map(item => item.id === event.id ? updated : item));
    } else if (entry.source === 'task') {
      const task = entry.record as Task;
      const updated = { ...task, isCompleted: false, completedAt: undefined, archivedAt: undefined };
      await DB.saveTask(updated);
      setLegacyTasks(current => current.map(item => item.id === task.id ? updated : item));
    }
    addToast('日程已恢复', 'success');
  };

  const removeEntry = async (entry: ScheduleEntry) => {
    if (entry.source === 'calendar') {
      const event = entry.record as CalendarEvent;
      await DB.deleteCalendarEvent(event.id);
      setEvents(current => current.filter(item => item.id !== event.id));
    } else if (entry.source === 'task') {
      const task = entry.record as Task;
      await DB.deleteTask(task.id);
      setLegacyTasks(current => current.filter(item => item.id !== task.id));
    } else {
      const anniversary = entry.record as Anniversary;
      await DB.deleteAnniversary(anniversary.id);
      setLegacyAnniversaries(current => current.filter(item => item.id !== anniversary.id));
    }
  };

  const saveCycle = async () => {
    if (!lastPeriodDate || averageCycleDays < 15 || averageCycleDays > 60) return addToast('请填写合理的上次日期和周期天数', 'info');
    const nextCycle: MenstrualCycle = { id: 'main', lastPeriodDate, averageCycleDays, periods, logs: cycleLogs };
    await DB.saveMenstrualCycle(nextCycle);
    setCycle(nextCycle);
    addToast('周期设置已保存', 'success');
  };

  const savePeriodRecord = async () => {
    if (!lastPeriodDate) return addToast('请先填写经期开始日期', 'info');
    const record: MenstrualPeriodRecord = { id: `period-${lastPeriodDate}`, startDate: lastPeriodDate, endDate: periodEndDate || undefined, notes: periodNotes.trim() || undefined };
    const nextPeriods = [...periods.filter(item => item.id !== record.id), record].sort((a, b) => a.startDate.localeCompare(b.startDate));
    const nextLogs = periodPain || periodFlow !== 'medium' || periodMood !== 'neutral' || periodNotes.trim()
      ? [...cycleLogs.filter(item => item.date !== lastPeriodDate), { date: lastPeriodDate, pain: periodPain || undefined, flow: periodFlow, mood: periodMood, notes: periodNotes.trim() || undefined }]
      : cycleLogs;
    const nextCycle: MenstrualCycle = { id: 'main', lastPeriodDate, averageCycleDays: calculatedCycleDays({ id: 'main', lastPeriodDate, averageCycleDays, periods: nextPeriods, logs: nextLogs }), periods: nextPeriods, logs: nextLogs };
    await DB.saveMenstrualCycle(nextCycle);
    setCycle(nextCycle); setPeriods(nextPeriods); setCycleLogs(nextLogs); setAverageCycleDays(nextCycle.averageCycleDays);
    addToast('本次经期记录已保存', 'success');
  };

  const saveDailyLog = async () => {
    if (!selectedDate) return;
    const log: MenstrualDailyLog = { date: selectedDate, pain: periodPain || undefined, flow: periodFlow, mood: periodMood, notes: periodNotes.trim() || undefined };
    const nextLogs = [...cycleLogs.filter(item => item.date !== selectedDate), log].sort((a, b) => a.date.localeCompare(b.date));
    const nextCycle: MenstrualCycle = { id: 'main', lastPeriodDate: lastPeriodDate || selectedDate, averageCycleDays, periods, logs: nextLogs };
    await DB.saveMenstrualCycle(nextCycle);
    setCycle(nextCycle); setCycleLogs(nextLogs); addToast('当天身体记录已保存', 'success');
  };

  const markPeriodStart = async () => {
    const record: MenstrualPeriodRecord = { id: `period-${selectedDate}`, startDate: selectedDate };
    const nextPeriods = [...periods.filter(item => item.startDate !== selectedDate), record].sort((a, b) => a.startDate.localeCompare(b.startDate));
    const nextCycle: MenstrualCycle = { id: 'main', lastPeriodDate: selectedDate, averageCycleDays: calculatedCycleDays({ id: 'main', lastPeriodDate: selectedDate, averageCycleDays, periods: nextPeriods, logs: cycleLogs }), periods: nextPeriods, logs: cycleLogs };
    await DB.saveMenstrualCycle(nextCycle);
    setLastPeriodDate(selectedDate); setPeriods(nextPeriods); setCycle(nextCycle); setAverageCycleDays(nextCycle.averageCycleDays);
    addToast(`${formatDate(selectedDate)} 已标记为经期开始`, 'success');
  };

  const markPeriodEnd = async () => {
    const openPeriod = periods.slice().reverse().find(item => !item.endDate && item.startDate <= selectedDate);
    if (!openPeriod) return addToast('请先选择并标记本次经期开始日', 'info');
    const nextPeriods = periods.map(item => item.id === openPeriod.id ? { ...item, endDate: selectedDate } : item);
    const nextCycle: MenstrualCycle = { id: 'main', lastPeriodDate: cycle?.lastPeriodDate || openPeriod.startDate, averageCycleDays, periods: nextPeriods, logs: cycleLogs };
    await DB.saveMenstrualCycle(nextCycle);
    setPeriods(nextPeriods); setCycle(nextCycle); setPeriodEndDate(selectedDate);
    addToast(`${formatDate(selectedDate)} 已标记为经期结束`, 'success');
  };

  const shiftMonth = (amount: number) => setMonthCursor(current => new Date(current.getFullYear(), current.getMonth() + amount, 1));

  return (
    <main className="relative h-full min-h-0 overflow-y-auto bg-[#eff6ff] px-4 pb-8 pt-4 text-slate-700">
      <div className="pointer-events-none absolute -left-20 top-8 h-48 w-48 rounded-full bg-sky-300/35 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 top-72 h-56 w-56 rounded-full bg-violet-300/30 blur-3xl" />
      <div className="relative mx-auto max-w-2xl">
        <header className="mb-5 flex items-center justify-between">
          <IconButton label="返回桌面" onClick={closeApp} className="bg-white/65 text-slate-600 shadow-sm ring-1 ring-white/80 backdrop-blur-xl"><ArrowLeft size={19} weight="bold" /></IconButton>
          <div className="text-center"><h1 className="text-lg font-bold tracking-tight text-slate-800">全能日历</h1><p className="mt-0.5 text-[11px] text-slate-500">OmniCalendar · 把重要的日子留在身边</p></div>
          <div className="flex items-center gap-2"><IconButton label="打开归档箱" onClick={() => setShowArchive(value => !value)} className={`${showArchive ? 'bg-sky-100 text-sky-700' : 'bg-white/65 text-slate-500'} shadow-sm ring-1 ring-white/80 backdrop-blur-xl`}><Archive size={17} weight={showArchive ? 'fill' : 'regular'} /></IconButton><div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/65 text-sky-600 shadow-sm ring-1 ring-white/80 backdrop-blur-xl"><CalendarBlank size={19} weight="fill" /></div></div>
        </header>

        <nav className="mb-5 grid grid-cols-2 rounded-2xl border border-white/80 bg-white/55 p-1 shadow-sm backdrop-blur-xl">
          {([{ id: 'schedule', label: '日程' }] as { id: Tab; label: string }[]).map(item => (
            <button key={item.id} onClick={() => setTab(item.id)} className={`rounded-xl px-2 py-2 text-xs font-semibold transition ${tab === item.id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{item.label}</button>
          ))}
        </nav>

        {tab === 'schedule' && <section className="space-y-4">
          <div className="rounded-[24px] border border-white/80 bg-white/60 p-3 shadow-xl shadow-sky-900/5 backdrop-blur-xl">
            <div className="mb-2 flex items-center justify-between"><IconButton label="上个月" onClick={() => shiftMonth(-1)} className="bg-slate-100/80 text-slate-500"><CaretLeft size={17} weight="bold" /></IconButton><h2 className="text-sm font-bold text-slate-800">{monthTitle(monthCursor)}</h2><IconButton label="下个月" onClick={() => shiftMonth(1)} className="bg-slate-100/80 text-slate-500"><CaretRight size={17} weight="bold" /></IconButton></div>
            <div className="mb-1 grid grid-cols-7 text-center text-[10px] font-medium text-slate-400">{['日', '一', '二', '三', '四', '五', '六'].map(day => <span key={day}>{day}</span>)}</div>
            <div className="grid grid-cols-7 gap-0.5">{calendarDays.map((day, index) => {
              if (!day) return <div key={`blank-${index}`} className="h-8" />;
              const key = dateKey(day); const dayEvents = entriesByDate.get(key) || []; const isSelected = key === selectedDate; const isToday = key === todayKey();
              return <button key={key} onClick={() => setSelectedDate(key)} className={`relative flex h-8 flex-col items-center justify-center rounded-lg text-xs transition ${isSelected ? 'bg-slate-800 text-white shadow-md shadow-slate-400/30' : isToday ? 'bg-sky-100 text-sky-700' : 'text-slate-600 hover:bg-white'}`}>
                <span>{day.getDate()}</span><span className="mt-0.5 flex h-1 gap-0.5">{dayEvents.slice(0, 3).map(entry => <i key={entry.key} className={`h-1 w-1 rounded-full ${isSelected ? 'bg-white' : TYPE_META[entry.type].dot}`} />)}</span>
              </button>;
            })}</div>
            <SelectedScheduleList date={selectedDate} entries={eventsForSelectedDate} onAdd={() => { setEventDate(selectedDate); setShowEventForm(true); }} onToggle={entry => void toggleEntry(entry)} onRemove={entry => void removeEntry(entry)} />
          </div>

          {false && <div className="rounded-[24px] border border-white/80 bg-white/60 p-4 shadow-xl shadow-sky-900/5 backdrop-blur-xl">
            <div className="mb-3 flex items-center justify-between"><div><h2 className="text-sm font-bold text-slate-800">{formatDate(selectedDate)}</h2><p className="mt-0.5 text-[11px] text-slate-400">{eventsForSelectedDate.length ? `${eventsForSelectedDate.length} 项安排` : '留一点空白给今天'}</p></div><IconButton label="添加日程" onClick={() => { setEventDate(selectedDate); setShowEventForm(true); }} className="bg-slate-800 text-white shadow-lg shadow-slate-400/30"><Plus size={18} weight="bold" /></IconButton></div>
            <div className="space-y-2">{eventsForSelectedDate.map(entry => {
              const canComplete = entry.type === 'TODO' || entry.type === 'DEADLINE';
              return <div key={entry.key} className="flex items-center gap-3 rounded-2xl bg-white/75 p-3 ring-1 ring-slate-100">
                {canComplete ? <button aria-label={entry.isCompleted ? '标记未完成' : '标记完成'} onClick={() => void toggleEntry(entry)} className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${entry.isCompleted ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white'}`}>{entry.isCompleted && <Check size={13} weight="bold" />}</button> : <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${TYPE_META[entry.type].dot}`} />}
                <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-700">{entry.title}</p>{entry.description && <p className="mt-0.5 truncate text-[11px] text-slate-400">{entry.description}</p>}<div className="mt-1 flex flex-wrap gap-x-2 text-[9px] text-slate-400">{entry.dueDate && <span>截至 {formatDate(entry.dueDate)}</span>}{entry.reminderAt && <span className="inline-flex items-center gap-0.5"><Bell size={10} />{new Date(entry.reminderAt).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}</div></div>
                <span className={`rounded-full border px-2 py-1 text-[9px] font-bold ${TYPE_META[entry.type].chip}`}>{TYPE_META[entry.type].label}</span>
                <button aria-label="删除日程" onClick={() => void removeEntry(entry)} className="text-slate-300 hover:text-rose-500"><Trash size={15} /></button>
              </div>;
            })}{!eventsForSelectedDate.length && <p className="rounded-2xl bg-white/45 py-5 text-center text-xs text-slate-400">还没有安排，给这一天留下一件小事吧。</p>}</div>
          </div>}

          {showArchive && <div className="fixed inset-0 z-40 overflow-y-auto bg-[#eff6ff] px-4 pb-8 pt-4"><div className="mx-auto max-w-2xl"><header className="mb-5 flex items-center justify-between"><IconButton label="返回日历" onClick={() => setShowArchive(false)} className="bg-white/65 text-slate-600 shadow-sm ring-1 ring-white/80"><ArrowLeft size={19} weight="bold" /></IconButton><div className="text-center"><h2 className="text-lg font-bold text-slate-800">归档箱</h2><p className="mt-0.5 text-[11px] text-slate-500">完成的日程会自动来到这里</p></div><div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/65 text-sky-600 shadow-sm ring-1 ring-white/80"><Archive size={18} weight="fill" /></div></header><div className="space-y-2">{archivedEntries.map(entry => <div key={entry.key} className="flex items-center gap-3 rounded-2xl bg-white/80 p-3 ring-1 ring-slate-100"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-50 text-emerald-500"><Check size={13} weight="bold" /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-500 line-through">{entry.title}</p><p className="mt-0.5 text-[9px] text-slate-400">完成于 {new Date(entry.archivedAt || 0).toLocaleString()}</p></div><button aria-label="恢复日程" title="恢复" onClick={() => void restoreEntry(entry)} className="rounded-full p-2 text-sky-500 hover:bg-sky-50"><ArrowCounterClockwise size={16} /></button><button aria-label="永久删除日程" title="删除" onClick={() => void removeEntry(entry)} className="rounded-full p-2 text-slate-300 hover:bg-rose-50 hover:text-rose-500"><Trash size={16} /></button></div>)}{archivedEntries.length === 0 && <p className="rounded-2xl bg-white/45 py-5 text-center text-xs text-slate-400">还没有已完成的日程。</p>}</div></div></div>}

          {inboxTasks.length > 0 && <div className="rounded-[24px] border border-white/80 bg-white/60 p-4 shadow-xl shadow-sky-900/5 backdrop-blur-xl">
            <div className="mb-3"><h2 className="text-sm font-bold text-slate-800">未设日期的角色待办</h2><p className="mt-0.5 text-[11px] text-slate-400">从旧时光契约保留下来的任务</p></div>
            <div className="space-y-2">{inboxTasks.map(task => {
              const entry: ScheduleEntry = { key: `task:${task.id}`, source: 'task', title: task.title, date: '', type: 'TODO', description: `角色监督：${characterNames.get(task.supervisorId) || '未知角色'}`, isCompleted: task.isCompleted, record: task };
              return <div key={entry.key} className="flex items-center gap-3 rounded-2xl bg-white/75 p-3 ring-1 ring-slate-100"><button aria-label={entry.isCompleted ? '标记未完成' : '标记完成'} onClick={() => void toggleEntry(entry)} className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${entry.isCompleted ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white'}`}>{entry.isCompleted && <Check size={13} weight="bold" />}</button><div className="min-w-0 flex-1"><p className={`truncate text-xs font-semibold ${entry.isCompleted ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{entry.title}</p><p className="mt-0.5 truncate text-[11px] text-slate-400">{entry.description}</p></div><button aria-label="删除日程" onClick={() => void removeEntry(entry)} className="text-slate-300 hover:text-rose-500"><Trash size={15} /></button></div>;
            })}</div>
          </div>}
        </section>}

        {false && <section className="space-y-4">
          <div className="overflow-hidden rounded-[28px] border border-white bg-white/90 shadow-xl shadow-pink-900/5">
            <div className="px-5 pb-4 pt-5"><p className="text-2xl font-black tracking-tight text-slate-900">今日</p><p className="mt-1 text-sm text-slate-400">{currentCycleDay ? `处于月经期第 ${currentCycleDay} 天` : daysUntilNextPeriod != null ? `预计 ${daysUntilNextPeriod} 天后来月经` : '记录一次经期，开启智能预测'}</p></div>
            <div className="mx-5 border-t border-slate-100" />
            <div className="grid grid-cols-2 gap-y-3 px-5 py-4 text-[11px] text-slate-500 sm:grid-cols-4"><span className="flex items-center gap-2"><i className="h-3 w-3 rounded-full bg-pink-500" />经期</span><span className="flex items-center gap-2"><i className="h-3 w-3 rounded-full bg-[repeating-linear-gradient(135deg,#f9a8d4_0_2px,#fce7f3_2px_4px)]" />预测经期</span><span className="flex items-center gap-2"><i className="h-3 w-3 rounded-full bg-violet-400" />排卵日</span><span className="flex items-center gap-2"><i className="h-3 w-3 rounded-full bg-cyan-300" />易孕期</span></div>
            <div className="flex items-center justify-between px-5 pb-3"><IconButton label="上个月" onClick={() => shiftMonth(-1)} className="text-slate-400 hover:bg-slate-50"><CaretLeft size={17} /></IconButton><h2 className="text-sm font-bold text-slate-800">{monthTitle(monthCursor)}</h2><IconButton label="下个月" onClick={() => shiftMonth(1)} className="text-slate-400 hover:bg-slate-50"><CaretRight size={17} /></IconButton></div>
            <div className="grid grid-cols-7 px-4 text-center text-[10px] font-semibold text-slate-500">{['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map(day => <span key={day}>{day}</span>)}</div>
            <div className="grid grid-cols-7 gap-y-2 px-4 py-3">{cycleCalendarDays.map((day, index) => {
              if (!day) return <div key={`cycle-blank-${index}`} className="aspect-square" />;
              const key = dateKey(day); const selected = key === selectedDate; const recorded = recordedPeriodDays.has(key); const predicted = predictedPeriodDays.has(key); const ovulation = ovulationDays.has(key); const fertile = fertileDays.has(key); const hasLog = cycleLogDates.has(key);
              return <button key={key} onClick={() => selectCycleDate(key)} aria-label={`查看 ${key} 的身体状态${hasLog ? '，已有记录' : ''}`} className={`relative mx-auto flex aspect-square w-9 items-center justify-center rounded-full text-xs font-semibold transition ${recorded ? 'bg-pink-500 text-white' : predicted ? 'bg-[repeating-linear-gradient(135deg,#f9a8d4_0_3px,#fce7f3_3px_6px)] text-pink-700' : ovulation ? 'bg-violet-400 text-white' : fertile ? 'bg-cyan-100 text-cyan-700' : 'text-slate-700 hover:bg-slate-50'} ${selected ? 'ring-2 ring-slate-800 ring-offset-2' : ''}`}>{day.getDate()}{hasLog && <i className={`absolute bottom-0.5 h-1 w-1 rounded-full ${selected ? 'bg-white' : 'bg-slate-700'}`} />}</button>;
            })}</div>
            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4"><div><p className="text-sm font-bold text-slate-900">记录经期</p><p className="mt-0.5 text-[10px] text-slate-400">当前选择：{formatDate(selectedDate)}</p></div>{currentPeriod && !currentPeriod.endDate ? <button onClick={() => void markPeriodEnd()} className="rounded-full bg-pink-50 px-4 py-2 text-xs font-bold text-pink-600">标记结束</button> : <button onClick={() => void markPeriodStart()} className="rounded-full bg-pink-500 px-4 py-2 text-xs font-bold text-white">标记开始</button>}</div>
          </div>

          <div className="rounded-[24px] border border-white bg-white/90 p-4 shadow-xl shadow-pink-900/5"><div className="mb-3 flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-pink-500 text-white"><CalendarBlank size={17} weight="fill" /></span><div className="min-w-0 flex-1"><h2 className="text-base font-black text-slate-900">症状</h2><p className="text-[11px] text-slate-400">{formatDate(selectedDate)} · {selectedCycleLog ? '已载入当天记录' : '尚未记录'}</p></div>{selectedCycleLog && <span className="rounded-full bg-pink-50 px-2 py-1 text-[10px] font-bold text-pink-600">已记录</span>}</div><div className="border-t border-slate-100 pt-3">
            <div className="mb-3 grid grid-cols-[48px_1fr] items-center gap-2"><p className="text-xs font-bold text-slate-800">疼痛</p><div className="grid grid-cols-3 gap-1.5">{([{ value: 0, label: '无', icon: <Minus size={15} /> }, { value: 5, label: '明显', icon: <Lightning size={15} weight="fill" /> }, { value: 9, label: '剧烈', icon: <Lightning size={17} weight="fill" /> }] as const).map(option => <button key={option.value} onClick={() => setPeriodPain(option.value)} className={`flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[9px] font-semibold transition ${periodPain === option.value ? 'bg-pink-500 text-white shadow-sm shadow-pink-200' : 'bg-slate-50 text-slate-400'}`}>{option.icon}{option.label}</button>)}</div></div>
            <div className="mb-3 grid grid-cols-[48px_1fr] items-center gap-2"><p className="text-xs font-bold text-slate-800">血量</p><div className="grid grid-cols-3 gap-1.5">{([{ value: 'light', label: '少量', count: 1 }, { value: 'medium', label: '中等', count: 2 }, { value: 'heavy', label: '较多', count: 3 }] as const).map(option => <button key={option.value} onClick={() => setPeriodFlow(option.value)} className={`flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[9px] font-semibold transition ${periodFlow === option.value ? 'bg-pink-500 text-white shadow-sm shadow-pink-200' : 'bg-slate-50 text-slate-400'}`}><span className="flex">{Array.from({ length: option.count }, (_, index) => <Drop key={index} size={12} weight="fill" />)}</span>{option.label}</button>)}</div></div>
            <div className="grid grid-cols-[48px_1fr] items-center gap-2"><p className="text-xs font-bold text-slate-800">心情</p><div className="grid grid-cols-3 gap-1.5">{([{ value: 'happy', label: '不错', icon: <Smiley size={17} /> }, { value: 'neutral', label: '一般', icon: <SmileyMeh size={17} /> }, { value: 'low', label: '低落', icon: <SmileySad size={17} /> }] as const).map(option => <button key={option.value} onClick={() => setPeriodMood(option.value)} className={`flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[9px] font-semibold transition ${periodMood === option.value ? 'bg-pink-500 text-white shadow-sm shadow-pink-200' : 'bg-slate-50 text-slate-400'}`}>{option.icon}{option.label}</button>)}</div></div>
            <textarea value={periodNotes} onChange={event => setPeriodNotes(event.target.value)} placeholder="其他感受或备注（可选）" rows={2} className="mt-3 w-full resize-none rounded-xl border-0 bg-slate-50 px-3 py-2 text-xs text-slate-700 outline-none ring-pink-200 focus:ring-2" /><button onClick={() => void saveDailyLog()} className="mt-2 w-full rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white">保存当天状态</button>
          </div></div>

          <div className="rounded-[24px] border border-white/80 bg-white/70 p-4 shadow-lg shadow-pink-900/5"><div className="flex items-center justify-between"><div><h2 className="text-sm font-bold text-slate-800">智能测算</h2><p className="mt-1 text-[10px] text-slate-400">最近真实周期加权平均 {calculatedCycleDays(cycle)} 天，预测经期按 5 天显示</p></div><label className="text-[10px] text-slate-400">备用周期<input type="number" min="15" max="60" value={averageCycleDays} onChange={event => setAverageCycleDays(Number(event.target.value))} onBlur={() => void saveCycle()} className="ml-2 w-14 rounded-lg bg-white px-2 py-1.5 text-center text-xs text-slate-700 outline-none" /></label></div>{nextPredictedStart && <p className="mt-3 rounded-2xl bg-pink-50 px-3 py-2 text-xs font-medium text-pink-600">下次预计：{formatDate(nextPredictedStart)}</p>}</div>
        </section>}

      </div>

      {showEventForm && <div className="fixed inset-0 z-30 flex items-end bg-slate-900/20 p-3 backdrop-blur-sm sm:items-center sm:justify-center"><div className="w-full max-w-md rounded-[26px] border border-white/80 bg-[#f8fbff]/95 p-5 shadow-2xl"><div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-bold text-slate-800">添加日程</h2><IconButton label="关闭" onClick={() => setShowEventForm(false)} className="bg-slate-100 text-slate-500"><X size={16} weight="bold" /></IconButton></div><div className="space-y-3"><input autoFocus value={eventTitle} onChange={event => setEventTitle(event.target.value)} placeholder="事件名称" className="w-full rounded-xl border border-white bg-white px-3 py-2.5 text-xs outline-none ring-sky-200 focus:ring-2" /><div className="grid grid-cols-2 gap-2"><label className="text-[10px] text-slate-400">开始日期<input type="date" value={eventDate} onChange={event => setEventDate(event.target.value)} className="mt-1 w-full rounded-xl border border-white bg-white px-3 py-2.5 text-xs outline-none" /></label><select value={eventType} onChange={event => { setEventType(event.target.value as CalendarEventType); setLinkedCharacterId(''); }} className="mt-4 rounded-xl border border-white bg-white px-3 py-2.5 text-xs outline-none">{Object.entries(TYPE_META).map(([type, meta]) => <option key={type} value={type}>{meta.label}</option>)}</select></div><div className="grid grid-cols-2 gap-2"><label className="text-[10px] text-slate-400">截至日期（可选）<input type="date" value={eventDueDate} min={eventDate} onChange={event => setEventDueDate(event.target.value)} className="mt-1 w-full rounded-xl border border-white bg-white px-3 py-2.5 text-xs outline-none" /></label><label className="text-[10px] text-slate-400">提醒时间（可选）<input type="datetime-local" value={eventReminderAt} onChange={event => setEventReminderAt(event.target.value)} className="mt-1 w-full rounded-xl border border-white bg-white px-3 py-2.5 text-xs outline-none" /></label></div>{eventType !== 'MENSTRUATION' && <label className="block text-[11px] font-medium text-slate-500">关联角色（可选）<select value={linkedCharacterId} onChange={event => setLinkedCharacterId(event.target.value)} className="mt-1.5 w-full rounded-xl border border-white bg-white px-3 py-2.5 text-xs text-slate-700 outline-none"><option value="">普通日程</option>{characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}</select><span className="mt-1 block font-normal leading-relaxed text-slate-400">待办／Deadline 会成为角色监督任务；纪念日会关联至该角色。</span></label>}<textarea value={eventDescription} onChange={event => setEventDescription(event.target.value)} placeholder="备注（可选）" rows={3} className="w-full resize-none rounded-xl border border-white bg-white px-3 py-2.5 text-xs outline-none ring-sky-200 focus:ring-2" /><button onClick={() => void saveEvent()} className="w-full rounded-xl bg-slate-800 py-3 text-xs font-bold text-white">添加到日历</button></div></div></div>}

    </main>
  );
};

export default OmniCalendarApp;
