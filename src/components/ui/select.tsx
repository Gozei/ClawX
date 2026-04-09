/**
 * Select Component
 * Styled native select matching shadcn/ui conventions
 */
import * as React from 'react';
import { cn } from '@/lib/utils';

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;
export const selectBaseClasses = 'flex h-10 w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-10 font-sans text-[14px] leading-5 text-foreground ring-offset-background bg-no-repeat bg-[url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22/%3E%3C/svg%3E")] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export function getSelectIconStyle(rightPx = 12, sizePx = 16): React.CSSProperties {
  return {
    backgroundPosition: `right ${rightPx}px center`,
    backgroundSize: `${sizePx}px ${sizePx}px`,
  };
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, style, ...props }, ref) => {
    return (
      <select
        className={cn(
          selectBaseClasses,
          className
        )}
        style={{ ...getSelectIconStyle(), ...style }}
        ref={ref}
        {...props}
      >
        {children}
      </select>
    );
  }
);
Select.displayName = 'Select';

export { Select };
