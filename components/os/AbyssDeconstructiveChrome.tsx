import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpenText,
  CalendarDots,
  ChatCircleDots,
  GearSix,
  HandTap,
  HourglassHigh,
  TShirt,
  Waves,
} from '@phosphor-icons/react';
import { AppID, type CalendarEvent, type CharacterProfile, type ScheduleSlot } from '../../types';
import { getLocalDateKey, msUntilNextLocalDay } from '../../utils/localDate';
import './AbyssDeconstructiveChrome.css';

type Props = {
  character: CharacterProfile;
  currentScheduleSlot: ScheduleSlot | null;
  calendarEvents: CalendarEvent[];
  hours: number;
  minutes: number;
  openApp: (id: AppID) => void;
  openCharacterSchedule: () => void;
  openWardrobe: () => void;
  openTouchSettings: () => void;
  openAllApps: () => void;
};

const AbyssDeconstructiveChrome: React.FC<Props> = ({
  character,
  currentScheduleSlot,
  calendarEvents,
  hours,
  minutes,
  openApp,
  openWardrobe,
  openTouchSettings,
  openAllApps,
}) => {
  const [todayKey, setTodayKey] = useState(() => getLocalDateKey());
  useEffect(() => {
    let timer: number | undefined;
    const scheduleNextDayRefresh = () => {
      timer = window.setTimeout(() => {
        setTodayKey(getLocalDateKey());
        scheduleNextDayRefresh();
      }, msUntilNextLocalDay());
    };
    scheduleNextDayRefresh();
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  const weekdays = useMemo(() => {
    const now = new Date();
    const mondayOffset = (now.getDay() + 6) % 7;
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(now);
      date.setDate(now.getDate() - mondayOffset + index);
      const dateKey = getLocalDateKey(date);
      return { day: ['一', '二', '三', '四', '五', '六', '日'][index], date: date.getDate(), active: dateKey === todayKey };
    });
  }, [todayKey]);

  const [calendarIndex, setCalendarIndex] = useState(0);
  const calendarSignature = calendarEvents.map(event => `${event.id}:${event.date}:${event.title}`).join('|');
  useEffect(() => {
    setCalendarIndex(0);
  }, [calendarSignature]);
  useEffect(() => {
    if (calendarEvents.length <= 1) return;
    const timer = window.setInterval(() => {
      setCalendarIndex(index => (index + 1) % calendarEvents.length);
    }, 7000);
    return () => window.clearInterval(timer);
  }, [calendarEvents.length]);

  const calendarEvent = calendarEvents[calendarIndex] || null;

  const tools = [
    { id: 'touch', label: '触摸', en: 'TOUCH', Icon: HandTap, action: openTouchSettings },
    { id: 'wardrobe', label: '衣橱', en: 'WARDROBE', Icon: TShirt, action: openWardrobe },
    { id: 'scene', label: '舞台', en: 'SCENE', Icon: Waves, action: () => openApp(AppID.Appearance) },
  ];
  const dock = [
    { id: 'chat', label: '对话', Icon: ChatCircleDots, action: () => openApp(AppID.Chat) },
    { id: 'study', label: '自习室', Icon: BookOpenText, action: () => openApp(AppID.Study) },
    { id: 'all', label: '星盘', Icon: Waves, action: openAllApps, primary: true },
    { id: 'focus', label: '番茄钟', Icon: HourglassHigh, action: () => openApp(AppID.FocusCompanion) },
    { id: 'settings', label: '设置', Icon: GearSix, action: () => openApp(AppID.Settings) },
  ];

  return (
    <div className="abyss-deconstructive pointer-events-none absolute inset-0 z-30" data-testid="companion-abyss-deconstructive">
      <header className="abyss-deconstructive-header pointer-events-auto">
        <div className="abyss-deconstructive-brand">
          <span className="abyss-deconstructive-brand-mark" aria-hidden><i /><i /><i /></span>
          <span className="abyss-deconstructive-brand-copy">
            <strong>ABYSSAL / WEEK</strong>
            <small>{String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')} · {character.name}</small>
          </span>
        </div>
        <div className="abyss-deconstructive-days" aria-label="本周日程">
          {weekdays.map(item => (
            <button type="button" key={item.day} onClick={() => openApp(AppID.Calendar)} className={item.active ? 'is-today' : ''} aria-label={`打开全能日历并查看星期${item.day}`}>
              <small>{item.day}</small>
              <strong>{item.date}</strong>
            </button>
          ))}
        </div>
      </header>

      <button type="button" className="abyss-deconstructive-route pointer-events-auto" onClick={() => openApp(AppID.Calendar)} aria-label="打开全能日历查看日程">
        <span><CalendarDots weight="bold" /> OMNI CALENDAR <i>SYNCED</i></span>
        <span className="abyss-deconstructive-route-copy" key={calendarEvent?.id || 'schedule-fallback'}>
          <strong>{calendarEvent?.title || currentScheduleSlot?.activity || '尚未安排行程'}</strong>
          <small>{calendarEvent ? `${calendarEvent.date}${calendarEvent.description ? ` · ${calendarEvent.description}` : ''}` : currentScheduleSlot ? `${currentScheduleSlot.startTime}${currentScheduleSlot.location ? ` · ${currentScheduleSlot.location}` : ''}` : `为 ${character.name} 打开今日安排`}</small>
        </span>
        <em aria-hidden>{calendarEvents.length > 1 ? `${calendarIndex + 1}`.padStart(2, '0') : '01'}</em>
      </button>

      <aside className="abyss-deconstructive-rail pointer-events-auto" aria-label="深海舞台工具">
        {tools.map(({ id, label, en, Icon, action }) => (
          <button type="button" key={id} onClick={action} data-companion-wardrobe-trigger={id === 'wardrobe' ? 'true' : undefined} aria-label={`${label} ${en}`}>
            <span className="abyss-deconstructive-orb"><Icon weight="bold" /></span>
            <span className="abyss-deconstructive-tool-label"><strong>{label}</strong><small>{en}</small></span>
          </button>
        ))}
      </aside>

      <nav className="abyss-deconstructive-dock pointer-events-auto" aria-label="深海舞台导航">
        {dock.map(({ id, label, Icon, action, primary }) => (
          <button type="button" key={id} className={primary ? 'is-primary' : ''} onClick={action} aria-label={label}>
            <span className="abyss-deconstructive-dock-light"><Icon weight="regular" /></span>
            <small>{label}</small>
          </button>
        ))}
      </nav>
    </div>
  );
};

export default AbyssDeconstructiveChrome;
