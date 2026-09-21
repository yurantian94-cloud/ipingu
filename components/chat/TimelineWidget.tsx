import React, { useCallback, useEffect, useState } from 'react';
import { Heart, Plus, Trash, X } from '@phosphor-icons/react';
import type { TimelineMilestone } from '../../types';
import { DB } from '../../utils/db';

const TIMELINE_CHANGED_EVENT = 'sully:timeline-changed';

const dateKey = (date: Date) => {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const formatDate = (value: string) => {
    const [year, month, day] = value.split('-').map(Number);
    return Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)
        ? `${year}年${month}月${day}日`
        : value;
};

interface TimelineWidgetProps {
    open: boolean;
    onClose: () => void;
}

const TimelineWidget: React.FC<TimelineWidgetProps> = ({ open, onClose }) => {
    const [milestones, setMilestones] = useState<TimelineMilestone[]>([]);
    const [showForm, setShowForm] = useState(false);
    const [title, setTitle] = useState('');
    const [date, setDate] = useState(() => dateKey(new Date()));
    const [story, setStory] = useState('');

    const loadMilestones = useCallback(async () => {
        try {
            const loaded = await DB.getAllTimelineMilestones();
            setMilestones(loaded.sort((a, b) => b.date.localeCompare(a.date)));
        } catch (error) {
            console.warn('[TimelineWidget] failed to load milestones', error);
        }
    }, []);

    useEffect(() => {
        void loadMilestones();
        const refresh = () => void loadMilestones();
        window.addEventListener(TIMELINE_CHANGED_EVENT, refresh);
        const interval = window.setInterval(refresh, 10000);
        return () => {
            window.removeEventListener(TIMELINE_CHANGED_EVENT, refresh);
            window.clearInterval(interval);
        };
    }, [loadMilestones]);

    const saveMilestone = async () => {
        const cleanTitle = title.trim();
        if (!cleanTitle) return;
        const milestone: TimelineMilestone = {
            id: `timeline-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            title: cleanTitle,
            date: date || dateKey(new Date()),
            story: story.trim(),
            images: [],
        };
        await DB.saveTimelineMilestone(milestone);
        setMilestones(current => [milestone, ...current].sort((a, b) => b.date.localeCompare(a.date)));
        setTitle('');
        setStory('');
        setShowForm(false);
        window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT));
    };

    const removeMilestone = async (id: string) => {
        await DB.deleteTimelineMilestone(id);
        setMilestones(current => current.filter(item => item.id !== id));
        window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT));
    };

    if (!open) return null;

    return (
        <>
            <div className="fixed inset-0 z-[110] flex items-end bg-slate-900/20 p-3 backdrop-blur-sm sm:items-center sm:justify-center" onClick={onClose}>
                <section className="w-full max-w-md overflow-hidden rounded-[24px] border border-white/80 bg-[#fffafb]/95 shadow-2xl" onClick={event => event.stopPropagation()}>
                    <div className="flex items-center gap-3 border-b border-rose-100/80 px-5 py-4"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-rose-500"><Heart size={17} weight="fill" /></span><div className="min-w-0 flex-1"><h2 className="text-sm font-bold text-slate-800">恋爱时间线</h2><p className="text-[10px] text-slate-400">{milestones.length ? `已收藏 ${milestones.length} 段回忆` : '把一起经历的日子留在这里'}</p></div><button type="button" aria-label="关闭恋爱时间线" title="关闭" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500"><X size={15} weight="bold" /></button><button type="button" aria-label="添加时间线节点" title="添加时间线节点" onClick={() => setShowForm(true)} className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-white shadow-sm active:scale-95"><Plus size={16} weight="bold" /></button></div>
                    <div className="max-h-[55vh] space-y-1.5 overflow-y-auto p-4">
                    {milestones.map(milestone => <article key={milestone.id} className="flex items-start gap-2 rounded-xl bg-white/80 px-2.5 py-2 ring-1 ring-slate-100">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" />
                        <div className="min-w-0 flex-1"><p className="text-[10px] font-semibold text-rose-500">{formatDate(milestone.date)}</p><p className="truncate text-xs font-semibold text-slate-700">{milestone.title}</p>{milestone.story && <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-[10px] leading-relaxed text-slate-400">{milestone.story}</p>}</div>
                        <button type="button" aria-label={`删除时间线节点 ${milestone.title}`} title="删除" onClick={() => void removeMilestone(milestone.id)} className="shrink-0 p-1 text-slate-300 hover:text-rose-500"><Trash size={14} /></button>
                    </article>)}
                    {!milestones.length && <p className="rounded-xl bg-white/60 px-3 py-3 text-center text-[10px] text-slate-400">还没有收藏的回忆</p>}
                    </div>
                </section>
            </div>

            {showForm && <div className="fixed inset-0 z-[120] flex items-end bg-slate-900/20 p-3 backdrop-blur-sm sm:items-center sm:justify-center">
                <div className="w-full max-w-md rounded-[24px] border border-white/80 bg-[#fffafb]/95 p-5 shadow-2xl">
                    <div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-bold text-slate-800">添加时间线节点</h2><button type="button" aria-label="关闭" title="关闭" onClick={() => setShowForm(false)} className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500"><X size={15} weight="bold" /></button></div>
                    <div className="space-y-3"><input autoFocus value={title} onChange={event => setTitle(event.target.value)} placeholder="这一天发生了什么？" className="w-full rounded-xl border border-white bg-white px-3 py-2.5 text-xs outline-none ring-rose-200 focus:ring-2" /><input type="date" value={date} onChange={event => setDate(event.target.value)} className="w-full rounded-xl border border-white bg-white px-3 py-2.5 text-xs outline-none" /><textarea value={story} onChange={event => setStory(event.target.value)} placeholder="写下当时的故事（可选）" rows={3} className="w-full resize-none rounded-xl border border-white bg-white px-3 py-2.5 text-xs outline-none ring-rose-200 focus:ring-2" /><button type="button" onClick={() => void saveMilestone()} className="w-full rounded-xl bg-rose-500 py-3 text-xs font-bold text-white shadow-lg shadow-rose-200">收藏这段回忆</button></div>
                </div>
            </div>}
        </>
    );
};

export { TIMELINE_CHANGED_EVENT };
export default React.memo(TimelineWidget);
