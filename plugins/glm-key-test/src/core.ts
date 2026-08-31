/**
 * 智谱 GLM Coding Plan Key 测试核心逻辑。
 *
 * 端点（官方文档 docs.bigmodel.cn/cn/coding-plan/quick-start）：
 *   - OpenAI Chat Completion 协议: https://open.bigmodel.cn/api/coding/paas/v4
 *   - Anthropic Message 协议:      https://open.bigmodel.cn/api/anthropic
 * 认证：Authorization: Bearer <key>（Coding Plan Key，非 JWT，无需签名）。
 *
 * 在 WebView 内直接 fetch：open.bigmodel.cn 已验证返回
 * Access-Control-Allow-Origin 回显 Origin，宿主 CSP connect-src 允许 https://*。
 */

export const PROTOCOLS = ["openai", "anthropic"] as const;
export type Protocol = (typeof PROTOCOLS)[number];

export const PROTOCOL_LABELS: Record<Protocol, string> = {
  openai: "OpenAI 协议",
  anthropic: "Anthropic 协议",
};

export const BASE_URLS: Record<Protocol, string> = {
  openai: "https://open.bigmodel.cn/api/coding/paas/v4",
  anthropic: "https://open.bigmodel.cn/api/anthropic",
};

/** 文档确认的 Coding Plan 可用模型（latest-model 页）。 */
export const MODEL_PRESETS = ["glm-5.3-flash", "glm-5.3"] as const;

export const DEFAULT_MODEL = "glm-5.3-flash";
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
  protocol: Protocol;
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
  protocol: Protocol;
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

/** 发起一次最简对话测试，永不抛异常——失败信息收纳在 TestRecord.error。 */
export async function runTest(
  cfg: TestConfig,
  trigger: TestRecord["trigger"] = "manual"
): Promise<TestRecord> {
  const key = cfg.key.trim();
  const started = Date.now();
  const base: Omit<TestRecord, "ok" | "elapsedMs" | "reply" | "usage" | "error"> = {
    at: started,
    trigger,
    keyName: cfg.keyName,
    model: cfg.model,
    protocol: cfg.protocol,
  };

  if (!key) {
    return { ...base, ok: false, elapsedMs: 0, error: "未填写 API Key" };
  }

  const { signal, cancel } = requestTimeout(30_000);
  try {
    let res: Response;
    if (cfg.protocol === "anthropic") {
      res = await fetch(`${BASE_URLS.anthropic}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: 16,
          messages: [{ role: "user", content: TEST_PROMPT }],
        }),
        signal,
      });
    } else {
      res = await fetch(`${BASE_URLS.openai}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          messages: [{ role: "user", content: TEST_PROMPT }],
          max_tokens: 16,
        }),
        signal,
      });
    }

    const text = await res.text();
    const elapsedMs = Date.now() - started;

    if (!res.ok) {
      return {
        ...base,
        ok: false,
        limited: isLimited(res.status),
        elapsedMs,
        error: extractApiError(res.status, text, res.statusText),
      };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return {
        ...base,
        ok: false,
        elapsedMs,
        error: `响应不是合法 JSON：${text.slice(0, 300)}`,
      };
    }

    /* Anthropic: {content: [{type:"text", text}], usage:{input_tokens, output_tokens}} */
    let reply = "";
    let usage: TestRecord["usage"];
    if (cfg.protocol === "anthropic") {
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
      /* OpenAI: {choices: [{message: {content}}], usage:{prompt_tokens, ...}} */
      const choices = parsed.choices;
      if (Array.isArray(choices) && choices.length > 0) {
        const msg = (choices[0] as { message?: { content?: unknown } }).message;
        const c = msg?.content;
        reply = typeof c === "string" ? c.trim() : "";
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
      return { ...base, ok: false, elapsedMs, error: "请求成功但未解析到回复文本" };
    }
    return { ...base, ok: true, elapsedMs, reply, usage };
  } catch (e) {
    const elapsedMs = Date.now() - started;
    const err = e as { name?: string; message?: string };
    const reason =
      err?.name === "AbortError"
        ? "请求超时（30s）"
        : err?.message || String(e);
    return { ...base, ok: false, elapsedMs, error: `网络错误：${reason}` };
  } finally {
    cancel();
  }
}

/* ---- 配置持久化（localStorage，仅本插件可见） ---- */

const LS_KEY = "toolbox-glm-key-test-config";

export interface StoredConfig {
  schemaVersion: 4;
  /** key 列表（名称 + key 本体），至少保留一行。 */
  keys: KeyEntry[];
  protocol: Protocol;
  model: string;
  /** 定时：启用 + 每天触发时刻列表（"HH:MM"，本地时间）。 */
  scheduleEnabled: boolean;
  scheduleTimes: string[];
  /** 历史记录（新的在前，上限 200 条）。 */
  history: TestRecord[];
}

export const DEFAULT_CONFIG: StoredConfig = {
  schemaVersion: 4,
  keys: [{ name: "key1", key: "" }],
  protocol: "openai",
  model: DEFAULT_MODEL,
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
    };
    const protocol = PROTOCOLS.includes(parsed.protocol as Protocol)
      ? (parsed.protocol as Protocol)
      : DEFAULT_CONFIG.protocol;
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
      schemaVersion: 4,
      keys,
      protocol,
      model: typeof parsed.model === "string" && parsed.model ? parsed.model : DEFAULT_MODEL,
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
