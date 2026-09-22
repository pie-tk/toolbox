import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

/** 页首搜索框（首页 / 工具市场共用）。 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 shadow-sm transition-[border-color,box-shadow] duration-200 focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-ring",
        className
      )}
    >
      <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
