import React, { useMemo } from 'react';
import {
  BookOpenText,
  CalendarDots,
  ChatCircleDots,
  GearSix,
  HandTap,
  HourglassHigh,
  Sparkle,
  TShirt,
  Waves,
} from '@phosphor-icons/react';
import { AppID, type CharacterProfile, type ScheduleSlot } from '../../types';
import './AbyssCompanionChrome.css';

type AbyssCompanionChromeProps = {
  character: CharacterProfile;
  currentScheduleSlot: ScheduleSlot | null;
  hours: number;
  minutes: number;
  openApp: (id: AppID) => void;
  openCharacterSchedule: () => void;
  openWardrobe: () => void;
  openTouchSettings: () => void;
  openAllApps: () => void;
};

const AbyssCompanionChrome: React.FC<AbyssCompanionChromeProps> = ({
  character,
  currentScheduleSlot,
  hours,
  minutes,
  openApp,
  openCharacterSchedule,
  openWardrobe,
  openTouchSettings,
  openAllApps,
}) => {
  const weekdays = useMemo(() => {
    const now = new Date();
    const mondayOffset = (now.getDay() + 6) % 7;
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(now);
      date.setDate(now.getDate() - mondayOffset + index);
      return { day: ['一', '二', '三', '四', '五', '六', '日'][index], date: date.getDate(), active: index === mondayOffset };
    });
  }, []);

  const dock = [
    { id: 'chat', label: '对话', Icon: ChatCircleDots, action: () => openApp(AppID.Chat) },
    { id: 'study', label: '自习室', Icon: BookOpenText, action: () => openApp(AppID.Study) },
    { id: 'star', label: '星盘', Icon: Sparkle, action: openAllApps, primary: true },
    { id: 'focus', label: '番茄钟', Icon: HourglassHigh, action: () => openApp(AppID.FocusCompanion) },
    { id: 'settings', label: '设置', Icon: GearSix, action: () => openApp(AppID.Settings) },
  ];

  return (
    <div className="companion-abyss-chrome pointer-events-none absolute inset-0 z-30" data-testid="companion-abyss-chrome">
      <header className="abyss-weekbar pointer-events-auto" aria-label="本周日程">
        <div className="abyss-week-heading">
          <div className="abyss-week-title"><Waves weight="fill" /><span>ABYSSAL / WEEK</span></div>
          <small className="abyss-week-clock">{String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}</small>
        </div>
        <div className="abyss-week-days">
          {weekdays.map(item => <button type="button" key={item.day} onClick={openCharacterSchedule} className={item.active ? 'is-today' : ''} aria-label={`查看星期${item.day}日程`}><small>{item.day}</small><strong>{item.date}</strong><i aria-hidden /></button>)}
        </div>
      </header>

      <button type="button" className="abyss-schedule-card pointer-events-auto" onClick={openCharacterSchedule}>
        <span className="abyss-schedule-kicker"><CalendarDots weight="bold" /> <em>LIVE ROUTE</em><i>SYNCED</i></span>
        <strong>{currentScheduleSlot?.activity || '尚未安排行程'}</strong>
        <small>{currentScheduleSlot ? `${currentScheduleSlot.startTime}${currentScheduleSlot.location ? ` · ${currentScheduleSlot.location}` : ''}` : `为 ${character.name} 打开今日安排`}</small>
      </button>

      <aside className="abyss-tool-drawer pointer-events-auto" aria-label="深海舞台工具">
        <div className="abyss-tool-buttons">
          <button type="button" onClick={openTouchSettings}><HandTap weight="bold" /><span>触摸</span><small>TOUCH</small></button>
          <button type="button" onClick={openWardrobe} data-companion-wardrobe-trigger="true"><TShirt weight="bold" /><span>衣橱</span><small>WARDROBE</small></button>
          <button type="button" onClick={() => openApp(AppID.Appearance)}><Waves weight="bold" /><span>舞台</span><small>SCENE</small></button>
        </div>
      </aside>

      <nav className="abyss-bottom-dock pointer-events-auto" aria-label="深海舞台导航">
        {dock.map(({ id, label, Icon, action, primary }) => <button type="button" key={id} className={primary ? 'is-primary' : ''} onClick={action} aria-label={label}><span><Icon weight="regular" /></span><small>{label}</small></button>)}
      </nav>
    </div>
  );
};

export default AbyssCompanionChrome;
