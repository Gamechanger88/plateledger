import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onClick, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        onClick={(e) => {
          if ((type === "date" || type === "time" || type === "datetime-local") && "showPicker" in HTMLInputElement.prototype) {
            try {
              e.currentTarget.showPicker();
            } catch (err) {
              // ignore
            }
          }
          if (onClick) {
            onClick(e);
          }
        }}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
