import * as React from "react";
import { cn } from "../../lib/utils";

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden", className)}
    {...props}
  />
));
Card.displayName = "Card";

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
));
CardHeader.displayName = "CardHeader";

export const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn("text-2xl font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("p-6 pt-0", className)}
    {...props}
  />
));
CardContent.displayName = "CardContent";

export const Badge = ({ children, variant = "default", className = "", ...props }: { children: React.ReactNode; variant?: "default" | "success" | "danger" | "warning"; className?: string }) => {
  const styles = {
    default: "bg-secondary text-secondary-foreground",
    success: "bg-green-500/10 text-green-500 border border-green-500/20",
    danger: "bg-red-500/10 text-red-500 border border-red-500/20",
    warning: "bg-yellow-500/10 text-yellow-500 border border-yellow-500/20",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus-outline-none", styles[variant], className)} {...props}>
      {children}
    </span>
  );
};

export const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "outline" | "danger" }>(
  ({ className, variant = "primary", ...props }, ref) => {
    const styles = {
      primary: "bg-primary text-primary-foreground hover:bg-primary/90",
      secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
      outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
      danger: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
    };
    return (
      <button
        ref={ref}
        className={cn("inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-10 px-4 py-2", styles[variant], className)}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export const Separator = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("h-px w-full bg-border", className)}
    {...props}
  />
));
Separator.displayName = "Separator";

export const Tabs = ({ children, defaultValue, onValueChange }: { children: React.ReactNode; defaultValue: string; onValueChange?: (value: string) => void }) => {
  const [value, setValue] = React.useState(defaultValue);
  const handleValueChange = (val: string) => {
    setValue(val);
    onValueChange?.(val);
  };
  return (
    <div className="w-full" data-tabs-value={value}>
      {React.Children.map(children, child => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child as any, { value, onValueChange: handleValueChange });
        }
        return child;
      })}
    </div>
  );
};

export const TabsList = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground", className)}>
    {children}
  </div>
);

export const TabsTrigger = ({ value, children, isActive, onClick, className }: { value: string; children: React.ReactNode; isActive?: boolean; onClick?: () => void; className?: string }) => (
  <button
    onClick={onClick}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1 text-xs font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
      isActive ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      className
    )}
  >
    {children}
  </button>
);

export const TabsContent = ({ value, isActive, children, className }: { value: string; isActive?: boolean; children: React.ReactNode; className?: string }) => {
  if (!isActive) return null;
  return <div className={cn("mt-2 ring-offset-background", className)}>{children}</div>;
};

/**
 * Sheet Components
 */
export const Sheet = ({ children, open, onOpenChange }: { children: React.ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void }) => {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const isOpen = open !== undefined ? open : internalOpen;
  const handleOpenChange = (val: boolean) => {
    setInternalOpen(val);
    onOpenChange?.(val);
  };

  return (
    <div className="relative" data-sheet-open={isOpen}>
      {React.Children.map(children, child => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child as any, { open: isOpen, onOpenChange: handleOpenChange });
        }
        return child;
      })}
    </div>
  );
};

export const SheetTrigger = ({ children, className, ...props }: { children: React.ReactNode; className?: string }) => {
  return (
    <div
      onClick={(e) => {
        const sheet = (e.target as HTMLElement).closest('[data-sheet-open]');
        if (sheet) {
          // Triggered via parent state in StrategyDetails, but kept for API compatibility
        }
      }}
      className={cn("cursor-pointer", className)}
      {...props}
    >
      {children}
    </div>
  );
};

export const SheetContent = ({ children, className, side = "right", open }: { children: React.ReactNode; className?: string; side?: "top" | "bottom" | "left" | "right"; open?: boolean }) => {
  if (!open) return null;
  const sideStyles = {
    top: "inset-x-0 top-0 border-b",
    bottom: "inset-x-0 bottom-0 border-t",
    left: "inset-y-0 left-0 border-r",
    right: "inset-y-0 right-0 border-l",
  };

  return (
    <div className={cn(
      "fixed z-50 bg-background p-6 shadow-lg transition-all duration-300 ease-in-out",
      sideStyles[side],
      className
    )}>
      {children}
    </div>
  );
};

export const SheetHeader = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("flex flex-col space-y-2 text-left", className)}>
    {children}
  </div>
);

export const SheetTitle = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <h2 className={cn("text-lg font-semibold leading-none tracking-tight", className)}>
    {children}
  </h2>
);

export const SheetDescription = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <p className={cn("text-sm text-muted-foreground", className)}>
    {children}
  </p>
);

/**
 * Slider Component
 */
export const Slider = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { step?: number }>(({ className, step = 1, ...props }, ref) => (
  <input
    type="range"
    ref={ref}
    step={step}
    className={cn(
      "relative h-2 w-full cursor-pointer appearance-none rounded-lg bg-secondary accent-primary",
      className
    )}
    {...props}
  />
));
Slider.displayName = "Slider";

/**
 * ToggleGroup Components
 */
export const ToggleGroup = ({ children, value, onValueChange, type = "single" }: { children: React.ReactNode; value: string | string[]; onValueChange: (value: any) => void; type?: "single" | "multiple" }) => {
  return (
    <div className="inline-flex items-center justify-start rounded-md bg-muted p-1" role="group">
      {React.Children.map(children, child => {
        if (React.isValidElement(child)) {
          const isSelected = type === "single"
            ? value === (child.props as any).value
            : (value as string[]).includes((child.props as any).value);

          return React.cloneElement(child as any, {
            isSelected,
            onClick: () => {
              if (type === "single") {
                onValueChange((child.props as any).value);
              } else {
                const current = value as string[];
                const val = (child.props as any).value;
                onValueChange(current.includes(val) ? current.filter(v => v !== val) : [...current, val]);
              }
            }
          });
        }
        return child;
      })}
    </div>
  );
};

export const ToggleGroupItem = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string; isSelected?: boolean }>(
  ({ className, value, isSelected, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center rounded-sm px-3 py-1.5 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        isSelected ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
        className
      )}
      {...props}
    >
      {props.children}
    </button>
  )
);
ToggleGroupItem.displayName = "ToggleGroupItem";

/**
 * Resizable Components
 */
export const ResizablePanelGroup = ({ children, direction = "horizontal", className }: { children: React.ReactNode; direction?: "horizontal" | "vertical"; className?: string }) => (
  <div className={cn(
    "flex",
    direction === "horizontal" ? "flex-row" : "flex-col",
    className
  )}>
    {children}
  </div>
);

export const ResizablePanel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { defaultSize?: number }>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("relative min-w-0 overflow-hidden", className)}
      {...props}
    />
  )
);
ResizablePanel.displayName = "ResizablePanel";

export const ResizableHandle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "bg-border transition-colors hover:bg-accent cursor-pointer",
      "w-1 h-full", // Default horizontal
      className
    )}
    {...props}
  />
));
ResizableHandle.displayName = "ResizableHandle";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Select = ({ children, value, onValueChange }: { children: React.ReactNode; value: string; onValueChange: (value: string) => void }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  return (
    <div className="relative w-full" onBlur={() => setTimeout(() => setIsOpen(false), 200)}>
      {React.Children.map(children, child => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child as any, {
            value,
            onValueChange,
            setIsOpen,
            isOpen,
            onClick: (e: any) => {
              if ((child.props as any).type === 'SelectTrigger') {
                setIsOpen(!isOpen);
              }
            }
          });
        }
        return child;
      })}
    </div>
  );
};

export const SelectTrigger = ({ children, value, className, onClick }: { children: React.ReactNode; value: string; className?: string; onClick?: (e: any) => void }) => (
  <button
    onClick={onClick}
    className={cn("flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring", className)}
  >
    {children}
  </button>
);

export const SelectValue = ({ value }: { value: string }) => (
  <span className="text-sm">{value || "Select a value..."}</span>
);

export const SelectContent = ({ children, value, onValueChange, isOpen }: { children: React.ReactNode; value: string; onValueChange: (val: string) => void; isOpen?: boolean }) => {
  if (!isOpen) return null;
  return (
    <div className="absolute z-50 w-full mt-1 rounded-md border bg-popover text-popover-foreground shadow-md max-h-60 overflow-auto">
      {children}
    </div>
  );
};

export const SelectItem = ({ value, children, isSelected, onClick }: { value: string; children: React.ReactNode; isSelected?: boolean; onClick?: () => void }) => (
  <div
    onClick={onClick}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground",
      isSelected && "bg-accent text-accent-foreground"
    )}
  >
    {children}
  </div>
);
