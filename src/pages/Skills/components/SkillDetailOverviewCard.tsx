import type { ElementType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type SkillDetailOverviewCardProps = {
  title: string;
  description?: string;
  icon: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  metadata?: ReactNode;
  titleAs?: ElementType;
  titleTestId?: string;
  testId?: string;
  iconClassName?: string;
};

export function SkillDetailOverviewCard({
  title,
  description,
  icon,
  badges,
  actions,
  metadata,
  titleAs: TitleTag = 'h2',
  titleTestId,
  testId,
  iconClassName,
}: SkillDetailOverviewCardProps) {
  return (
    <section
      data-testid={testId}
      className="rounded-[24px] bg-white p-6 shadow-[0_4px_24px_rgb(0,0,0,0.03)] dark:bg-card sm:p-7"
    >
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-5">
          <div
            className={cn(
              'flex h-16 w-16 shrink-0 items-center justify-center rounded-[18px] bg-sky-50 text-3xl text-sky-700 shadow-sm shadow-sky-100/50 dark:bg-sky-500/10 dark:text-sky-200 dark:shadow-none',
              iconClassName,
            )}
          >
            {icon}
          </div>
          <div className="min-w-0 pt-0.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <TitleTag
                data-testid={titleTestId}
                className="truncate text-[24px] font-bold tracking-tight text-slate-900 dark:text-white"
              >
                {title}
              </TitleTag>
              {badges}
            </div>
            {description && (
              <p className="mt-2.5 max-w-2xl text-[14px] leading-relaxed text-slate-500 dark:text-white/60">
                {description}
              </p>
            )}
          </div>
        </div>

        {actions && (
          <div className="flex shrink-0 items-center justify-center gap-3 self-center">
            {actions}
          </div>
        )}
      </div>

      {metadata && (
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-slate-100 pt-5 text-[12px] text-slate-400 dark:border-white/8 dark:text-white/45">
          {metadata}
        </div>
      )}
    </section>
  );
}
