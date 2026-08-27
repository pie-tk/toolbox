import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  checked?: boolean;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked = false, ...props }, ref) => (
    <span
      className={cn(
        "relative inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background",
        className
      )}
    >
      {checked && <Check className="h-3 w-3" strokeWidth={3} />}
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        className="absolute inset-0 cursor-pointer opacity-0"
        {...props}
      />
    </span>
  )
);
Checkbox.displayName = "Checkbox";
