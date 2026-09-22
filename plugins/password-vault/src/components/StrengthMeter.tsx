// 密码强度条（熵估计，信息性提示）。
import { passwordStrength } from "../generator";

const SEGMENT_CLASSES = [
  "bg-destructive",
  "bg-destructive/60",
  "bg-warning",
  "bg-success/60",
  "bg-success",
];

export function StrengthMeter({ password }: { password: string }) {
  const { score, label, entropyBits } = passwordStrength(password);
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-1.5 flex-1 gap-1 overflow-hidden rounded-full">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`h-full flex-1 rounded-full transition-colors ${i <= score ? SEGMENT_CLASSES[score] : "bg-border"}`}
          />
        ))}
      </div>
      <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">
        {password ? `${label} · ${entropyBits}bit` : "强度"}
      </span>
    </div>
  );
}
