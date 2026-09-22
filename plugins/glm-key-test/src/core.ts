/**
 * 智谱 GLM Coding Plan Key 测试核心逻辑。
 *
 * 端点（官方文档 docs.bigmodel.cn/cn/coding-plan/quick-start）：
 *   - OpenAI Chat Completion 协议: https://open.bigmodel.cn/api/coding/paas/v4
 *   - Anthropic Message 协议:      https://open.bigmodel.cn/api/anthropic
 * 认证：Authorization: Bearer <key>（Coding Plan Key，非 JWT，无需签名）。
 *
 * 出站请求统一走 httpRequest：优先经宿主原语 net_http_request（commands/net.rs，
 * 系统代理→直连回退）。原因：智谱 OpenAI 端点支持 CORS（WebView 可直连），但
 * Anthropic 端点 /api/anthropic/* 的预检不带任何 CORS 头，WebView 直连必被拦
 * （Failed to fetch）——只能经宿主转发。纯浏览器 dev 与老宿主（<0.2.7，无此
 * 命令）回退直接 fetch，届时 Anthropic 协议不可用并给出升级提示。
 *
 * 测试策略（v1.9 起，无协议选择）：Anthropic 协议优先（Coding Plan 的主用法，
 * 如 Claude Code），失败自动以 OpenAI 协议兜底重试一次；两次请求合并为一条
 * 记录——最终结果 + 过程备注（note 记录前次失败原因）。
 */

import { invoke } from "@tauri-apps/api/core";

export const PROTOCOLS = ["openai", "anthropic"] as const;
export type Protocol = (typeof PROTOCOLS)[number];

export const BASE_URLS: Record<Protocol, string> = {
  openai: "https://open.bigmodel.cn/api/coding/paas/v4",
  anthropic: "https://open.bigmodel.cn/api/anthropic",
};

/** 模型不内置：默认留空，由「获取模型列表」拉取后选择或手输。 */
export const DEFAULT_MODEL = "";
/** 最简测试消息：要求一个字的回复，省 token 且便于断言。 */
export const TEST_PROMPT = "请只回复：OK";

export interface KeyEntry {
  /** key 名称（用户可改，用于区分测试结果）。 */
  name: string;
  /** key 本体。 */
  key: string;
}

export interface TestConfig {
  key: string;
  /** 记录归属的 key 名称（写入 TestRecord.keyName）。 */
  keyName: string;
  model: string;
}

export interface TestRecord {
  /** 测试发起时间（epoch ms）。 */
  at: number;
  /** 耗时 ms。 */
  elapsedMs: number;
  ok: boolean;
  /** HTTP 429：key 认证通过但触发限额/频控（ok=false，但 key 本身有效）。 */
  limited?: boolean;
  /** 成功时的模型回复文本。 */
  reply?: string;
  /** usage（成功时尽力提取）。 */
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  /** 失败时的错误摘要（HTTP 状态 + 服务端 message）。 */
  error?: string;
  /** 触发方式：手动 / 定时。 */
  trigger: "manual" | "scheduled";
  /** 测试的 key 名称（历史筛选依据）。 */
  keyName: string;
  model: string;
  /** 最终判定所依据的协议（成功者；双败时为最后尝试的 openai）。 */
  protocol: Protocol;
  /** 过程备注：Anthropic 失败、OpenAI 兜底成功时记录前次失败原因。 */
  note?: string;
}

/* ---- 请求与解析 ---- */

interface ZhipuApiError {
  error?: { code?: string | number; message?: string };
}

function extractApiError(status: number, body: string, statusText: string): string {
  let msg = "";
  let code: string | number | undefined;
  try {
    const parsed = JSON.parse(body) as ZhipuApiError & { msg?: string };
    msg = parsed.error?.message ?? parsed.msg ?? "";
    code = parsed.error?.code;
  } catch {
    /* 非 JSON 响应，直接展示截断文本 */
  }
  if (!msg) msg = body.slice(0, 300) || statusText || "(空响应体)";
  const codePart = code !== undefined ? ` [${code}]` : "";
  return `HTTP ${status}${codePart}：${msg}`;
}

/**
 * 429 = key 认证通过、计费主体存在，只是触发限额/频控（如 Coding Plan 的
 * 5 小时窗口上限）。此时 key 本身是有效的，与 401（key 错误）有本质区别。
 */
function isLimited(status: number): boolean {
  return status === 429;
}

function requestTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, cancel: () => clearTimeout(timer) };
}

/* ---- 出站请求统一出口：宿主原语优先，fetch 回退 ---- */

/** 宿主 net_http_request 原语的返回（commands/net.rs HttpResult）。 */
interface HostHttpResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

function hasHostIpc(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * 出站 HTTP：优先 invoke 宿主原语 net_http_request（绕开 CORS、系统代理→直连
 * 回退）；无 Tauri IPC（纯浏览器 dev）或老宿主未注册该命令（<0.2.7）时回退
 * 直接 fetch。fetch 路径的 AbortError 统一转成超时文案。
 */
async function httpRequest(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }
): Promise<{ status: number; text: string }> {
  const timeoutMs = init.timeoutMs ?? 30_000;
  if (hasHostIpc()) {
    try {
      const r = await invoke<HostHttpResult>("net_http_request", {
        opts: {
          url,
          method: init.method ?? "GET",
          headers: init.headers ?? {},
          body: init.body ?? null,
          timeoutMs,
        },
      });
      return { status: r.status, text: r.body };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 提及命令名 = 老宿主未注册（<0.2.7）→ 回退 fetch（Anthropic 端点将得到
      // CORS 错误，runTest 会附升级提示）；其余为真实请求失败（中文错误链），上抛。
      if (!msg.includes("net_http_request")) throw new Error(msg);
    }
  }
  const { signal, cancel } = requestTimeout(timeoutMs);
  try {
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: init.headers,
      body: init.body,
      signal,
    });
    return { status: res.status, text: await res.text() };
  } catch (e) {
    const err = e as { name?: string };
    if (err?.name === "AbortError") {
      throw new Error(`请求超时（${Math.round(timeoutMs / 1000)}s）`);
    }
    throw e;
  } finally {
    cancel();
  }
}

/** 单协议一次尝试的结果（runTest 的内部步骤，永不抛异常）。 */
interface AttemptResult {
  ok: boolean;
  limited?: boolean;
  reply?: string;
  usage?: TestRecord["usage"];
  error?: string;
}

/** 按指定协议发起一次最简对话，永不抛异常——失败信息收纳在 error。 */
async function attemptOnce(key: string, model: string, protocol: Protocol): Promise<AttemptResult> {
  const url =
    protocol === "anthropic"
      ? `${BASE_URLS.anthropic}/v1/messages`
      : `${BASE_URLS.openai}/chat/completions`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
  if (protocol === "anthropic") headers["anthropic-version"] = "2023-06-01";
  // 推理模型（glm-5.3）的思考也计入输出预算：给足余量避免
  // reasoning 吃光 token 后 content 为空。
  const payload =
    protocol === "anthropic"
      ? { model, max_tokens: 512, messages: [{ role: "user", content: TEST_PROMPT }] }
      : { model, messages: [{ role: "user", content: TEST_PROMPT }], max_tokens: 512 };

  try {
    const { status, text } = await httpRequest(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      timeoutMs: 30_000,
    });

    if (status < 200 || status >= 300) {
      return { ok: false, limited: isLimited(status), error: extractApiError(status, text, "") };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { ok: false, error: `响应不是合法 JSON：${text.slice(0, 300)}` };
    }

    /* Anthropic: {content: [{type:"text", text}], usage:{input_tokens, output_tokens}} */
    let reply = "";
    let usage: TestRecord["usage"];
    if (protocol === "anthropic") {
      const content = parsed.content;
      if (Array.isArray(content)) {
        reply = content
          .map((c) => ((c as { text?: string }).text ?? "").trim())
          .filter(Boolean)
          .join("\n");
      }
      const u = parsed.usage as
        | { input_tokens?: number; output_tokens?: number }
        | undefined;
      if (u) {
        usage = {
          promptTokens: u.input_tokens,
          completionTokens: u.output_tokens,
          totalTokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
        };
      }
    } else {
      /* OpenAI: {choices: [{message: {content, reasoning_content}}], usage:{...}}
       * glm-5.3 是推理模型：max_tokens 太小时预算可能全部耗在 reasoning_content，
       * content 为空字符串——这是"key 可用"的有效证据，不能判为失败。 */
      const choices = parsed.choices;
      if (Array.isArray(choices) && choices.length > 0) {
        const msg = (choices[0] as {
          message?: { content?: unknown; reasoning_content?: unknown };
        }).message;
        const c = msg?.content;
        if (typeof c === "string") reply = c.trim();
        if (!reply && typeof msg?.reasoning_content === "string") {
          reply = `（模型思考中，无正文输出）${msg.reasoning_content.trim().slice(0, 200)}`;
        }
      }
      const u = parsed.usage as
        | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
        | undefined;
      if (u) {
        usage = {
          promptTokens: u.prompt_tokens,
          completionTokens: u.completion_tokens,
          totalTokens: u.total_tokens,
        };
      }
    }

    if (!reply) {
      // 附上原始响应片段辅助排查（截断），避免只有一句模糊描述。
      return { ok: false, error: `请求成功但未解析到回复文本：${text.slice(0, 300)}` };
    }
    return { ok: true, reply, usage };
  } catch (e) {
    const err = e as { name?: string; message?: string };
    let reason = err?.message || String(e);
    // fetch 回退路径（浏览器 dev / 老宿主）下，Anthropic 端点因无 CORS 必被拦。
    if (protocol === "anthropic" && /Failed to fetch|Load failed/i.test(reason)) {
      reason += "（该端点未开 CORS：需 ToolBox ≥ 0.2.7 经宿主转发，当前环境回退了直连）";
    }
    return { ok: false, error: `网络错误：${reason}` };
  }
}

/**
 * 测试一个 key：Anthropic 协议优先，失败自动以 OpenAI 协议兜底重试一次。
 * 两次请求合并为一条记录——最终结果 + 过程备注（note 记录前次失败原因）。
 * 永不抛异常。
 */
export async function runTest(
  cfg: TestConfig,
  trigger: TestRecord["trigger"] = "manual"
): Promise<TestRecord> {
  const key = cfg.key.trim();
  const started = Date.now();
  const base: Omit<
    TestRecord,
    "ok" | "elapsedMs" | "limited" | "reply" | "usage" | "error" | "note"
  > = {
    at: started,
    trigger,
    keyName: cfg.keyName,
    model: cfg.model,
    protocol: "anthropic",
  };

  if (!key) {
    return { ...base, ok: false, elapsedMs: 0, error: "未填写 API Key" };
  }
  if (!cfg.model.trim()) {
    return { ...base, ok: false, elapsedMs: 0, error: "未填写模型名（可点「获取模型列表」后选择）" };
  }

  const first = await attemptOnce(key, cfg.model, "anthropic");
  if (first.ok) {
    return {
      ...base,
      ok: true,
      elapsedMs: Date.now() - started,
      reply: first.reply,
      usage: first.usage,
    };
  }

  const second = await attemptOnce(key, cfg.model, "openai");
  const elapsedMs = Date.now() - started;
  if (second.ok) {
    return {
      ...base,
      protocol: "openai",
      ok: true,
      elapsedMs,
      reply: second.reply,
      usage: second.usage,
      note: `Anthropic 失败（${first.error ?? "未知错误"}），OpenAI 协议兜底成功`,
    };
  }
  return {
    ...base,
    protocol: "openai",
    ok: false,
    // 任一端 429 都说明 key 认证通过（只是限额/频控），保留「限额中」语义。
    limited: first.limited || second.limited,
    elapsedMs,
    error: `Anthropic: ${first.error ?? "失败"}｜OpenAI: ${second.error ?? "失败"}`,
  };
}

/* ---- 模型列表（OpenAI 兼容 /v1/models；Anthropic 端点同构 data[].id） ---- */

export interface ModelsResult {
  ok: boolean;
  models: string[];
  /** 实际命中的端点说明（失败时为空）。 */
  source?: string;
  error?: string;
}

/** 拉取模型列表：Anthropic 端点优先，失败自动换 OpenAI 端点（key 可能受端点限制）。 */
export async function fetchModels(key: string): Promise<ModelsResult> {
  const k = key.trim();
  if (!k) return { ok: false, models: [], error: "未填写 API Key，无法获取模型列表" };

  const tries: Array<{ url: string; label: string; anthropic: boolean }> = [
    { url: `${BASE_URLS.anthropic}/v1/models`, label: "Anthropic 端点", anthropic: true },
    { url: `${BASE_URLS.openai}/models`, label: "Coding Plan 端点", anthropic: false },
  ];

  let lastError = "未知错误";
  for (const t of tries) {
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${k}` };
      if (t.anthropic) headers["anthropic-version"] = "2023-06-01";
      const { status, text } = await httpRequest(t.url, { headers, timeoutMs: 20_000 });
      if (status < 200 || status >= 300) {
        lastError = extractApiError(status, text, "");
        continue; // 换下一个端点试
      }
      const parsed = JSON.parse(text) as { data?: Array<{ id?: unknown }> };
      const models = (parsed.data ?? [])
        .map((m) => (typeof m.id === "string" ? m.id : ""))
        .filter(Boolean)
        .sort();
      if (models.length === 0) {
        lastError = "响应中没有模型条目";
        continue;
      }
      return { ok: true, models, source: t.label };
    } catch (e) {
      const err = e as { name?: string; message?: string };
      lastError = err?.message || String(e);
    }
  }
  return { ok: false, models: [], error: lastError };
}

/* ---- 配置持久化（localStorage，仅本插件可见） ---- */

const LS_KEY = "toolbox-glm-key-test-config";

export interface StoredConfig {
  /** v5：移除协议选择（固定 Anthropic 优先、OpenAI 兜底）。 */
  schemaVersion: 5;
  /** key 列表（名称 + key 本体），至少保留一行。 */
  keys: KeyEntry[];
  model: string;
  /** 「获取模型列表」拉取的模型 id（空 = 未拉取过，回退内置预设）。 */
  models: string[];
  /** 定时：启用 + 每天触发时刻列表（"HH:MM"，本地时间）。 */
  scheduleEnabled: boolean;
  scheduleTimes: string[];
  /** 历史记录（新的在前，上限 200 条）。 */
  history: TestRecord[];
}

export const DEFAULT_CONFIG: StoredConfig = {
  schemaVersion: 5,
  keys: [{ name: "key1", key: "" }],
  model: DEFAULT_MODEL,
  models: [],
  scheduleEnabled: false,
  scheduleTimes: ["13:00"],
  history: [],
};

const HISTORY_LIMIT = 200;

/** 校验 "HH:MM"（00:00–23:59），非法返回 null。 */
export function parseTimeOfDay(v: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}

export function normalizeTime(v: string): string | null {
  const t = parseTimeOfDay(v);
  return t ? `${String(t.h).padStart(2, "0")}:${String(t.m).padStart(2, "0")}` : null;
}

/** 下一个触发时刻的 epoch ms（times 中从 from 起算最早的一个）。 */
export function nextOccurrence(
  times: Array<{ h: number; m: number }>,
  from = Date.now()
): number {
  let earliest = Infinity;
  for (const time of times) {
    const d = new Date(from);
    d.setHours(time.h, time.m, 0, 0);
    if (d.getTime() <= from) d.setDate(d.getDate() + 1);
    if (d.getTime() < earliest) earliest = d.getTime();
  }
  return earliest;
}

export function loadConfig(): StoredConfig {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_CONFIG, keys: [{ ...DEFAULT_CONFIG.keys[0] }] };
    const parsed = JSON.parse(raw) as Partial<StoredConfig> & {
      scheduleTime?: string;
      key?: string;
      /** v4 遗留：协议选择已移除，读取时静默丢弃。 */
      protocol?: Protocol;
    };
    // v3（单个 scheduleTime）→ v4（scheduleTimes 列表）自动迁移。
    const rawTimes = Array.isArray(parsed.scheduleTimes)
      ? parsed.scheduleTimes
      : typeof parsed.scheduleTime === "string"
        ? [parsed.scheduleTime]
        : [];
    const times = [...new Set(rawTimes
      .filter((t): t is string => typeof t === "string")
      .map((t) => normalizeTime(t))
      .filter((t): t is string => t !== null))].sort();
    // v3（单个 key 字符串）→ v4（keys 列表）自动迁移。
    let keys: KeyEntry[];
    if (Array.isArray(parsed.keys)) {
      keys = parsed.keys
        .filter((k): k is KeyEntry => !!k && typeof k === "object")
        .map((k, i) => ({
          name: typeof k.name === "string" && k.name.trim() ? k.name.trim() : `key${i + 1}`,
          key: typeof k.key === "string" ? k.key : "",
        }));
    } else if (typeof parsed.key === "string" && parsed.key) {
      keys = [{ name: "key1", key: parsed.key }];
    } else {
      keys = [];
    }
    if (keys.length === 0) keys = [{ name: "key1", key: "" }];
    // 重名自动加后缀，保证历史筛选时名称唯一可区分。
    const seen = new Set<string>();
    keys = keys.map((k) => {
      let name = k.name;
      let n = 2;
      while (seen.has(name)) name = `${k.name}#${n++}`;
      seen.add(name);
      return k;
    });
    return {
      schemaVersion: 5,
      keys,
      model: typeof parsed.model === "string" ? parsed.model : DEFAULT_MODEL,
      models: Array.isArray(parsed.models)
        ? parsed.models.filter((m): m is string => typeof m === "string")
        : [],
      scheduleEnabled: parsed.scheduleEnabled === true,
      scheduleTimes: times.length > 0 ? times : DEFAULT_CONFIG.scheduleTimes,
      history: Array.isArray(parsed.history) ? parsed.history.slice(0, HISTORY_LIMIT) : [],
    };
  } catch {
    return { ...DEFAULT_CONFIG, keys: [{ ...DEFAULT_CONFIG.keys[0] }] };
  }
}

export function saveConfig(cfg: StoredConfig): void {
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ ...cfg, history: cfg.history.slice(0, HISTORY_LIMIT) })
    );
  } catch {
    /* 存储满等异常：静默，功能仍可用（仅丢失持久化） */
  }
}

/** 新增 key 行的默认名称：key1、key2…（跳过已占用）。 */
export function nextKeyName(keys: KeyEntry[]): string {
  let n = keys.length + 1;
  const names = new Set(keys.map((k) => k.name));
  let name = `key${n}`;
  while (names.has(name)) name = `key${++n}`;
  return name;
}

/* ---- 后台调度器：模块级单例，不随 React 组件卸载而停止 ----
 * 宿主对 background 插件在应用启动时调用 startBackground()（见 manifest），
 * 此后定时器存活于整个应用生命周期；页面 mount/unmount 只影响 UI。 */

type SchedulerListener = () => void;
const listeners = new Set<SchedulerListener>();

/** UI 订阅调度器变化（定时重排 / 后台写入历史后刷新界面）。 */
export function onSchedulerUpdate(cb: SchedulerListener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** 最近一轮测试的全部记录（手动/后台共用；供 UI 分组展示）。 */
let lastRoundRecords: TestRecord[] | null = null;

export function getLastRound(): TestRecord[] | null {
  return lastRoundRecords;
}

/** 记录一轮结果并广播（后台触发由 fireScheduled 调用；手动由 UI 结束时调用）。 */
export function setLastRound(records: TestRecord[]): void {
  lastRoundRecords = records;
  emitUpdate();
}

function emitUpdate(): void {
  for (const cb of listeners) cb();
}

let timer: ReturnType<typeof setTimeout> | null = null;
let nextFireAt: number | null = null;
let backgroundStarted = false;
/** toast 门控：UI 可见时不弹通知（用户正看着页面）。 */
let toastGate: (() => boolean) | null = null;

/** 宿主是否已启动本插件的后台模式（新宿主 = 应用冷启动即生效）。 */
export function isBackgroundActive(): boolean {
  return backgroundStarted;
}

/** main.tsx 在模块加载时注册（避免 core 反向依赖 UI 模块）。 */
export function setToastGate(gate: () => boolean): void {
  toastGate = gate;
}

/** 下次触发时间（epoch ms）；null = 未排定。 */
export function getNextFireAt(): number | null {
  return nextFireAt;
}

export function stopScheduler(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  nextFireAt = null;
}

/** 按当前持久化配置（重）排定时器。配置任何变化后调用；幂等。 */
export function syncScheduler(): void {
  stopScheduler();
  const cfg = loadConfig();
  if (!cfg.scheduleEnabled) return;
  const times = cfg.scheduleTimes
    .map((t) => parseTimeOfDay(t))
    .filter((t): t is { h: number; m: number } => t !== null);
  if (times.length === 0) return;

  const arm = () => {
    const target = nextOccurrence(times);
    nextFireAt = target;
    emitUpdate();
    // 前台标签页 setTimeout 上限约 24.8 天，一天的延迟完全在安全范围内。
    timer = setTimeout(() => {
      void fireScheduled();
    }, Math.max(target - Date.now(), 0));
  };
  arm();
}

/** 宿主 startBackground 入口（幂等）。 */
export function markBackgroundStarted(): void {
  backgroundStarted = true;
  syncScheduler();
}

/** 宿主 stopBackground / 卸载入口。 */
export function shutdownBackground(): void {
  backgroundStarted = false;
  stopScheduler();
}

/** 一轮测试：遍历已填写的 key（串行，避免并发触发服务端频控）。 */
export async function runAllTests(
  cfg: StoredConfig,
  trigger: TestRecord["trigger"]
): Promise<TestRecord[]> {
  const entries = cfg.keys.filter((k) => k.key.trim());
  const records: TestRecord[] = [];
  for (const entry of entries) {
    records.push(
      await runTest({ key: entry.key, keyName: entry.name, model: cfg.model }, trigger)
    );
  }
  return records;
}

function shortState(r: TestRecord): string {
  if (r.ok) return "✓";
  if (r.limited) return "⏳限额";
  return `✗ ${(r.error ?? "失败").slice(0, 40)}`;
}

function notifyResult(records: TestRecord[]): void {
  if (records.length === 0) return;
  if (toastGate?.()) return; // 用户正停留在工具页面，界面已实时展示
  const ok = records.filter((r) => r.ok).length;
  const limited = records.filter((r) => r.limited).length;
  const variant =
    ok === records.length ? "success" : ok + limited === records.length ? "warning" : "error";
  window.dispatchEvent(
    new CustomEvent("toolbox-plugin-toast", {
      detail: {
        title: `GLM Key 定时测试：${ok}/${records.length} 可用${limited > 0 ? `（${limited} 限额中）` : ""}`,
        description: records.map((r) => `${r.keyName || "未命名"} ${shortState(r)}`).join(" · "),
        variant,
      },
    })
  );
}

/** 定时触发：测试全部 key → 写历史 → 通知 → 重排下一次。 */
async function fireScheduled(): Promise<void> {
  try {
    const cfg = loadConfig();
    const records = await runAllTests(cfg, "scheduled");
    if (records.length > 0) {
      const fresh = loadConfig();
      const next: StoredConfig = {
        ...fresh,
        history: [...records.slice().reverse(), ...fresh.history].slice(0, HISTORY_LIMIT),
      };
      saveConfig(next);
      lastRoundRecords = records;
      emitUpdate();
      notifyResult(records);
    }
  } catch (e) {
    console.warn("glm-key-test 定时测试异常：", e);
  } finally {
    syncScheduler();
  }
}
