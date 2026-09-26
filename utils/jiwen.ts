/**
 * 积温（Jiwen）主动意识引擎的 SullyOS 适配版。
 *
 * 上游项目： https://github.com/ClaraShafiq/jiwen
 * 上游是零依赖 JavaScript；这里保留它的核心五轴模型，并改成 TypeScript
 * 模块，方便浏览器端直接使用。它只计算状态，不调用模型，也不发送消息。
 */

export type JiwenAction = 'contact' | 'find_activity' | 'observation';
export type JiwenUserStatus = 'active' | 'busy' | 'away' | 'sleeping';

export interface JiwenState {
  connection: number;
  pride: number;
  valence: number;
  arousal: number;
  immersion: number;
  lastActivity: { type: string; label?: string; at: string } | null;
  lastTick: string | null;
  userStatus: JiwenUserStatus;
}

/** 可安全放进 fire_pack 的角色级配置；运行时状态单独由 worker 保存。 */
export interface JiwenConfig {
  enabled: boolean;
  pride?: number;
  connectionRate?: number;
  forceContact?: number;
  initialState?: Partial<JiwenState>;
}

export interface JiwenOptions {
  initialState?: Partial<JiwenState>;
  rates?: Partial<{
    connectionGrowth: number;
    immersionDecay: number;
    prideRegress: number;
    valenceRegress: number;
    valenceSetpoint: number;
    arousalRegress: number;
    arousalSetpoint: number;
    arousalConnectionRiseThreshold: number;
    arousalConnectionRiseRate: number;
    activityConnectionRelief: number;
    immersionDampenConnection: number;
    prideDefendThreshold: number;
    prideDefendTarget: number;
    prideDefendRate: number;
  }>;
  thresholds?: Partial<{
    observation: number;
    considerContact: number;
    forceContact: number;
    prideBlock: number;
    valenceActivity: number;
    arousalAgitation: number;
  }>;
  persona?: { subjectName?: string; subjectPronoun?: string };
  getLastMessage?: () => { content?: string; timestamp?: number } | null;
  onLoad?: () => JiwenState | null | Promise<JiwenState | null>;
  onSave?: (state: JiwenState) => void | Promise<void>;
  connectionRateFn?: (lastMessage: { content?: string; timestamp?: number } | null) => number;
}

export interface JiwenEngine {
  tick(minutes: number): Promise<Array<{ action: JiwenAction; urgency?: number; forced?: boolean; reason?: string }>>;
  applyDelta(delta: Partial<Pick<JiwenState, 'connection' | 'pride' | 'valence' | 'arousal'>>): Promise<void>;
  resetConnection(): Promise<void>;
  setActivity(type: string, label?: string): Promise<void>;
  getState(): Promise<JiwenState>;
  getPromptContext(): string;
  getStyleGuidance(): string;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function createJiwen(opts: JiwenOptions): JiwenEngine {
  const rates = {
    connectionGrowth: 0.0007,
    immersionDecay: 0.01,
    prideRegress: 0.003,
    valenceRegress: 0.005,
    valenceSetpoint: 0,
    arousalRegress: 0.005,
    arousalSetpoint: 0,
    arousalConnectionRiseThreshold: 1,
    arousalConnectionRiseRate: 0.002,
    activityConnectionRelief: 0,
    immersionDampenConnection: 1,
    prideDefendThreshold: 1,
    prideDefendTarget: 0.5,
    prideDefendRate: 0.003,
    ...opts.rates,
  };
  const thresholds = {
    observation: 0.2,
    considerContact: 0.35,
    forceContact: 0.5,
    prideBlock: 0.5,
    valenceActivity: -1,
    arousalAgitation: 0.7,
    ...opts.thresholds,
  };
  const persona = { subjectName: '对方', subjectPronoun: 'ta', ...opts.persona };
  const defaults: JiwenState = {
    connection: 0, pride: 0, valence: 0, arousal: 0, immersion: 0,
    lastActivity: null, lastTick: null, userStatus: 'active',
  };
  let state: JiwenState = { ...defaults, ...opts.initialState };
  let loaded = false;

  const load = async () => {
    if (loaded) return;
    const saved = await opts.onLoad?.();
    if (saved) state = { ...defaults, ...saved };
    loaded = true;
  };
  const save = async () => { await opts.onSave?.({ ...state }); };

  const check = () => {
    const result: Array<{ action: JiwenAction; urgency?: number; forced?: boolean; reason?: string }> = [];
    if (state.connection >= thresholds.observation && state.connection < thresholds.considerContact) {
      result.push({ action: 'observation', urgency: (state.connection - thresholds.observation) / (thresholds.considerContact - thresholds.observation) });
    }
    if (state.connection >= thresholds.considerContact && state.connection < thresholds.forceContact) {
      if (state.pride >= thresholds.prideBlock && state.immersion < 0.2) result.push({ action: 'find_activity', reason: 'pride_block' });
      else if (state.pride < thresholds.prideBlock) result.push({ action: 'contact', urgency: state.connection - 0.3 });
    }
    if (state.connection >= thresholds.forceContact) result.push({ action: 'contact', urgency: 1, forced: true });
    if (state.valence <= thresholds.valenceActivity || state.arousal >= thresholds.arousalAgitation) {
      if (!result.some((x) => x.action === 'contact')) result.push({ action: 'find_activity', reason: 'mood' });
    }
    return result;
  };

  return {
    async tick(minutes) {
      await load();
      const mins = Math.max(0, Math.min(minutes, 60));
      if (!mins) return [];
      const last = opts.getLastMessage?.() ?? null;
      const baseRate = opts.connectionRateFn?.(last) ?? rates.connectionGrowth;
      const immersionFactor = Math.max(0, 1 - state.immersion * rates.immersionDampenConnection);
      state.connection = clamp(state.connection + baseRate * mins * immersionFactor, 0, 1);
      state.immersion = Math.max(0, state.immersion - rates.immersionDecay * mins);
      const prideTarget = state.connection >= rates.prideDefendThreshold ? rates.prideDefendTarget : 0;
      state.pride += clamp(prideTarget - state.pride, -rates.prideRegress * mins, rates.prideDefendRate * mins);
      state.valence += clamp(rates.valenceSetpoint - state.valence, -rates.valenceRegress * mins, rates.valenceRegress * mins);
      const arousalTarget = rates.arousalSetpoint + (state.connection >= rates.arousalConnectionRiseThreshold ? 0.2 : 0);
      state.arousal += clamp(arousalTarget - state.arousal, -rates.arousalRegress * mins, rates.arousalConnectionRiseRate * mins);
      state.lastTick = new Date().toISOString();
      const triggers = check();
      await save();
      return triggers;
    },
    async applyDelta(delta) {
      await load();
      for (const key of ['connection', 'pride', 'valence', 'arousal'] as const) {
        const value = delta[key];
        if (typeof value === 'number') state[key] = clamp(state[key] + value, key === 'connection' ? 0 : -1, 1);
      }
      await save();
    },
    async resetConnection() { await load(); state.connection = 0; await save(); },
    async setActivity(type, label) {
      await load();
      const same = state.lastActivity?.type === type;
      state.lastActivity = { type, label, at: new Date().toISOString() };
      state.immersion = type === 'reading' ? 0.6 : type === 'search' ? 0.4 : 0.25;
      if (!same && rates.activityConnectionRelief > 0) state.connection = Math.max(0.01, state.connection - rates.activityConnectionRelief);
      await save();
    },
    async getState() { await load(); return { ...state }; },
    getPromptContext() {
      const c = state.connection, p = state.pride, v = state.valence, a = state.arousal;
      const parts = [c < 0.2 ? `刚和${persona.subjectName}聊完不久，没什么挂念的。` : c < 0.35 ? `有一会儿没听到${persona.subjectName}的动静了，但还不着急。` : c < 0.5 ? `${persona.subjectName}好一阵子没说话了。开始在想${persona.subjectPronoun}在干嘛。` : `${persona.subjectName}很久没动静了。有点在意——${persona.subjectPronoun}去哪了？`];
      parts.push(p > 0.5 ? '不想显得太主动。' : p > 0.3 ? '有一点端着，但也不是不能开口。' : '基本不设防。');
      if (v < -0.3 && a > 0.3) parts.push('烦躁不安，坐不住。'); else if (v < -0.3) parts.push('情绪低沉，不想多解释。'); else if (v > 0.3) parts.push('心情还不错。');
      if (state.immersion > 0.3 && state.lastActivity) parts.push(`刚才在${state.lastActivity.type}${state.lastActivity.label ? `（${state.lastActivity.label}）` : ''}。`);
      return parts.join('\n');
    },
    getStyleGuidance() {
      const rules = [state.pride > 0.5 ? `- 嘴硬。想找${persona.subjectName}也别直接承认，找个自然的借口。` : '- 语气自然，不必刻意克制。'];
      if (state.connection > 0.4) rules.push(`- ${persona.subjectName}很久没动静了，可以透露一点想念，但不要长篇解释。`);
      if (state.valence < -0.3) rules.push('- 心情不太好，句子短一些。');
      return rules.join('\n');
    },
  };
}
