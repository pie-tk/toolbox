import { PackageOpen } from "lucide-react";
import type { ComponentType } from "react";

interface EmptyStateProps {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
}

export function EmptyState({ icon: Icon = PackageOpen, title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center animate-fade-in">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="h-6 w-6" />
      </div>
      <div className="text-sm font-medium">{title}</div>
      {description && (
        <div className="max-w-sm text-xs leading-relaxed text-muted-foreground">{description}</div>
      )}
    </div>
  );
}
