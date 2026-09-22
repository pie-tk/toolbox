// 剪贴板：复制 + 到期自动清除（对比后再清，不误清用户后复制的内容）。
// 自动清除是尽力而为：窗口失焦等场景 readText 可能被拒绝 → 跳过本次清除。
// 计时器为模块级：不随锁定/页面切换取消（锁定后剪贴板里的密码更应被清）。

interface PendingClear {
  text: string;
  dueAt: number;
}

const pending: PendingClear[] = [];

async function rawCopy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // execCommand 兜底（旧 WebView / 无焦点）
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

async function tryClear(text: string): Promise<void> {
  const idx = pending.findIndex((p) => p.text === text);
  if (idx >= 0) pending.splice(idx, 1);
  try {
    const cur = await navigator.clipboard.readText();
    // 只有剪贴板内容仍是当初复制的值才清空，避免覆盖用户后来复制的内容
    if (cur === text) await navigator.clipboard.writeText("");
  } catch {
    // 读取被拒（失焦等）→ 放弃本次清除
  }
}

/** 复制文本；autoClearSec > 0 时安排到期清除。返回是否复制成功。 */
export async function copyWithAutoClear(text: string, autoClearSec: number): Promise<boolean> {
  const ok = await rawCopy(text);
  if (!ok) return false;
  if (autoClearSec > 0) {
    pending.push({ text, dueAt: Date.now() + autoClearSec * 1000 });
    window.setTimeout(() => void tryClear(text), autoClearSec * 1000);
  }
  return true;
}
