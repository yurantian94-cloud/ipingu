import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive, ArrowLeft, Check, CheckCircle, Pause, Play, Plus,
  SpeakerHigh, Stop, Timer, TrendUp, Trophy, X, UserCircle, Sparkle,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { synthesizeSpeechDetailed, canSynthesizeSpeech } from '../utils/ttsRouter';
import { syncFocusContextSnapshot } from '../utils/focusStore';
import type { FocusAudioCache, FocusSession, FocusSessionMode, FocusTask, FocusTaskType } from '../types';
import Live2DAvatarCanvas, { type Live2DActionTrigger } from '../components/call/Live2DAvatarCanvas';
import type { AvatarMotionState } from '../components/call/VRMAvatarCanvas';
import type { Live2DAvatarConfig } from '../utils/live2dModelStore';
import type { AvatarStageFraming } from '../utils/avatarPerformance';
import { CallAudioFeed } from '../utils/callAudioFeed';
import type { AvatarTouchHit } from '../utils/avatarTouch';
import { App as CapacitorApp } from '@capacitor/app';
import { unlockAchievement } from '../utils/starlightAchievements';

type FocusView = 'home' | 'timer' | 'create' | 'detail' | 'archive' | 'characters';
type DetailRange = 'week' | 'month' | 'year';
type PendingFocusSession = Omit<FocusSession, 'id'>;
type FocusVoiceScene = 'start' | 'milestone' | 'touch' | 'pause' | 'early_end' | 'complete';

const FOCUS_VOICE_SCENES: Array<{ id: FocusVoiceScene; label: string; shortLabel: string; scripts: string[] }> = [
  { id: 'start', label: '开启专注', shortLabel: '开启', scripts: ['现在开始这一段专注吧，我会一直陪着你。', '把注意力交给眼前的事，慢慢来就很好。'] },
  { id: 'milestone', label: '专注里程碑', shortLabel: '里程碑', scripts: ['又完成了一个阶段，距离目标更近啦！', '保持呼吸，我们按着自己的节奏来。', '这一小段也算数，你正在稳稳地前进。'] },
  { id: 'touch', label: '专注中触摸', shortLabel: '触摸', scripts: ['我在这里呢，累了就深呼吸一下，再继续。', '别担心，陪你把这一小段走完。'] },
  { id: 'pause', label: '专注暂停', shortLabel: '暂停', scripts: ['先休息一下也没关系，准备好了再回来。', '暂停不是放弃，调整好节奏我们再继续。'] },
  { id: 'early_end', label: '提前结束', shortLabel: '提前结束', scripts: ['这一段已经很不容易了，记得温柔地对待自己。', '今天先到这里吧，你的努力没有白费。'] },
  { id: 'complete', label: '专注完成', shortLabel: '完成', scripts: ['这一段专注完成啦，真为你高兴。', '你做到了，给自己一点小小的庆祝吧。'] },
];

const uid = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const pad = (value: number) => String(Math.max(0, Math.floor(value))).padStart(2, '0');
const formatTimer = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
};
const formatHours = (seconds: number) => `${(Math.max(0, seconds) / 3600).toFixed(seconds >= 3600 ? 1 : 2)} 小时`;
const localDateKey = (time: number) => {
  const date = new Date(time);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const dateLabel = (time: number) => new Date(time).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
const encouragements = [
  '已经专注一段时间啦，喝口水，继续保持这个节奏。',
  '你正在把大目标拆成今天的一小步，做得很棒。',
  '注意力很珍贵，谢谢你把它留给正在做的事。',
  '别急，稳稳地完成眼前这一小段就好。',
];

const FOCUS_BACKGROUNDS: Record<string, string> = {
  night: 'bg-[radial-gradient(circle_at_50%_18%,rgba(96,165,250,.38),transparent_28%),linear-gradient(160deg,#0f172a,#172554_55%,#312e81)]',
  study: 'bg-[radial-gradient(circle_at_70%_20%,rgba(250,204,21,.22),transparent_28%),linear-gradient(160deg,#422006,#7c2d12_52%,#1c1917)]',
  dawn: 'bg-[radial-gradient(circle_at_30%_15%,rgba(253,186,116,.48),transparent_32%),linear-gradient(160deg,#7c2d12,#be123c_52%,#312e81)]',
};

const milestoneIntervalForMinutes = (minutes: number): number => minutes <= 35 ? 5 : 10;
const Glass: React.FC<React.PropsWithChildren<{ className?: string }>> = ({ children, className = '' }) => (
  <section className={`rounded-[28px] border border-white/65 bg-white/58 shadow-[0_18px_55px_rgba(71,58,112,0.12)] backdrop-blur-2xl ${className}`}>
    {children}
  </section>
);

const FocusTrendChart: React.FC<{ data: Array<{ label: string; seconds: number }> }> = ({ data }) => {
  const width = 320;
  const height = 148;
  const max = Math.max(60, ...data.map(item => item.seconds));
  const points = data.map((item, index) => {
    const x = data.length < 2 ? width / 2 : 12 + (index / (data.length - 1)) * (width - 24);
    const y = 16 + (1 - item.seconds / max) * 92;
    return { ...item, x, y };
  });
  const line = points.map(point => `${point.x},${point.y}`).join(' ');
  const fill = `${line} ${points.at(-1)?.x ?? width},116 ${points[0]?.x ?? 0},116`;
  return <div className="mt-4 overflow-hidden">
    <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full" role="img" aria-label="专注时长趋势图">
      {[0, 1, 2, 3].map(index => <line key={index} x1="12" x2={width - 12} y1={20 + index * 32} y2={20 + index * 32} stroke="#e2e8f0" strokeDasharray="3 5" />)}
      <polygon points={fill} fill="url(#focusTrendFill)" />
      <polyline points={line} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {points.map(point => <circle key={point.label} cx={point.x} cy={point.y} r="3.5" fill="#fff" stroke="#2563eb" strokeWidth="2" />)}
      <defs><linearGradient id="focusTrendFill" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#60a5fa" stopOpacity=".3" /><stop offset="1" stopColor="#dbeafe" stopOpacity="0" /></linearGradient></defs>
      {points.map(point => <text key={`${point.label}-label`} x={point.x} y="138" textAnchor="middle" className="fill-slate-400 text-[9px]">{point.label}</text>)}
    </svg>
  </div>;
};

const FocusHeatmap: React.FC<{ data: Array<{ key: string; seconds: number }> }> = ({ data }) => {
  const max = Math.max(1, ...data.map(item => item.seconds));
  const weeks = Math.ceil(data.length / 7);
  return <div className="mt-4 overflow-x-auto pb-1">
    <div className="flex min-w-max gap-2">
      <div className="grid grid-rows-7 gap-1 pt-5 text-[9px] text-slate-400"><span>一</span><span></span><span>三</span><span></span><span>五</span><span></span><span>日</span></div>
      <div>
        <div className="mb-1 flex justify-between text-[10px] text-slate-400"><span>{data[0]?.key.slice(5).replace('-', '月') || ''}</span><span>{data.at(-1)?.key.slice(0, 4) || ''} 年</span></div>
        <div className="grid grid-rows-7 grid-flow-col gap-1" style={{ gridTemplateColumns: `repeat(${weeks}, 14px)` }}>
          {data.map(item => <div key={item.key} title={`${item.key} · ${formatTimer(item.seconds)}`} className="h-3.5 w-3.5 rounded-[4px]" style={{ background: item.seconds ? `rgba(37,99,235,${0.22 + (item.seconds / max) * 0.75})` : '#f1f5f9' }} />)}
        </div>
      </div>
    </div>
    <div className="mt-3 flex items-center justify-end gap-1.5 text-[9px] text-slate-400"><span>少</span>{[0, .25, .5, .75, 1].map(value => <span key={value} className="h-3 w-3 rounded-[3px]" style={{ background: value ? `rgba(37,99,235,${.22 + value * .75})` : '#f1f5f9' }} />)}<span>多</span></div>
  </div>;
};

const typeLabel = (type: FocusTaskType) => type === 'TEN_K_HOURS' ? '一万小时计划' : type === 'DAILY_COUNT' ? '按次打卡' : '每日打卡';
const typeAccent = (type: FocusTaskType) => type === 'TEN_K_HOURS' ? 'text-violet-600 bg-violet-100/70' : type === 'DAILY_COUNT' ? 'text-amber-700 bg-amber-100/70' : 'text-cyan-700 bg-cyan-100/70';

const FocusTimerReadout = React.memo(({
  running,
  mode,
  targetMinutes,
  accumulatedRunMs,
  runStartedAt,
  className = '',
}: {
  running: boolean;
  mode: FocusSessionMode;
  targetMinutes: number;
  accumulatedRunMs: number;
  runStartedAt: number | null;
  className?: string;
}) => {
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const update = () => setClock(Date.now());
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  const elapsed = Math.max(0, Math.floor((accumulatedRunMs + (running && runStartedAt ? clock - runStartedAt : 0)) / 1000));
  const seconds = mode === 'COUNTDOWN' ? Math.max(0, targetMinutes * 60 - elapsed) : elapsed;
  return <div className={className}>{formatTimer(seconds)}</div>;
});

const FocusCompanionApp: React.FC = () => {
  const { closeApp, apiConfig, characters, activeCharacterId, addToast, updateCharacter } = useOS();
  const [focusCharacterId, setFocusCharacterId] = useState(() => localStorage.getItem('focus_companion_character_id') || activeCharacterId);
  const activeCharacter = characters.find(character => character.id === focusCharacterId)
    || characters.find(character => character.id === activeCharacterId)
    || characters[0];
  // OSContext can briefly publish an empty character list while restoring or
  // syncing records. Keep the last valid model config through that transient
  // state so the Live2D canvas is not destroyed and booted again.
  const lastLive2dConfigRef = useRef<Live2DAvatarConfig | null>(null);
  // OSContext may refresh character records while a session is running (for
  // example after a background sync). Keep the Live2D config reference stable
  // when its serialized contents did not actually change. Passing a newly
  // allocated config object on every provider render defeats React.memo and
  // makes the canvas host repaint alongside the glass shell.
  const lastLive2dCharacterIdRef = useRef<string | null>(null);
  const live2dSignature = activeCharacter?.videoAvatar?.format === 'live2d'
    ? JSON.stringify(activeCharacter.videoAvatar)
    : '';
  const live2dConfig = useMemo<Live2DAvatarConfig | null>(() => {
    if (live2dSignature && activeCharacter?.videoAvatar?.format === 'live2d') {
      const next = activeCharacter.videoAvatar as Live2DAvatarConfig;
      lastLive2dConfigRef.current = next;
      lastLive2dCharacterIdRef.current = activeCharacter.id;
      return next;
    }
    // Character hydration can briefly replace the selected record with a
    // partial object while the array itself is already non-empty. Keeping the
    // last model for that same character prevents the canvas from being
    // destroyed and booted again. A deliberate switch to another character
    // still clears the fallback because the IDs no longer match.
    const sameCharacterIsHydrating = Boolean(
      lastLive2dConfigRef.current
      && (!activeCharacter || activeCharacter.id === lastLive2dCharacterIdRef.current)
    );
    return sameCharacterIsHydrating ? lastLive2dConfigRef.current : null;
  }, [activeCharacter?.id, characters.length, live2dSignature]);
  const [view, setView] = useState<FocusView>('home');
  const [tasks, setTasks] = useState<FocusTask[]>([]);
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [analysisTaskId, setAnalysisTaskId] = useState<string | null>(null);
  const [mode, setMode] = useState<FocusSessionMode>('COUNTDOWN');
  const [targetMinutes, setTargetMinutes] = useState(25);
  const [reminderMinutes, setReminderMinutes] = useState(10);
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [audioCache, setAudioCache] = useState<FocusAudioCache[]>([]);
  const [voiceScene, setVoiceScene] = useState<FocusVoiceScene>('start');
  const [sceneVoiceIds, setSceneVoiceIds] = useState<Partial<Record<FocusVoiceScene, string>>>(() => {
    try { return JSON.parse(localStorage.getItem('focus_scene_voice_ids') || '{}'); } catch { return {}; }
  });
  const [generatingAudio, setGeneratingAudio] = useState(false);
  const [noiseEnabled, setNoiseEnabled] = useState(true);
  const [focusScreenDark, setFocusScreenDark] = useState(false);
  const [focusAvatarFraming, setFocusAvatarFraming] = useState<AvatarStageFraming>({ scale: 1, offsetX: 0, offsetY: 0 });
  const [focusBackground, setFocusBackground] = useState(() => localStorage.getItem('focus_background') || 'night');
  const [sessionControlsVisible, setSessionControlsVisible] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [running, setRunning] = useState(false);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [accumulatedRunMs, setAccumulatedRunMs] = useState(0);
  const [talkTrigger, setTalkTrigger] = useState<Live2DActionTrigger | null>(null);
  const [touchBusy, setTouchBusy] = useState(false);
  const [companionLine, setCompanionLine] = useState('');
  const [range, setRange] = useState<DetailRange>('week');
  const [taskName, setTaskName] = useState('');
  const [taskNote, setTaskNote] = useState('');
  const [taskType, setTaskType] = useState<FocusTaskType>('DAILY_HABIT');
  const [taskTargetMinutes, setTaskTargetMinutes] = useState(25);
  const [taskTargetCount, setTaskTargetCount] = useState(1);
  const [swipedTaskId, setSwipedTaskId] = useState<string | null>(null);
  const swipeStartX = useRef<number | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [pendingSession, setPendingSession] = useState<PendingFocusSession | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [timeEditorOpen, setTimeEditorOpen] = useState(false);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  useEffect(() => { try { localStorage.setItem('focus_scene_voice_ids', JSON.stringify(sceneVoiceIds)); } catch { /* private mode */ } }, [sceneVoiceIds]);
  const hasLoadedRef = useRef(false);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const finishingRef = useRef(false);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeAudioPriorityRef = useRef<0 | 1 | 2>(0);
  const touchCooldownRef = useRef(0);
  const lastMilestoneRef = useRef(0);
  const objectUrlRef = useRef<string | null>(null);
  const audioFeed = useMemo(() => new CallAudioFeed(), []);
  const noiseRef = useRef<{ context: AudioContext; source: AudioBufferSourceNode } | null>(null);
  const touchReplyRef = useRef<(hit: AvatarTouchHit) => Promise<void>>(async () => {});

  const selectedTask = tasks.find(task => task.id === selectedTaskId) || tasks[0];
  const elapsedSeconds = Math.max(0, Math.floor((accumulatedRunMs + (running && runStartedAt ? now - runStartedAt : 0)) / 1000));
  const remainingSeconds = mode === 'COUNTDOWN' ? Math.max(0, targetMinutes * 60 - elapsedSeconds) : elapsedSeconds;
  const todayKey = localDateKey(now);
  const todaySessions = useMemo(() => sessions.filter(session => localDateKey(session.startTime) === todayKey), [sessions, todayKey]);
  const todayByTask = useMemo(() => todaySessions.reduce<Record<string, number>>((map, session) => {
    map[session.taskId] = (map[session.taskId] || 0) + session.durationSeconds;
    return map;
  }, {}), [todaySessions]);
  const todaySeconds = Object.values(todayByTask).reduce((sum, value) => sum + value, 0);
  const tenKTasks = tasks.filter(task => task.type === 'TEN_K_HOURS');
  const tenKSeconds = tenKTasks.reduce((sum, task) => sum + task.accumulatedSeconds, 0);
  const liveMotion: AvatarMotionState = talkTrigger ? 'speaking' : 'thinking';
  const milestoneMinutes = milestoneIntervalForMinutes(targetMinutes);
  const milestoneCount = mode === 'COUNTDOWN' ? Math.max(1, Math.ceil(targetMinutes / milestoneMinutes)) : 0;
  const completedMilestones = mode === 'COUNTDOWN' ? Math.min(milestoneCount, Math.floor(elapsedSeconds / (milestoneMinutes * 60))) : 0;

  const refresh = useCallback(async (showLoading = false) => {
    // React StrictMode may replay the mount effect in development. Reusing the
    // same request prevents two DB reads from racing and toggling the loading
    // shell twice, which used to look like a full-page refresh.
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    // Background refreshes (for example after saving a session) must not
    // replace the whole app with a loading screen. That transition was a
    // visible flash on every refresh and also made the Live2D stage disappear.
    if (showLoading && !hasLoadedRef.current) setIsLoading(true);
    const request = (async () => {
      try {
      const [storedTasks, storedSessions, storedAudio] = await Promise.all([
        DB.getAllFocusTasks(),
        DB.getAllFocusSessions(),
        DB.getAllFocusAudioCache(),
      ]);
      const nextTasks = storedTasks;
      const nextSessions = storedSessions.sort((a, b) => b.startTime - a.startTime);
      setTasks(nextTasks);
      setSessions(nextSessions);
      setAudioCache(storedAudio);
      setSelectedTaskId(current => nextTasks.some(task => task.id === current) ? current : nextTasks[0]?.id || '');
      syncFocusContextSnapshot(nextTasks, nextSessions);
      } catch (error) {
        console.error('[FocusCompanion] load failed', error);
        addToast('专注数据读取失败，请稍后重试', 'error');
      } finally {
        hasLoadedRef.current = true;
        setIsLoading(false);
      }
    })();
    refreshInFlightRef.current = request;
    try {
      await request;
    } finally {
      if (refreshInFlightRef.current === request) refreshInFlightRef.current = null;
    }
  }, [addToast]);

  useEffect(() => { void refresh(true); }, [refresh]);
  useEffect(() => {
    const framing = live2dConfig?.framing;
    setFocusAvatarFraming({ scale: framing?.scale ?? 1, offsetX: framing?.offsetX ?? 0, offsetY: framing?.offsetY ?? 0 });
  }, [live2dConfig?.assetId, live2dConfig?.framing?.scale, live2dConfig?.framing?.offsetX, live2dConfig?.framing?.offsetY]);
  useEffect(() => { try { localStorage.setItem('focus_background', focusBackground); } catch { /* private mode */ } }, [focusBackground]);

  const updateFocusAvatarFraming = useCallback((patch: Partial<AvatarStageFraming>) => {
    if (!activeCharacter || activeCharacter.videoAvatar?.format !== 'live2d') return;
    const next = { ...focusAvatarFraming, ...patch };
    setFocusAvatarFraming(next);
    updateCharacter(activeCharacter.id, {
      videoAvatar: { ...activeCharacter.videoAvatar, framing: next },
    });
  }, [activeCharacter, focusAvatarFraming, updateCharacter]);
  useEffect(() => {
    if (!activeCharacter) return;
    setFocusCharacterId(activeCharacter.id);
    try { localStorage.setItem('focus_companion_character_id', activeCharacter.id); } catch { /* private mode */ }
  }, [activeCharacter?.id]);
  useEffect(() => {
    if (!running) return;
    // Date.now remains the source of truth for elapsed time. The renderer has
    // its own ticker; the page only needs a once-per-second state update for
    // Progress/milestone bookkeeping does not need to repaint the glass shell
    // every frame. The visible clock is isolated in FocusTimerReadout below.
    const tick = () => setNow(Date.now());
    tick();
    const interval = window.setInterval(tick, 2000);
    return () => window.clearInterval(interval);
  }, [running]);
  useEffect(() => {
    if (!running || !selectedTask) return;
    syncFocusContextSnapshot(tasks, sessions, { taskId: selectedTask.id, durationSeconds: elapsedSeconds });
  }, [elapsedSeconds, running, selectedTask, sessions, tasks]);
  useEffect(() => {
    let removeListener: (() => void) | undefined;
    void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) setNow(Date.now());
    }).then(handle => { removeListener = () => { void handle.remove(); }; }).catch(() => {});
    const onVisibility = () => { if (document.visibilityState === 'visible') setNow(Date.now()); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { removeListener?.(); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);
  useEffect(() => () => {
    activeAudioRef.current?.pause();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    audioFeed.setActive(false);
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    audioFeed.dispose();
    stopWhiteNoise();
  }, []);

  const startWhiteNoise = useCallback(async () => {
    if (!noiseEnabled || noiseRef.current || typeof window === 'undefined') return;
    try {
      const context = new AudioContext();
      await context.resume();
      const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let index = 0; index < data.length; index += 1) {
        const white = Math.random() * 2 - 1;
        last = last * 0.985 + white * 0.015;
        data[index] = last * 0.7;
      }
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      source.loop = true;
      gain.gain.value = 0.045;
      source.connect(gain).connect(context.destination);
      source.start();
      noiseRef.current = { context, source };
    } catch {
      // The timer remains usable when a browser blocks WebAudio.
    }
  }, [noiseEnabled]);

  const stopWhiteNoise = useCallback(() => {
    const current = noiseRef.current;
    noiseRef.current = null;
    if (!current) return;
    try { current.source.stop(); } catch { /* already stopped */ }
    void current.context.close().catch(() => {});
  }, []);

  const stopActiveAudio = useCallback((priority: 0 | 1 | 2) => {
    if (activeAudioPriorityRef.current > priority) return false;
    activeAudioRef.current?.pause();
    activeAudioRef.current = null;
    activeAudioPriorityRef.current = priority;
    // A fallback SpeechSynthesis utterance does not use activeAudioRef, so
    // cancel it here as part of the same priority lock.
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setTalkTrigger(null);
    audioFeed.setActive(false);
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    return true;
  }, [audioFeed]);

  const playAudioBlob = useCallback(async (blob: Blob, priority: 1 | 2, action?: Live2DActionTrigger | null) => {
    if (!stopActiveAudio(priority)) return;
    const url = URL.createObjectURL(blob);
    objectUrlRef.current = url;
    const audio = new Audio(url);
    activeAudioRef.current = audio;
    activeAudioPriorityRef.current = priority;
    if (action) setTalkTrigger(action);
    audio.onended = () => {
      audioFeed.setActive(false);
      if (activeAudioRef.current === audio) {
        activeAudioRef.current = null;
        activeAudioPriorityRef.current = 0;
      }
      if (objectUrlRef.current === url) {
        URL.revokeObjectURL(url);
        objectUrlRef.current = null;
      }
      if (action) setTalkTrigger(null);
    };
    await audio.play();
    await audioFeed.unlock();
    audioFeed.attach(audio);
    audioFeed.setActive(true);
  }, [audioFeed, stopActiveAudio]);

  const chooseTalkAction = useCallback((): Live2DActionTrigger | null => {
    const talkAction = live2dConfig?.actions.find(action => action.permission !== 'blocked' && action.tags.some(tag => /talk|speak|voice|说话/i.test(tag)));
    return talkAction ? { id: talkAction.id, nonce: Date.now() } : null;
  }, [live2dConfig]);

  const chooseTouchAction = useCallback((): Live2DActionTrigger | null => {
    const touchAction = live2dConfig?.actions.find(action => (
      action.permission !== 'blocked'
      && action.tags.some(tag => /surprise|attention|notice|smile|nod|惊讶|关注|微笑|点头/i.test(tag))
    ));
    return touchAction ? { id: touchAction.id, nonce: Date.now() } : chooseTalkAction();
  }, [chooseTalkAction, live2dConfig]);

  const playSceneAudio = useCallback(async (scene: FocusVoiceScene, priority: 1 | 2 = 1) => {
    const entry = audioCache.find(item => item.id === sceneVoiceIds[scene])
      || (scene === 'milestone' ? audioCache.find(item => !item.scene && item.favorite) : undefined);
    if (!entry) return false;
    setCompanionLine(entry.text);
    try {
      await playAudioBlob(entry.blob, priority, scene === 'touch' ? chooseTouchAction() : chooseTalkAction());
    } catch (error) {
      console.warn('[FocusCompanion] scene audio failed', error);
      addToast('这条语音播放失败', 'info');
      return false;
    }
    return true;
  }, [addToast, audioCache, chooseTalkAction, chooseTouchAction, playAudioBlob, sceneVoiceIds]);

  const generateSceneAudio = useCallback(async () => {
    if (!activeCharacter || !canSynthesizeSpeech(activeCharacter, apiConfig) || generatingAudio) {
      addToast('请先配置当前角色的 TTS 音色与 API Key', 'info');
      return;
    }
    setGeneratingAudio(true);
    try {
      const currentScene = FOCUS_VOICE_SCENES.find(item => item.id === voiceScene)!;
      const text = currentScene.scripts[Math.floor(Math.random() * currentScene.scripts.length)];
      const result = await synthesizeSpeechDetailed(text, activeCharacter, apiConfig);
      if (!result.blob) throw new Error('TTS 未返回可缓存音频');
      const entry: FocusAudioCache = { id: `focus_${voiceScene}_${Date.now()}`, text, blob: result.blob, createdAt: Date.now(), scene: voiceScene };
      await DB.saveFocusAudioCache(entry);
      setAudioCache(previous => [...previous, entry]);
      setSceneVoiceIds(previous => ({ ...previous, [voiceScene]: entry.id }));
      addToast(`已生成并选中「${currentScene.label}」语音`, 'success');
    } catch (error) {
      console.warn('[FocusCompanion] scene audio generation failed', error);
      addToast('语音生成失败，请检查 TTS 配置或网络', 'error');
    } finally {
      setGeneratingAudio(false);
    }
  }, [activeCharacter, addToast, apiConfig, generatingAudio, voiceScene]);

  const requestTouchReply = useCallback(async (hit: AvatarTouchHit) => {
    if (!running || !selectedTask || touchBusy || Date.now() < touchCooldownRef.current) return;
    stopActiveAudio(2);
    touchCooldownRef.current = Date.now() + 1500;
    setTouchBusy(true);
    try {
      if (!await playSceneAudio('touch', 2)) {
        activeAudioPriorityRef.current = 0;
        addToast('还没有为「专注中触摸」选择语音', 'info');
      }
    } catch (error) {
      console.warn('[FocusCompanion] touch audio failed', error);
      stopActiveAudio(2);
      activeAudioPriorityRef.current = 0;
      addToast('还没有为「专注中触摸」选择语音', 'info');
    } finally {
      setTouchBusy(false);
    }
  }, [addToast, playSceneAudio, running, selectedTask, stopActiveAudio, touchBusy]);

  useEffect(() => {
    touchReplyRef.current = requestTouchReply;
  }, [requestTouchReply]);

  const handleAvatarTouch = useCallback((hit: AvatarTouchHit) => {
    void touchReplyRef.current(hit);
  }, []);

  const previewAudio = useCallback(async (entry: FocusAudioCache) => {
    setPlayingAudioId(entry.id);
    setCompanionLine(entry.text);
    try {
      await playAudioBlob(entry.blob, 2, chooseTalkAction());
    } catch (error) {
      console.warn('[FocusCompanion] cached audio preview failed', error);
      addToast('语音播放失败', 'error');
    } finally {
      setPlayingAudioId(current => current === entry.id ? null : current);
    }
  }, [addToast, chooseTalkAction, playAudioBlob]);

  const removeAudio = useCallback(async (entry: FocusAudioCache) => {
    if (playingAudioId === entry.id) stopActiveAudio(2);
    await DB.deleteFocusAudioCache(entry.id);
    setAudioCache(previous => previous.filter(item => item.id !== entry.id));
    addToast('语音已从本地缓存删除', 'success');
  }, [addToast, playingAudioId, stopActiveAudio]);

  const requestFinish = useCallback((reason: 'manual' | 'countdown' = 'manual') => {
    if (finishingRef.current || !selectedTask) return;
    const endTime = Date.now();
    const durationSeconds = Math.max(0, Math.floor((accumulatedRunMs + (running && runStartedAt ? endTime - runStartedAt : 0)) / 1000));
    if (durationSeconds <= 0) return;
    finishingRef.current = true;
    setRunning(false);
    setRunStartedAt(null);
    setAccumulatedRunMs(0);
    stopWhiteNoise();
    stopActiveAudio(2);
    void playSceneAudio(reason === 'countdown' ? 'complete' : 'early_end', 2);
    setPendingSession({ taskId: selectedTask.id, startTime: endTime - durationSeconds * 1000, endTime, durationSeconds, mode });
    setNoteDraft('');
    setNoteOpen(true);
    if (reason === 'countdown') addToast('倒计时完成，写下一句复盘吧', 'success');
  }, [accumulatedRunMs, mode, running, runStartedAt, selectedTask, stopActiveAudio, stopWhiteNoise, addToast, playSceneAudio]);

  useEffect(() => {
    if (!running || elapsedSeconds < 1) return;
    if (reminderEnabled) {
      const intervalMinutes = mode === 'COUNTDOWN' ? milestoneMinutes : Math.max(1, reminderMinutes);
      const interval = intervalMinutes * 60;
      const milestone = Math.floor(elapsedSeconds / interval) * interval;
      if (milestone > 0 && milestone > lastMilestoneRef.current) {
        lastMilestoneRef.current = milestone;
        void playSceneAudio('milestone');
      }
    }
    if (mode === 'COUNTDOWN' && remainingSeconds <= 0) requestFinish('countdown');
  }, [elapsedSeconds, milestoneMinutes, mode, playSceneAudio, reminderEnabled, reminderMinutes, remainingSeconds, requestFinish, running]);

  const startSession = () => {
    if (!selectedTask) {
      addToast('请先创建并选择一个专注计划', 'info');
      setView('home');
      return;
    }
    const timestamp = Date.now();
    activeAudioPriorityRef.current = 0;
    setView('timer');
    setSessionControlsVisible(true);
    setRunStartedAt(timestamp);
    setRunning(true);
    lastMilestoneRef.current = 0;
    void startWhiteNoise();
    void playSceneAudio('start', 2);
  };

  const pauseSession = () => {
    if (!running || !runStartedAt) return;
    setAccumulatedRunMs(previous => previous + (Date.now() - runStartedAt));
    setRunStartedAt(null);
    setRunning(false);
    stopActiveAudio(2);
    stopWhiteNoise();
    void playSceneAudio('pause', 2);
  };

  const savePendingSession = async (note = '') => {
    if (!pendingSession) return;
    try {
      const session: FocusSession = { id: uid('focus_session'), ...pendingSession, note: note.trim() || undefined };
      await DB.saveFocusSession(session);
      const task = tasks.find(item => item.id === session.taskId);
      if (task?.type === 'TEN_K_HOURS' && task.accumulatedSeconds + session.durationSeconds >= task.targetSeconds) {
        void unlockAchievement({ key: `focus:${task.id}`, title: '自律的巅峰', description: `完成「${task.name}」的一万小时专注里程碑。`, coreItem: 'a golden trophy with abs engraving', notify: message => addToast(message, 'success') });
      }
      await refresh();
      addToast('专注记录已保存', 'success');
    } catch (error) {
      console.error('[FocusCompanion] save failed', error);
      addToast('专注记录保存失败，请稍后重试', 'error');
    } finally {
      finishingRef.current = false;
      setPendingSession(null);
      setNoteOpen(false);
    }
  };

  const createTask = async () => {
    const name = taskName.trim();
    if (!name) return addToast('请填写任务名称', 'info');
    const task: FocusTask = {
      id: uid('focus_task'), name, note: taskNote.trim() || undefined, type: taskType, accumulatedSeconds: 0,
      targetSeconds: taskType === 'TEN_K_HOURS' ? 36_000_000 : clamp(taskTargetMinutes, 1, 240) * 60,
      targetCount: taskType === 'DAILY_COUNT' ? clamp(taskTargetCount, 1, 100) : undefined,
    };
    await DB.saveFocusTask(task);
    setTasks(previous => [...previous, task]);
    setSelectedTaskId(task.id);
    setTaskName('');
    setTaskNote('');
    setView('home');
    addToast('任务已创建', 'success');
  };

  const deleteTask = async (task: FocusTask) => {
    if (!window.confirm(`删除「${task.name}」及其专注记录？`)) return;
    await DB.deleteFocusTask(task.id);
    setTasks(previous => previous.filter(item => item.id !== task.id));
    setSessions(previous => previous.filter(session => session.taskId !== task.id));
    await refresh();
  };

  const taskSessions = useMemo(() => analysisTaskId ? sessions.filter(session => session.taskId === analysisTaskId) : sessions, [analysisTaskId, sessions]);
  const detailDays = range === 'week' ? 7 : range === 'month' ? 35 : 364;
  const trend = useMemo(() => {
    const buckets = range === 'year' ? 12 : range === 'month' ? 12 : 7;
    return Array.from({ length: buckets }, (_, index) => {
      const date = new Date(now);
      if (range === 'year') date.setMonth(date.getMonth() - (buckets - index - 1));
      else date.setDate(date.getDate() - (buckets - index - 1));
      const key = range === 'year' ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}` : localDateKey(date.getTime());
      const seconds = taskSessions.filter(session => (range === 'year' ? localDateKey(session.startTime).slice(0, 7) : localDateKey(session.startTime)) === key).reduce((sum, session) => sum + session.durationSeconds, 0);
      return { label: range === 'year' ? `${date.getMonth() + 1}月` : `${date.getMonth() + 1}/${date.getDate()}`, seconds };
    });
  }, [now, range, taskSessions]);
  const heatmap = useMemo(() => Array.from({ length: detailDays }, (_, index) => {
    const date = new Date(now);
    date.setDate(date.getDate() - (detailDays - index - 1));
    const key = localDateKey(date.getTime());
    const seconds = taskSessions.filter(session => localDateKey(session.startTime) === key).reduce((sum, session) => sum + session.durationSeconds, 0);
    return { key, seconds };
  }), [detailDays, now, taskSessions]);
  const maxTrend = Math.max(1, ...trend.map(item => item.seconds));
  const maxHeat = Math.max(1, ...heatmap.map(item => item.seconds));
  // Keep the heatmap canvas stable across ranges. The denser the range, the
  // smaller each square becomes, while the surrounding analysis card keeps a
  // predictable footprint for quick visual comparison.
  const heatmapCellSize = range === 'week' ? 42 : range === 'month' ? 24 : 13;
  // Keep the heatmap viewport stable while the range changes; only cell density varies.
  const heatmapMinHeight = 240;

  const openTask = (task: FocusTask, nextView: FocusView = 'detail') => {
    setSelectedTaskId(task.id);
    setAnalysisTaskId(task.id);
    setView(nextView);
  };

  const openGlobalAnalysis = () => {
    setAnalysisTaskId(null);
    setView('detail');
  };

  const archiveTask = async (task: FocusTask) => {
    const archived = { ...task, archived: true, completedAt: Date.now() };
    await DB.saveFocusTask(archived);
    setTasks(previous => previous.map(item => item.id === task.id ? archived : item));
    setSwipedTaskId(null);
    addToast('任务已归档', 'success');
  };

  const renderHeader = (title: string, back: FocusView = 'home') => (
    <header className="flex items-center justify-between px-5 pb-4 pt-[max(16px,env(safe-area-inset-top))]"><button type="button" onClick={() => setView(back)} aria-label="返回" className="rounded-full border border-white/70 bg-white/55 p-2.5 text-slate-700"><ArrowLeft size={19} /></button><div className="text-center"><div className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500">Focus Companion</div><h1 className="text-lg font-black">{title}</h1></div><div className="w-10" /></header>
  );

  const renderAudioLibrary = () => <>
    <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
      {FOCUS_VOICE_SCENES.map(scene => <button type="button" key={scene.id} onClick={() => setVoiceScene(scene.id)} className={`shrink-0 rounded-full px-3 py-2 text-[10px] font-bold ${voiceScene === scene.id ? 'bg-blue-600 text-white' : 'bg-white/70 text-slate-500'}`}>{scene.shortLabel}</button>)}
    </div>
    <div className="mt-2 rounded-xl bg-blue-50/75 px-3 py-2 text-[10px] text-blue-700">当前演出：{FOCUS_VOICE_SCENES.find(scene => scene.id === voiceScene)?.label}。请主动生成语音，再从下方轮播库选择一条。</div>
    <button type="button" onClick={() => void generateSceneAudio()} disabled={generatingAudio} className="mt-3 w-full rounded-xl bg-slate-800 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-50">{generatingAudio ? '语音生成中…' : `生成「${FOCUS_VOICE_SCENES.find(scene => scene.id === voiceScene)?.label}」语音`}</button>
    {audioCache.filter(entry => (entry.scene || 'milestone') === voiceScene).length > 0 ? (
    <div className="mt-3 rounded-2xl bg-white/55 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold text-slate-600">语音轮播库</span>
        <span className="text-[10px] text-slate-400">点一条作为此演出语音</span>
      </div>
      <div className="mt-2 flex snap-x gap-2 overflow-x-auto pb-1">
        {audioCache.filter(entry => (entry.scene || 'milestone') === voiceScene).map(entry => (
          <div key={entry.id} className={`flex min-w-[210px] snap-center items-center gap-2 rounded-xl px-2.5 py-2 ${sceneVoiceIds[voiceScene] === entry.id ? 'bg-blue-100 ring-1 ring-blue-400' : 'bg-white/70'}`}>
            <button type="button" onClick={() => void previewAudio(entry)} aria-label={`播放语音：${entry.text}`} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white">
              {playingAudioId === entry.id ? <Pause size={12} weight="fill" /> : <Play size={12} weight="fill" />}
            </button>
            <button type="button" onClick={() => { setSceneVoiceIds(previous => ({ ...previous, [voiceScene]: entry.id })); addToast(`已选择这条${FOCUS_VOICE_SCENES.find(scene => scene.id === voiceScene)?.label}语音`, 'success'); }} className="min-w-0 flex-1 truncate text-left text-[11px] text-slate-600">{entry.text}</button>
            <button type="button" onClick={() => void removeAudio(entry)} aria-label="删除本地语音" className="rounded-full p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-500"><X size={13} /></button>
          </div>
        ))}
      </div>
    </div>
    ) : null}
  </>;

  const renderTimerLegacy = () => <>
    {renderHeader('专注室')}
    <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
      <Glass className="relative overflow-hidden px-5 pb-6 pt-6">
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">{selectedTask ? typeLabel(selectedTask.type) : 'Focus session'}</p><h2 className="mt-1 max-w-[220px] truncate text-xl font-black">{selectedTask?.name || '选择一个任务'}</h2></div>
          <button type="button" onClick={() => setView('home')} aria-label="任务列表" className="rounded-full border border-white/70 bg-white/60 p-2 text-slate-500"><X size={16} /></button>
        </div>
        <div className="mt-7 flex items-center justify-center gap-1 rounded-full border border-white/70 bg-white/60 p-1 text-sm font-bold">
          <button type="button" disabled={running} onClick={() => setMode('COUNTDOWN')} className={`flex-1 rounded-full py-2 ${mode === 'COUNTDOWN' ? 'bg-slate-800 text-white shadow' : 'text-slate-500'}`}>倒计时</button>
          <button type="button" disabled={running} onClick={() => setMode('STOPWATCH')} className={`flex-1 rounded-full py-2 ${mode === 'STOPWATCH' ? 'bg-slate-800 text-white shadow' : 'text-slate-500'}`}>正计时</button>
        </div>
        <div role={!running ? 'button' : undefined} tabIndex={!running ? 0 : -1} aria-label={!running ? '选择 Live2D 角色' : undefined} onClick={() => !running && setView('characters')} onKeyDown={event => { if (!running && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setView('characters'); } }} className={`relative mt-8 flex w-full items-center justify-center overflow-hidden ${running ? 'h-[360px] bg-transparent' : 'h-[270px] rounded-[26px] border border-white/60 bg-white/25'}`}>
           {live2dConfig ? <Live2DAvatarCanvas config={live2dConfig} motionState={liveMotion} audioFeed={audioFeed} manualAction={talkTrigger} onAvatarTouch={handleAvatarTouch} preserveActiveWardrobe ambientAutonomyDisabled maxFps={30} /> : <div className="text-center text-slate-500"><div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-white/65 text-3xl shadow-inner">✦</div><p className="mt-3 text-xs">点击这里选择可预览的 Live2D 角色</p></div>}
          {running && <div className="pointer-events-none absolute inset-x-0 top-5 z-10 text-center"><FocusTimerReadout running={running} mode={mode} targetMinutes={targetMinutes} accumulatedRunMs={accumulatedRunMs} runStartedAt={runStartedAt} className="font-mono text-[clamp(3.4rem,14vw,5.8rem)] font-black leading-none tracking-[-0.08em] text-white drop-shadow-[0_4px_18px_rgba(15,23,42,.45)]" />{companionLine && <p className="mx-auto mt-2 max-w-[280px] rounded-full bg-slate-900/25 px-3 py-1 text-xs text-white backdrop-blur">{companionLine}</p>}</div>}
          {running && <div className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[10px] font-bold tracking-[0.2em] text-white/90 drop-shadow">STAY WITH THE MOMENT</div>}
        </div>
        <button type="button" onClick={() => !running && mode === 'COUNTDOWN' && setTimeEditorOpen(value => !value)} className="mt-8 w-full text-center"><FocusTimerReadout running={running} mode={mode} targetMinutes={targetMinutes} accumulatedRunMs={accumulatedRunMs} runStartedAt={runStartedAt} className="font-mono text-[clamp(4rem,17vw,6.8rem)] font-black leading-none tracking-[-0.08em] text-slate-800" /><p className="mt-2 text-xs text-slate-500">{running ? '时间按真实时钟计算，切到后台也不会漂移' : mode === 'COUNTDOWN' ? '点击时间设置目标' : '准备开始正计时'}</p></button>
        {timeEditorOpen && !running && <div className="mt-3 flex items-center justify-center gap-2 rounded-2xl bg-white/60 p-3 text-xs"><Timer size={14} /><input aria-label="目标分钟" type="number" min={1} max={240} value={targetMinutes} onChange={event => setTargetMinutes(clamp(Number(event.target.value) || 1, 1, 240))} className="w-16 rounded-xl bg-white/80 px-2 py-2 text-center font-semibold outline-none" /><span className="text-slate-500">分钟</span></div>}
        <div className="mt-7 grid grid-cols-[1fr_auto] gap-3"><button type="button" onClick={running ? pauseSession : startSession} className="flex items-center justify-center gap-2 rounded-full bg-blue-500 px-6 py-3.5 text-base font-bold text-white shadow-xl shadow-blue-300/30">{running ? <><Pause size={20} weight="fill" />暂停专注</> : <><Play size={20} weight="fill" />开始专注</>}</button><button type="button" onClick={() => requestFinish()} disabled={!running && accumulatedRunMs <= 0} aria-label="结束专注" className="rounded-full border border-white/70 bg-white/70 px-4 text-slate-600 disabled:opacity-35"><Stop size={19} weight="fill" /></button></div>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs"><button type="button" onClick={() => setReminderOpen(value => !value)} className="flex items-center gap-1.5 rounded-full border border-white/70 bg-white/55 px-3 py-2 text-slate-500"><SpeakerHigh size={14} />提醒 {reminderEnabled ? '开' : '关'} · {reminderMinutes} 分钟</button><button type="button" onClick={() => setNoiseEnabled(value => !value)} className={`rounded-full px-3 py-2 font-semibold ${noiseEnabled ? 'bg-cyan-100 text-cyan-700' : 'bg-white/55 text-slate-500'}`}>白噪音 {noiseEnabled ? '开' : '关'}</button></div>
        {reminderOpen && <div className="mt-3 rounded-2xl bg-white/60 p-4 text-xs"><div className="flex items-center justify-between gap-3"><span className="font-bold">演出语音</span><button type="button" onClick={() => setReminderEnabled(value => !value)} className={`rounded-full px-3 py-1.5 font-bold ${reminderEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{reminderEnabled ? '里程碑已开启' : '里程碑已关闭'}</button></div><label className="mt-3 flex items-center justify-between gap-3"><span>提醒间隔</span><span className="flex items-center gap-2"><input aria-label="提醒间隔分钟" type="number" min={1} max={120} value={reminderMinutes} onChange={event => setReminderMinutes(clamp(Number(event.target.value) || 1, 1, 120))} className="w-14 rounded-xl bg-white/80 px-2 py-2 text-center font-semibold outline-none" />分钟</span></label>{renderAudioLibrary()}</div>}
      </Glass>
    </main>
  </>;


  const renderTimer = () => {
    const noTask = !selectedTask;
    if (running) return <main className="relative flex-1 overflow-hidden bg-slate-950 text-white" onClick={() => setSessionControlsVisible(value => !value)}>
      <div className={`absolute inset-0 ${focusScreenDark ? 'bg-black' : FOCUS_BACKGROUNDS[focusBackground] || FOCUS_BACKGROUNDS.night}`}>
        {!focusScreenDark && live2dConfig && <div className="absolute inset-0"><Live2DAvatarCanvas config={live2dConfig} framing={focusAvatarFraming} motionState={liveMotion} audioFeed={audioFeed} manualAction={talkTrigger} onAvatarTouch={handleAvatarTouch} preserveActiveWardrobe ambientAutonomyDisabled maxFps={30} /></div>}
      </div>
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between bg-gradient-to-b from-black/45 via-transparent to-black/75 p-5 pb-[max(28px,env(safe-area-inset-bottom))]">
        <div className={`flex items-start justify-between transition-opacity ${sessionControlsVisible ? 'opacity-100' : 'opacity-0'}`}><div><p className="text-[10px] font-bold tracking-[.18em] text-white/60">VIDEO SUPERVISION</p><p className="mt-1 text-sm font-black">{selectedTask?.name}</p></div><button type="button" onClick={event => { event.stopPropagation(); setFocusScreenDark(value => !value); }} className="pointer-events-auto rounded-xl bg-white/15 px-3 py-2 text-[11px] font-bold backdrop-blur">{focusScreenDark ? '亮屏' : '熄屏'}</button></div>
        <div className="mt-auto max-w-[72%] text-left"><FocusTimerReadout running={running} mode={mode} targetMinutes={targetMinutes} accumulatedRunMs={accumulatedRunMs} runStartedAt={runStartedAt} className="font-mono text-[clamp(3rem,14vw,4.6rem)] font-black leading-none tracking-[-.08em] text-white drop-shadow-[0_4px_14px_rgba(0,0,0,.5)]" />{companionLine && <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-white/70">{companionLine}</p>}</div>
        <div className={`pointer-events-auto grid grid-cols-2 gap-2 transition-all ${sessionControlsVisible ? 'translate-y-0 opacity-100' : 'translate-y-16 opacity-0'}`}><button type="button" onClick={event => { event.stopPropagation(); pauseSession(); }} className="rounded-2xl bg-white py-3.5 text-sm font-black text-slate-900"><Pause className="mr-1 inline" size={17} weight="fill" />暂停</button><button type="button" onClick={event => { event.stopPropagation(); requestFinish(); }} className="rounded-2xl bg-white/15 py-3.5 text-sm font-black text-white backdrop-blur"><Stop className="mr-1 inline" size={17} weight="fill" />结束</button></div>
      </div>
      {!sessionControlsVisible && <p className="pointer-events-none absolute inset-x-0 bottom-7 text-center text-[11px] text-white/45">轻触空白处唤起控制</p>}
    </main>;
    return <>
      {focusScreenDark ? <header className="flex items-center justify-between bg-slate-950 px-4 pb-3 pt-[max(14px,env(safe-area-inset-top))] text-white"><button type="button" onClick={() => setFocusScreenDark(false)} className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold">退出熄屏</button><span className="text-xs font-bold tracking-[.18em] text-white/50">FOCUS</span><div className="w-16" /></header> : renderHeader('视频监督专注')}
      <main className={`min-h-0 flex-1 overflow-y-auto px-4 pb-8 ${focusScreenDark ? 'bg-slate-950 text-white' : ''}`}>
        <section className={`relative overflow-hidden rounded-[30px] ${focusScreenDark ? 'min-h-[460px] bg-black' : `${FOCUS_BACKGROUNDS[focusBackground] || FOCUS_BACKGROUNDS.night} shadow-[0_20px_42px_-24px_rgba(15,23,42,.9)]`}`}>
          {!focusScreenDark && (live2dConfig ? <div className="absolute inset-0 transition-transform duration-300"><Live2DAvatarCanvas config={live2dConfig} framing={focusAvatarFraming} motionState={liveMotion} audioFeed={audioFeed} manualAction={talkTrigger} onAvatarTouch={handleAvatarTouch} preserveActiveWardrobe ambientAutonomyDisabled maxFps={30} /></div> : <button type="button" onClick={() => setView('characters')} className="flex h-80 w-full flex-col items-center justify-center bg-transparent text-slate-300"><UserCircle size={58} weight="duotone" /><span className="mt-3 text-sm font-bold">选择 Live2D 监督角色</span><span className="mt-1 text-[11px] text-slate-400">点击即可预览与切换</span></button>)}
          <div style={{ minHeight: focusScreenDark ? 460 : 320 }} className={`relative z-10 flex flex-col justify-end p-5 pb-12 ${focusScreenDark ? 'bg-black' : 'pointer-events-none bg-gradient-to-b from-slate-950/25 via-transparent to-slate-950/70'}`}>
            <div className="flex items-start justify-between"><div><p className="text-[10px] font-bold tracking-[.18em] text-white/60">{running ? 'SUPERVISION IN PROGRESS' : 'READY TO FOCUS'}</p><p className="mt-1 text-sm font-black">{selectedTask?.name || '还没有选择计划'}</p></div><button type="button" onClick={() => setFocusScreenDark(value => !value)} className="pointer-events-auto rounded-xl bg-white/15 px-2.5 py-2 text-[10px] font-bold text-white backdrop-blur">{focusScreenDark ? '亮屏模式' : '熄屏模式'}</button></div>
            <div className="mt-auto text-center"><FocusTimerReadout running={running} mode={mode} targetMinutes={targetMinutes} accumulatedRunMs={accumulatedRunMs} runStartedAt={runStartedAt} className="font-mono text-[clamp(3.8rem,18vw,5.6rem)] font-black leading-none tracking-[-.08em] text-white" /><p className="mt-3 text-xs text-white/60">{running ? (companionLine || '角色正在陪伴你完成这一段') : noTask ? '请先选择一个计划' : mode === 'COUNTDOWN' ? `${targetMinutes} 分钟倒计时` : '正计时模式'}</p></div>
            <div className="flex items-center justify-center gap-2"><button type="button" disabled={running} onClick={() => setMode('COUNTDOWN')} className={`pointer-events-auto rounded-full px-3 py-1.5 text-[11px] font-bold ${mode === 'COUNTDOWN' ? 'bg-white text-slate-900' : 'bg-white/15 text-white/70'}`}>倒计时</button><button type="button" disabled={running} onClick={() => setMode('STOPWATCH')} className={`pointer-events-auto rounded-full px-3 py-1.5 text-[11px] font-bold ${mode === 'STOPWATCH' ? 'bg-white text-slate-900' : 'bg-white/15 text-white/70'}`}>正计时</button></div>
          </div>
        </section>
        <div className={`mt-3 rounded-2xl p-3 ${focusScreenDark ? 'bg-white/10' : 'bg-white/65'}`}>
          <div className="flex items-center justify-between"><span className="text-xs font-bold">监督画面</span><button type="button" onClick={() => setView('characters')} className="rounded-xl bg-blue-600 px-3 py-2 text-[11px] font-bold text-white">更换角色</button></div>
          <label className="mt-3 flex items-center gap-2"><span className="w-14 shrink-0 text-[11px] text-slate-400">左右</span><input aria-label="角色左右位置" type="range" min={-1.4} max={1.4} step={0.01} value={focusAvatarFraming.offsetX} onChange={event => updateFocusAvatarFraming({ offsetX: Number(event.target.value) })} className="h-1.5 flex-1 accent-blue-600" /><span className="w-10 text-right text-[10px] tabular-nums text-slate-400">{Math.round(focusAvatarFraming.offsetX * 100)}</span></label>
          <label className="mt-2 flex items-center gap-2"><span className="w-14 shrink-0 text-[11px] text-slate-400">上下</span><input aria-label="角色上下位置" type="range" min={-3.2} max={3.2} step={0.01} value={focusAvatarFraming.offsetY} onChange={event => updateFocusAvatarFraming({ offsetY: Number(event.target.value) })} className="h-1.5 flex-1 accent-blue-600" /><span className="w-10 text-right text-[10px] tabular-nums text-slate-400">{Math.round(focusAvatarFraming.offsetY * 100)}</span></label>
          <label className="mt-2 flex items-center gap-2"><span className="w-14 shrink-0 text-[11px] text-slate-400">放大</span><input aria-label="角色放大倍数" type="range" min={0.55} max={20} step={0.01} value={focusAvatarFraming.scale} onChange={event => updateFocusAvatarFraming({ scale: Number(event.target.value) })} className="h-1.5 flex-1 accent-violet-600" /><span className="w-10 text-right text-[10px] tabular-nums text-slate-400">{focusAvatarFraming.scale.toFixed(2)}x</span></label>
          <div className="mt-2 flex items-center justify-between gap-2"><span className="text-[11px] text-slate-400">背景</span><div className="flex gap-1">{[['night', '夜蓝'], ['study', '书房'], ['dawn', '晨光']].map(([id, label]) => <button type="button" key={id} onClick={() => setFocusBackground(id)} className={`rounded-lg px-2.5 py-1.5 text-xs font-bold ${focusBackground === id ? 'bg-blue-600 text-white' : 'bg-white/70 text-slate-500'}`}>{label}</button>)}</div></div>
        </div>
        {!running && mode === 'COUNTDOWN' && <button type="button" onClick={() => setTimeEditorOpen(value => !value)} className={`mt-3 w-full rounded-2xl px-4 py-3 text-xs font-bold ${focusScreenDark ? 'bg-white/10 text-white' : 'bg-white/70 text-slate-600'}`}>本次目标：{targetMinutes} 分钟 · 点击调整</button>}
        {timeEditorOpen && !running && <div className={`mt-2 flex items-center justify-center gap-2 rounded-2xl p-3 text-xs ${focusScreenDark ? 'bg-white/10' : 'bg-white/60'}`}><Timer size={14} /><input aria-label="目标分钟" type="number" min={1} max={240} value={targetMinutes} onChange={event => setTargetMinutes(clamp(Number(event.target.value) || 1, 1, 240))} className="w-16 rounded-xl bg-white/80 px-2 py-2 text-center font-semibold text-slate-800 outline-none" /><span>分钟</span></div>}
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2"><button type="button" onClick={() => noTask ? setView('home') : (running ? pauseSession() : startSession())} className="flex items-center justify-center gap-2 rounded-2xl bg-blue-600 py-3.5 text-sm font-black text-white shadow-lg shadow-blue-500/25">{noTask ? <><Plus size={18} weight="bold" />创建计划</> : running ? <><Pause size={18} weight="fill" />暂停专注</> : <><Play size={18} weight="fill" />开始专注</>}</button><button type="button" onClick={() => requestFinish()} disabled={!running && accumulatedRunMs <= 0} aria-label="结束专注" className={`rounded-2xl px-4 disabled:opacity-30 ${focusScreenDark ? 'bg-white/10 text-white' : 'bg-white/75 text-slate-600'}`}><Stop size={18} weight="fill" /></button></div>
        <div className="mt-3 flex gap-2"><button type="button" onClick={() => setReminderOpen(value => !value)} className={`flex-1 rounded-xl py-2 text-[11px] font-bold ${focusScreenDark ? 'bg-white/10 text-white/75' : 'bg-white/70 text-slate-600'}`}><SpeakerHigh className="mr-1 inline" size={13} />语音提醒 {reminderEnabled ? '开' : '关'}</button><button type="button" onClick={() => setNoiseEnabled(value => !value)} className={`flex-1 rounded-xl py-2 text-[11px] font-bold ${focusScreenDark ? 'bg-white/10 text-white/75' : 'bg-white/70 text-slate-600'}`}>白噪音 {noiseEnabled ? '开' : '关'}</button></div>
        {reminderOpen && <div className={`mt-3 rounded-2xl p-4 text-xs ${focusScreenDark ? 'bg-white/10 text-white' : 'bg-white/65'}`}><div className="flex items-center justify-between"><span className="font-bold">演出语音箱</span><button type="button" onClick={() => setReminderEnabled(value => !value)} className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-[10px] font-bold text-white">{reminderEnabled ? '里程碑已开启' : '里程碑已关闭'}</button></div><label className="mt-3 flex items-center justify-between"><span>提醒间隔</span><input aria-label="提醒间隔分钟" type="number" min={1} max={120} value={reminderMinutes} onChange={event => setReminderMinutes(clamp(Number(event.target.value) || 1, 1, 120))} className="w-14 rounded-lg bg-white px-2 py-1.5 text-center text-slate-800" /></label>{renderAudioLibrary()}</div>}
      </main>
    </>;
  };

  const renderHomeLegacy = () => <></>;

  const renderHome = () => {
    const activeTasks = tasks.filter(task => !task.archived);
    const completedTasks = activeTasks.filter(task => (todayByTask[task.id] || 0) > 0).length;
    return <>
      <header className="flex items-center justify-between px-4 pb-3 pt-[max(14px,env(safe-area-inset-top))]">
        <button type="button" onClick={closeApp} aria-label="返回桌面" className="rounded-full border border-white/70 bg-white/65 p-2 text-slate-700"><ArrowLeft size={18} /></button>
        <div className="text-center"><p className="text-[10px] font-bold uppercase tracking-[.22em] text-slate-400">Focus space</p><h1 className="mt-0.5 text-base font-black">专注空间</h1></div>
        <button type="button" onClick={() => setView('archive')} aria-label="归档箱" className="rounded-full border border-white/70 bg-white/65 p-2 text-slate-700"><Archive size={18} /></button>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-28">
        <section className="relative overflow-hidden rounded-[26px] bg-gradient-to-br from-slate-800 via-slate-700 to-blue-800 px-5 py-4 text-white shadow-[0_18px_42px_-24px_rgba(30,64,175,.8)]">
          <div className="absolute -right-8 -top-10 h-32 w-32 rounded-full bg-blue-300/15" />
          <div className="relative flex items-end justify-between"><div><p className="text-xs text-white/60">{new Date(now).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}</p><p className="mt-2 text-3xl font-black tabular-nums">{formatTimer(todaySeconds)}</p><p className="mt-1 text-[11px] text-white/60">今天已专注 · {completedTasks}/{activeTasks.length} 个任务有进展</p></div><button type="button" onClick={() => setView('timer')} className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-blue-600 shadow-lg"><Play size={21} weight="fill" /></button></div>
        </section>
        <div className="mt-3 flex items-center justify-between"><div><h2 className="text-base font-black">进行中的计划</h2><p className="mt-0.5 text-[11px] text-slate-500">点开计划即可开始或查看分析</p></div><button type="button" onClick={() => { setTaskName(''); setTaskNote(''); setView('create'); }} className="flex items-center gap-1 rounded-xl bg-slate-800 px-3 py-2 text-xs font-bold text-white"><Plus size={15} weight="bold" />新建</button></div>
        {activeTasks.length === 0 ? <Glass className="mt-3 p-6 text-center"><p className="text-sm font-bold">还没有专注计划</p><p className="mt-1 text-xs text-slate-500">先创建一个小目标，再开始第一段专注。</p><button type="button" onClick={() => setView('create')} className="mt-4 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white">创建计划</button></Glass> : <div className="mt-3 space-y-2">{activeTasks.map(task => {
          const seconds = todayByTask[task.id] || 0;
          const count = todaySessions.filter(session => session.taskId === task.id).length;
          const progress = task.type === 'TEN_K_HOURS' ? clamp(task.accumulatedSeconds / task.targetSeconds, 0, 1) : task.type === 'DAILY_COUNT' ? clamp(count / Math.max(1, task.targetCount || 1), 0, 1) : clamp(seconds / Math.max(1, task.targetSeconds), 0, 1);
          return <Glass key={task.id} className="p-3"><div className="flex items-center gap-3"><div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${typeAccent(task.type)}`}>{task.type === 'TEN_K_HOURS' ? <Trophy size={19} weight="duotone" /> : task.type === 'DAILY_COUNT' ? <Check size={18} weight="bold" /> : <CheckCircle size={19} weight="duotone" />}</div><button type="button" onClick={() => openTask(task)} className="min-w-0 flex-1 text-left"><div className="flex items-center justify-between gap-2"><h3 className="truncate text-sm font-black">{task.name}</h3><span className="text-[10px] font-bold text-slate-400">{task.type === 'DAILY_COUNT' ? `${count}/${task.targetCount || 1} 次` : formatTimer(seconds)}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${task.type === 'TEN_K_HOURS' ? 'bg-violet-500' : task.type === 'DAILY_COUNT' ? 'bg-amber-500' : 'bg-blue-500'}`} style={{ width: `${Math.max(2, progress * 100)}%` }} /></div></button><button type="button" onClick={() => { setSelectedTaskId(task.id); setView('timer'); }} aria-label={`开始${task.name}`} className="rounded-xl bg-blue-50 p-2.5 text-blue-600"><Play size={16} weight="fill" /></button></div></Glass>;
        })}</div>}
      </main>
      <nav className="absolute inset-x-4 bottom-4 z-20 flex rounded-2xl border border-white/70 bg-white/85 p-1.5 shadow-xl backdrop-blur-2xl"><button type="button" onClick={() => setView('home')} className="flex-1 rounded-xl bg-slate-800 py-2 text-xs font-bold text-white">计划</button><button type="button" onClick={openGlobalAnalysis} className="flex-1 rounded-xl py-2 text-xs font-bold text-slate-500">分析</button></nav>
    </>;
  };

  const renderCreate = () => <><div className="flex-1 overflow-y-auto">{renderHeader(taskType === 'TEN_K_HOURS' ? '创建一万小时计划' : taskType === 'DAILY_COUNT' ? '创建按次打卡' : '创建每日打卡')}<main className="space-y-4 px-4 pb-8"><Glass className="p-5"><div className="mb-5 flex items-center gap-3"><div className={`h-16 w-16 rounded-2xl ${taskType === 'TEN_K_HOURS' ? 'bg-violet-100' : taskType === 'DAILY_COUNT' ? 'bg-amber-100' : 'bg-cyan-100'}`} /><div><h2 className="text-xl font-black">创建任务</h2><p className="mt-1 text-xs text-slate-500">先选类型，之后可以随时进入分析页。</p></div></div><div className="grid grid-cols-3 gap-2"><button type="button" onClick={() => setTaskType('DAILY_HABIT')} className={`rounded-2xl border p-3 text-left ${taskType === 'DAILY_HABIT' ? 'border-cyan-400 bg-cyan-50/70' : 'border-white/70 bg-white/45'}`}><CheckCircle size={20} className="text-cyan-600" /><div className="mt-2 text-xs font-black">每日打卡</div><p className="mt-1 text-[10px] text-slate-500">按时长</p></button><button type="button" onClick={() => setTaskType('DAILY_COUNT')} className={`rounded-2xl border p-3 text-left ${taskType === 'DAILY_COUNT' ? 'border-amber-400 bg-amber-50/70' : 'border-white/70 bg-white/45'}`}><Check size={20} className="text-amber-600" /><div className="mt-2 text-xs font-black">按次打卡</div><p className="mt-1 text-[10px] text-slate-500">记录次数</p></button><button type="button" onClick={() => setTaskType('TEN_K_HOURS')} className={`rounded-2xl border p-3 text-left ${taskType === 'TEN_K_HOURS' ? 'border-violet-400 bg-violet-50/70' : 'border-white/70 bg-white/45'}`}><Trophy size={20} className="text-violet-600" /><div className="mt-2 text-xs font-black">一万小时</div><p className="mt-1 text-[10px] text-slate-500">长期成长</p></button></div></Glass><Glass className="space-y-4 p-5"><label className="block"><span className="mb-2 block text-sm font-bold">标题</span><input autoFocus value={taskName} onChange={event => setTaskName(event.target.value)} placeholder={taskType === 'TEN_K_HOURS' ? '例如：学英语、练琴' : '例如：阅读、运动、背单词'} className="w-full rounded-2xl border border-white/80 bg-white/70 px-4 py-3 text-base outline-none placeholder:text-slate-400" /></label><label className="block"><span className="mb-2 block text-sm font-bold">备注</span><textarea value={taskNote} onChange={event => setTaskNote(event.target.value)} placeholder="写一些鼓励自己的话吧（可选）" className="min-h-24 w-full resize-none rounded-2xl border border-white/80 bg-white/70 px-4 py-3 text-sm outline-none placeholder:text-slate-400" /></label>{taskType === 'DAILY_HABIT' && <label className="flex items-center justify-between rounded-2xl bg-white/55 px-4 py-3"><span className="text-sm font-bold">每次目标</span><span className="flex items-center gap-2"><input type="number" min={1} max={240} value={taskTargetMinutes} onChange={event => setTaskTargetMinutes(clamp(Number(event.target.value) || 1, 1, 240))} className="w-16 rounded-xl bg-white/80 px-2 py-2 text-center outline-none" /><span className="text-sm text-slate-500">分钟</span></span></label>}{taskType === 'DAILY_COUNT' && <label className="flex items-center justify-between rounded-2xl bg-white/55 px-4 py-3"><span className="text-sm font-bold">每日目标次数</span><span className="flex items-center gap-2"><input type="number" min={1} max={100} value={taskTargetCount} onChange={event => setTaskTargetCount(clamp(Number(event.target.value) || 1, 1, 100))} className="w-16 rounded-xl bg-white/80 px-2 py-2 text-center outline-none" /><span className="text-sm text-slate-500">次</span></span></label>}{taskType === 'TEN_K_HOURS' && <div className="rounded-2xl bg-violet-50/70 p-4 text-sm text-violet-800"><div className="font-bold">目标：10,000 小时</div><div className="mt-1 text-xs text-violet-600">每次专注都会自动累计到这个长期计划。</div></div>}</Glass><button type="button" onClick={() => void createTask()} className="w-full rounded-full bg-blue-500 py-4 text-base font-black text-white shadow-xl shadow-blue-300/30">创建任务</button></main></div></>;

  const renderDetailLegacy = () => {
    const detailTask = analysisTaskId ? tasks.find(task => task.id === analysisTaskId) : undefined;
    const totalSeconds = taskSessions.reduce((sum, session) => sum + session.durationSeconds, 0);
     return <><div className="flex-1 overflow-y-auto">{renderHeader(detailTask?.name || '全部专注数据')}<main className="space-y-4 px-4 pb-8"><Glass className="p-5"><div className="flex items-start justify-between"><div>{detailTask ? <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${typeAccent(detailTask.type)}`}>{typeLabel(detailTask.type)}</span> : <span className="rounded-full bg-blue-100/70 px-2.5 py-1 text-[10px] font-bold text-blue-700">全部任务</span>}<h2 className="mt-3 text-2xl font-black">{detailTask ? `${detailTask.name} · 专注分析` : '分析所有专注数据'}</h2></div><button type="button" onClick={() => { if (detailTask) { setSelectedTaskId(detailTask.id); setView('timer'); } else setView('home'); }} aria-label={detailTask ? '开始专注' : '返回任务'} className="rounded-full bg-blue-500 p-3 text-white">{detailTask ? <Play size={18} weight="fill" /> : <ArrowLeft size={18} />}</button></div><div className="mt-5 grid grid-cols-3 gap-2"><div className="rounded-2xl bg-white/60 p-3"><p className="text-[10px] text-slate-500">累计专注</p><p className="mt-1 text-base font-black">{formatHours(totalSeconds)}</p></div><div className="rounded-2xl bg-white/60 p-3"><p className="text-[10px] text-slate-500">完成次数</p><p className="mt-1 text-base font-black">{taskSessions.length}</p></div><div className="rounded-2xl bg-white/60 p-3"><p className="text-[10px] text-slate-500">今日</p><p className="mt-1 text-base font-black">{formatTimer(detailTask ? (todayByTask[detailTask.id] || 0) : todaySeconds)}</p></div></div></Glass><Glass className="p-5"><div className="flex items-center justify-between"><div><h3 className="font-black">专注趋势</h3><p className="mt-1 text-[11px] text-slate-500">按时间范围查看投入变化</p></div><div className="flex rounded-full bg-white/70 p-1 text-[11px] font-bold">{(['week', 'month', 'year'] as DetailRange[]).map(item => <button type="button" key={item} onClick={() => setRange(item)} className={`rounded-full px-2.5 py-1.5 ${range === item ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>{item === 'week' ? '周' : item === 'month' ? '月' : '年'}</button>)}</div></div><div className="mt-5 flex h-32 items-end gap-2">{trend.map(item => <div key={item.label} className="flex min-w-0 flex-1 flex-col items-center gap-1"><div className="flex h-24 w-full items-end"><div className="w-full rounded-t-lg bg-gradient-to-t from-cyan-500 to-blue-400" style={{ height: `${Math.max(item.seconds ? 8 : 3, item.seconds / maxTrend * 100)}%` }} /></div><span className="truncate text-[9px] text-slate-400">{item.label}</span></div>)}</div></Glass><Glass className="p-5"><div className="flex items-center justify-between"><h3 className="font-black">专注热力</h3><span className="text-[11px] text-slate-500">近 {detailDays} 天</span></div><div className="mt-4 flex items-center justify-center overflow-x-auto rounded-2xl bg-white/30 px-3 py-4" style={{ minHeight: heatmapMinHeight }}><div className="grid shrink-0 gap-1.5" style={{ gridTemplateColumns: `repeat(7, ${heatmapCellSize}px)`, gridAutoRows: `${heatmapCellSize}px` }}>{heatmap.map(item => <div key={item.key} title={`${item.key} ${formatTimer(item.seconds)}`} className="rounded-[5px]" style={{ width: heatmapCellSize, height: heatmapCellSize, background: item.seconds ? `rgba(6,182,212,${0.22 + item.seconds / maxHeat * 0.7})` : 'rgba(255,255,255,.72)' }} />)}</div></div></Glass><Glass className="p-5"><div className="mb-3 flex items-center justify-between"><h3 className="font-black">专注记录</h3><span className="text-[11px] text-slate-500">{taskSessions.length} 条</span></div><div className="space-y-2">{taskSessions.slice(0, 12).map(session => <div key={session.id} className="rounded-2xl bg-white/55 p-3"><div className="flex items-center justify-between text-xs"><span className="font-bold">{dateLabel(session.startTime)} · {session.mode === 'COUNTDOWN' ? '倒计时' : '正计时'}</span><span className="font-mono font-bold text-cyan-700">{formatTimer(session.durationSeconds)}</span></div>{session.note && <p className="mt-2 text-xs leading-relaxed text-slate-500">“{session.note}”</p>}</div>)}{taskSessions.length === 0 && <p className="py-5 text-center text-sm text-slate-500">还没有专注记录，去完成第一段吧。</p>}</div></Glass>{detailTask && <button type="button" onClick={() => void deleteTask(detailTask)} className="w-full rounded-full border border-red-200 bg-red-50/60 py-3 text-sm font-bold text-red-600">删除任务</button>}</main></div></>;
  };

  const renderDetail = () => {
    const detailTask = analysisTaskId ? tasks.find(task => task.id === analysisTaskId) : undefined;
    const totalSeconds = taskSessions.reduce((sum, session) => sum + session.durationSeconds, 0);
    const trendTotal = trend.reduce((sum, item) => sum + item.seconds, 0);
    return <div className="flex-1 overflow-y-auto">
      {renderHeader(detailTask?.name || '专注数据')}
      <main className="space-y-3 px-4 pb-8">
        <section className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-blue-600 via-blue-500 to-indigo-500 p-5 text-white shadow-[0_18px_42px_-22px_rgba(37,99,235,.8)]">
          <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10" />
          <div className="relative flex items-start justify-between gap-3">
            <div><p className="text-[11px] font-bold text-white/70">{detailTask ? `${detailTask.name} · 累计专注` : '全部专注 · 累计时长'}</p><p className="mt-2 text-3xl font-black tabular-nums">{formatHours(totalSeconds)}</p></div>
            <button type="button" onClick={() => detailTask ? (setSelectedTaskId(detailTask.id), setView('timer')) : setView('home')} className="rounded-2xl bg-white/18 p-3 text-white"><Play size={19} weight="fill" /></button>
          </div>
          <div className="relative mt-5 grid grid-cols-2 border-t border-white/20 pt-3 text-xs"><div><p className="text-white/60">完成次数</p><p className="mt-1 text-base font-black">{taskSessions.length} 次</p></div><div className="border-l border-white/20 pl-4"><p className="text-white/60">今日专注</p><p className="mt-1 text-base font-black">{formatTimer(detailTask ? (todayByTask[detailTask.id] || 0) : todaySeconds)}</p></div></div>
        </section>

        <Glass className="p-4">
          <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-black">专注时长趋势</h3><p className="mt-1 text-[11px] text-slate-500">本周期共 {formatHours(trendTotal)}</p></div><div className="flex rounded-xl bg-slate-100 p-1 text-[11px] font-bold">{(['week', 'month', 'year'] as DetailRange[]).map(item => <button type="button" key={item} onClick={() => setRange(item)} className={`rounded-lg px-2.5 py-1.5 transition ${range === item ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}>{item === 'week' ? '周' : item === 'month' ? '月' : '年'}</button>)}</div></div>
          <FocusTrendChart data={trend} />
        </Glass>

        <Glass className="p-4">
          <div className="flex items-center justify-between"><div><h3 className="text-sm font-black">年度完成热力图</h3><p className="mt-1 text-[11px] text-slate-500">每格代表一天，颜色越深投入越多</p></div><span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold text-blue-600">近 {detailDays} 天</span></div>
          <FocusHeatmap data={heatmap} />
        </Glass>

        <Glass className="p-4">
          <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-black">最近专注</h3><span className="text-[11px] text-slate-400">{taskSessions.length} 条记录</span></div>
          <div className="space-y-2">{taskSessions.slice(0, 8).map(session => <div key={session.id} className="flex items-center gap-3 rounded-2xl bg-slate-50/85 px-3 py-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-100 text-blue-600"><Timer size={16} weight="bold" /></span><div className="min-w-0 flex-1"><p className="text-xs font-bold">{dateLabel(session.startTime)} · {session.mode === 'COUNTDOWN' ? '倒计时' : '正计时'}</p><p className="mt-0.5 truncate text-[10px] text-slate-400">{session.note || '完成了一段专注'}</p></div><span className="text-xs font-black tabular-nums text-blue-600">{formatTimer(session.durationSeconds)}</span></div>)}{taskSessions.length === 0 && <p className="py-6 text-center text-xs text-slate-400">还没有专注记录，开始第一段吧。</p>}</div>
        </Glass>
      </main>
    </div>;
  };

  const renderArchive = () => <><div className="flex-1 overflow-y-auto">{renderHeader('归档箱')}<main className="space-y-3 px-4 pb-8">{tasks.filter(task => task.archived).map(task => <Glass key={task.id} className="p-4"><div className="flex items-center justify-between"><div><h3 className="font-black">{task.name}</h3><p className="mt-1 text-xs text-slate-500">{typeLabel(task.type)} · 已完成</p></div><button type="button" onClick={() => openTask(task)} className="rounded-full bg-white/70 px-3 py-1.5 text-xs font-bold text-slate-600">查看分析</button></div></Glass>)}{tasks.filter(task => task.archived).length === 0 && <Glass className="p-6 text-center"><Archive size={28} className="mx-auto text-slate-400" /><p className="mt-2 text-sm font-bold">归档箱还是空的</p><p className="mt-1 text-xs text-slate-500">在任务卡片右滑即可完成并归档。</p></Glass>}</main></div></>;

  const renderCharactersLegacy = () => <></>;

  const renderCharacters = () => {
    const previewCharacter = characters.find(character => character.id === focusCharacterId) || activeCharacter;
    const previewConfig = previewCharacter?.videoAvatar?.format === 'live2d' ? previewCharacter.videoAvatar as Live2DAvatarConfig : null;
    return <div className="flex-1 overflow-y-auto">
      {renderHeader('选择监督角色', 'timer')}
      <main className="space-y-3 px-4 pb-8">
        <section className="relative h-52 overflow-hidden rounded-[28px] bg-slate-900">
          {previewConfig ? <Live2DAvatarCanvas config={previewConfig} motionState="thinking" audioFeed={audioFeed} preserveActiveWardrobe ambientAutonomyDisabled maxFps={24} /> : <div className="flex h-full flex-col items-center justify-center text-slate-400"><UserCircle size={42} weight="duotone" /><p className="mt-2 text-xs">请选择带 Live2D 标记的角色</p></div>}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/75 to-transparent px-4 pb-3 pt-8 text-white"><p className="text-xs text-white/60">预览中</p><p className="text-base font-black">{previewCharacter?.name || '还未选择角色'}</p></div>
        </section>
        <p className="px-1 text-[11px] text-slate-500">选择后立即预览；确认后返回专注室，不需要先开始计时。</p>
        <div className="grid grid-cols-2 gap-2">{characters.map(character => {
          const hasLive2D = character.videoAvatar?.format === 'live2d';
          const selected = character.id === focusCharacterId;
          return <button type="button" key={character.id} disabled={!hasLive2D} onClick={() => { setFocusCharacterId(character.id); try { localStorage.setItem('focus_companion_character_id', character.id); } catch { /* private mode */ } }} className={`rounded-2xl border p-3 text-left transition ${selected ? 'border-blue-500 bg-blue-50 shadow-sm' : hasLive2D ? 'border-white/80 bg-white/65' : 'border-transparent bg-slate-100/60 opacity-55'}`}><div className="flex items-center gap-2"><img src={character.avatar} alt="" className="h-10 w-10 rounded-xl object-cover" /><div className="min-w-0"><p className="truncate text-xs font-black">{character.name}</p><p className={`mt-1 text-[10px] font-bold ${hasLive2D ? 'text-emerald-600' : 'text-slate-400'}`}>{hasLive2D ? 'LIVE2D' : '暂不可预览'}</p></div></div></button>;
        })}</div>
        <button type="button" onClick={() => setView('timer')} className="w-full rounded-2xl bg-blue-600 py-3 text-sm font-black text-white">使用这位角色</button>
      </main>
    </div>;
  };

  // Once the first DB snapshot is available, keep the shell mounted during
  // later refreshes. Replacing the whole tree with a loading screen causes a
  // visible flash and destroys the Live2D canvas while the timer is running.
  if (isLoading && !hasLoadedRef.current) return <div className="flex h-full items-center justify-center bg-[#e9effb] text-sm text-slate-500">正在打开你的专注空间…</div>;
  return <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_15%_10%,rgba(255,255,255,.85),transparent_35%),linear-gradient(145deg,#dce8ff,#f0e4f8_46%,#d8f0ec)] text-slate-800">{view === 'home' && renderHome()}{view === 'timer' && renderTimer()}{view === 'create' && renderCreate()}{view === 'detail' && renderDetail()}{view === 'archive' && renderArchive()}{view === 'characters' && renderCharacters()}{noteOpen && pendingSession && <div className="absolute inset-0 z-40 flex items-end justify-center bg-slate-900/25 p-4 backdrop-blur-sm"><div className="w-full max-w-md rounded-[28px] border border-white/80 bg-white/90 p-5 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">Session complete</p><h2 className="mt-1 text-xl font-black">写下一句想法？</h2></div><button type="button" onClick={() => void savePendingSession('')} aria-label="关闭" className="rounded-full bg-slate-100 p-2 text-slate-500"><X size={16} /></button></div><p className="mt-3 text-sm text-slate-500">{formatTimer(pendingSession.durationSeconds)} 已保存到「{tasks.find(task => task.id === pendingSession.taskId)?.name || '任务'}」。笔记不是必填。</p><textarea autoFocus value={noteDraft} onChange={event => setNoteDraft(event.target.value)} placeholder="今天的状态、完成了什么、下次想怎么做……" className="mt-4 min-h-28 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none placeholder:text-slate-400" /><div className="mt-4 flex gap-2"><button type="button" onClick={() => void savePendingSession('')} className="flex-1 rounded-full border border-slate-200 bg-white py-3 text-sm font-bold text-slate-600">跳过</button><button type="button" onClick={() => void savePendingSession(noteDraft)} className="flex-1 rounded-full bg-blue-500 py-3 text-sm font-bold text-white">保存笔记</button></div></div></div>}</div>;
};

export default FocusCompanionApp;


