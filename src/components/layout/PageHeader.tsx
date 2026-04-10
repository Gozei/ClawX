import type { ReactNode } from 'react';

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  subtitleTestId?: string;
  metadata?: string[];
  actions?: ReactNode;
  className?: string;
  titleTestId?: string;
};

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  subtitleTestId,
  metadata = [],
  actions,
  className = '',
  titleTestId,
}: PageHeaderProps) {
  const visibleMetadata = metadata.filter(Boolean);

  return (
    <div className={`mb-6 shrink-0 border-b border-[#e7edf5] pb-5 dark:border-white/10 ${className}`}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          {eyebrow && (
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#94a0b2] dark:text-white/42">
              {eyebrow}
            </p>
          )}
          <h1
            data-testid={titleTestId}
            className="text-[28px] leading-[1.08] font-semibold tracking-[-0.028em] text-[#101828] dark:text-white md:text-[30px]"
          >
            {title}
          </h1>
          {subtitle && (
            <p
              data-testid={subtitleTestId}
              className="mt-2 max-w-3xl text-[14px] font-medium leading-[1.65] text-[#5e6c80] dark:text-white/66"
            >
              {subtitle}
            </p>
          )}
          {visibleMetadata.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-medium text-[#6c7a8e] dark:text-white/56">
              {visibleMetadata.map((item, index) => (
                <span key={`${item}-${index}`} className="flex items-center gap-3">
                  {index > 0 && <span className="text-[#b0bac9] dark:text-white/28">·</span>}
                  <span>{item}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {actions ? (
          <div className="flex items-center gap-3 md:mt-1 md:shrink-0">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
