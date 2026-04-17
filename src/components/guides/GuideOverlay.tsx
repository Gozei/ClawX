import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Sparkles, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getGuideDefinition, type GuidePlacement } from '@/lib/guides';
import { useGuideStore } from '@/stores/guide';
import { useSettingsStore } from '@/stores/settings';
import { useTranslation } from 'react-i18next';

type FocusRect = {
  top: number;
  left: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const VIEWPORT_MARGIN = 16;
const GUIDE_GAP = 18;
const SPOTLIGHT_PADDING = 10;
const DEFAULT_CARD_SIZE = {
  width: 360,
  height: 244,
};

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncPreference = () => {
      setPrefersReducedMotion(mediaQuery.matches);
    };

    syncPreference();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', syncPreference);
      return () => {
        mediaQuery.removeEventListener('change', syncPreference);
      };
    }

    mediaQuery.addListener(syncPreference);
    return () => {
      mediaQuery.removeListener(syncPreference);
    };
  }, []);

  return prefersReducedMotion;
}

function findGuideTarget(targetId: string | undefined): HTMLElement | null {
  if (!targetId) return null;
  return document.querySelector(`[data-guide-id="${targetId}"]`);
}

function getTargetRect(targetId: string | undefined): FocusRect | null {
  const element = findGuideTarget(targetId);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    right: rect.right,
    bottom: rect.bottom,
    centerX: rect.left + (rect.width / 2),
    centerY: rect.top + (rect.height / 2),
  };
}

function getSpotlightRect(targetRect: FocusRect | null): FocusRect | null {
  if (!targetRect) return null;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const top = clamp(targetRect.top - SPOTLIGHT_PADDING, 8, viewportHeight - 8);
  const left = clamp(targetRect.left - SPOTLIGHT_PADDING, 8, viewportWidth - 8);
  const right = clamp(targetRect.right + SPOTLIGHT_PADDING, 8, viewportWidth - 8);
  const bottom = clamp(targetRect.bottom + SPOTLIGHT_PADDING, 8, viewportHeight - 8);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);

  return {
    top,
    left,
    width,
    height,
    right,
    bottom,
    centerX: left + (width / 2),
    centerY: top + (height / 2),
  };
}

function getPlacementOrder(preferredPlacement: GuidePlacement): GuidePlacement[] {
  const fallbackMap: Record<GuidePlacement, GuidePlacement[]> = {
    bottom: ['bottom', 'top', 'right', 'left', 'center'],
    top: ['top', 'bottom', 'right', 'left', 'center'],
    right: ['right', 'left', 'bottom', 'top', 'center'],
    left: ['left', 'right', 'bottom', 'top', 'center'],
    center: ['center', 'bottom', 'top', 'right', 'left'],
  };

  return fallbackMap[preferredPlacement];
}

function getCandidateCardPosition(
  targetRect: FocusRect,
  placement: GuidePlacement,
  cardWidth: number,
  cardHeight: number,
): { top: number; left: number } {
  switch (placement) {
    case 'top':
      return {
        top: targetRect.top - GUIDE_GAP - cardHeight,
        left: targetRect.centerX - (cardWidth / 2),
      };
    case 'left':
      return {
        top: targetRect.centerY - (cardHeight / 2),
        left: targetRect.left - GUIDE_GAP - cardWidth,
      };
    case 'right':
      return {
        top: targetRect.centerY - (cardHeight / 2),
        left: targetRect.right + GUIDE_GAP,
      };
    case 'center':
      return {
        top: (window.innerHeight / 2) - (cardHeight / 2),
        left: (window.innerWidth / 2) - (cardWidth / 2),
      };
    case 'bottom':
    default:
      return {
        top: targetRect.bottom + GUIDE_GAP,
        left: targetRect.centerX - (cardWidth / 2),
      };
  }
}

function fitsInViewport(top: number, left: number, cardWidth: number, cardHeight: number): boolean {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  return top >= VIEWPORT_MARGIN
    && left >= VIEWPORT_MARGIN
    && (top + cardHeight) <= (viewportHeight - VIEWPORT_MARGIN)
    && (left + cardWidth) <= (viewportWidth - VIEWPORT_MARGIN);
}

function resolveCardPosition(
  targetRect: FocusRect | null,
  placement: GuidePlacement,
  cardSize: { width: number; height: number },
): { top: number; left: number; placement: GuidePlacement } {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const cardWidth = Math.min(cardSize.width, viewportWidth - (VIEWPORT_MARGIN * 2));
  const cardHeight = Math.min(cardSize.height, viewportHeight - (VIEWPORT_MARGIN * 2));

  if (!targetRect || placement === 'center') {
    return {
      top: clamp((viewportHeight / 2) - (cardHeight / 2), VIEWPORT_MARGIN, viewportHeight - cardHeight - VIEWPORT_MARGIN),
      left: clamp((viewportWidth / 2) - (cardWidth / 2), VIEWPORT_MARGIN, viewportWidth - cardWidth - VIEWPORT_MARGIN),
      placement: 'center',
    };
  }

  for (const candidatePlacement of getPlacementOrder(placement)) {
    const candidate = getCandidateCardPosition(targetRect, candidatePlacement, cardWidth, cardHeight);
    if (fitsInViewport(candidate.top, candidate.left, cardWidth, cardHeight)) {
      return {
        top: candidate.top,
        left: candidate.left,
        placement: candidatePlacement,
      };
    }
  }

  const fallbackPlacement = placement === 'center' ? 'bottom' : placement;
  const fallback = getCandidateCardPosition(targetRect, fallbackPlacement, cardWidth, cardHeight);
  return {
    top: clamp(fallback.top, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewportHeight - cardHeight - VIEWPORT_MARGIN)),
    left: clamp(fallback.left, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewportWidth - cardWidth - VIEWPORT_MARGIN)),
    placement: fallbackPlacement,
  };
}

function resolveArrowStyle(
  placement: GuidePlacement,
  focusRect: FocusRect | null,
  cardPosition: { top: number; left: number },
  cardSize: { width: number; height: number },
): CSSProperties | null {
  if (!focusRect || placement === 'center') {
    return null;
  }

  const arrowSize = 16;
  const safeInset = 28;

  switch (placement) {
    case 'top':
      return {
        bottom: -(arrowSize / 2),
        left: clamp(focusRect.centerX - cardPosition.left - (arrowSize / 2), safeInset, cardSize.width - safeInset - arrowSize),
      };
    case 'left':
      return {
        top: clamp(focusRect.centerY - cardPosition.top - (arrowSize / 2), safeInset, cardSize.height - safeInset - arrowSize),
        right: -(arrowSize / 2),
      };
    case 'right':
      return {
        top: clamp(focusRect.centerY - cardPosition.top - (arrowSize / 2), safeInset, cardSize.height - safeInset - arrowSize),
        left: -(arrowSize / 2),
      };
    case 'bottom':
    default:
      return {
        top: -(arrowSize / 2),
        left: clamp(focusRect.centerX - cardPosition.left - (arrowSize / 2), safeInset, cardSize.width - safeInset - arrowSize),
      };
  }
}

function resolveAnchorPoint(focusRect: FocusRect | null, placement: GuidePlacement): { top: number; left: number } | null {
  if (!focusRect || placement === 'center') {
    return null;
  }

  switch (placement) {
    case 'top':
      return {
        top: focusRect.top,
        left: focusRect.centerX,
      };
    case 'left':
      return {
        top: focusRect.centerY,
        left: focusRect.left,
      };
    case 'right':
      return {
        top: focusRect.centerY,
        left: focusRect.right,
      };
    case 'bottom':
    default:
      return {
        top: focusRect.bottom,
        left: focusRect.centerX,
      };
  }
}

export function GuideOverlay() {
  const location = useLocation();
  const { activeGuideId, activeStepIndex, nextGuideStep, previousGuideStep, stopGuide } = useGuideStore();
  const markGuideSeen = useSettingsStore((state) => state.markGuideSeen);
  const guide = useMemo(() => getGuideDefinition(activeGuideId), [activeGuideId]);
  const step = guide?.steps[activeStepIndex] ?? null;
  const { t } = useTranslation();
  const prefersReducedMotion = usePrefersReducedMotion();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [targetRect, setTargetRect] = useState<FocusRect | null>(null);
  const [cardSize, setCardSize] = useState(DEFAULT_CARD_SIZE);

  useEffect(() => {
    if (!step) {
      setTargetRect(null);
      return;
    }
    if (step.route !== location.pathname) {
      stopGuide();
      return;
    }

    let frameId = 0;
    let syncFrameId = 0;
    const syncRect = () => {
      setTargetRect(getTargetRect(step.targetId));
    };
    const scheduleSyncRect = () => {
      window.cancelAnimationFrame(syncFrameId);
      syncFrameId = window.requestAnimationFrame(syncRect);
    };

    const scrollTargetIntoView = () => {
      const element = findGuideTarget(step.targetId);
      if (element && typeof element.scrollIntoView === 'function') {
        const rect = element.getBoundingClientRect();
        const viewportPadding = 72;
        const needsScroll = rect.top < viewportPadding || rect.bottom > (window.innerHeight - viewportPadding);
        if (needsScroll) {
          element.scrollIntoView({
            block: 'center',
            inline: 'nearest',
            behavior: prefersReducedMotion ? 'auto' : 'smooth',
          });
        }
      }
    };

    frameId = window.requestAnimationFrame(() => {
      scrollTargetIntoView();
      scheduleSyncRect();
    });

    window.addEventListener('resize', scheduleSyncRect);
    window.addEventListener('scroll', scheduleSyncRect, true);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.cancelAnimationFrame(syncFrameId);
      window.removeEventListener('resize', scheduleSyncRect);
      window.removeEventListener('scroll', scheduleSyncRect, true);
    };
  }, [location.pathname, prefersReducedMotion, step, stopGuide]);

  useEffect(() => {
    const syncCardSize = () => {
      const rect = cardRef.current?.getBoundingClientRect();
      if (!rect) return;
      const nextWidth = Math.round(rect.width);
      const nextHeight = Math.round(rect.height);
      setCardSize((currentSize) => {
        if (currentSize.width === nextWidth && currentSize.height === nextHeight) {
          return currentSize;
        }
        return {
          width: nextWidth,
          height: nextHeight,
        };
      });
    };

    syncCardSize();

    const resizeObserver = typeof ResizeObserver !== 'undefined' && cardRef.current
      ? new ResizeObserver(syncCardSize)
      : null;
    if (resizeObserver && cardRef.current) {
      resizeObserver.observe(cardRef.current);
    }

    window.addEventListener('resize', syncCardSize);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', syncCardSize);
    };
  }, [activeStepIndex, guide?.id, step?.descriptionKey, step?.titleKey]);

  if (!guide || !step) {
    return null;
  }

  const closeGuide = () => {
    markGuideSeen(guide.id, guide.version);
    stopGuide();
  };

  const advanceGuide = () => {
    if (activeStepIndex >= guide.steps.length - 1) {
      closeGuide();
      return;
    }
    nextGuideStep();
  };

  const focusRect = getSpotlightRect(targetRect);
  const cardPosition = resolveCardPosition(focusRect, step.placement ?? 'bottom', cardSize);
  const arrowStyle = resolveArrowStyle(cardPosition.placement, focusRect, cardPosition, cardSize);
  const anchorPoint = resolveAnchorPoint(focusRect, cardPosition.placement);
  const progressLabel = t('guide.progress', {
    ns: guide.namespace,
    current: activeStepIndex + 1,
    total: guide.steps.length,
  });
  const motionCurve = 'cubic-bezier(0.22, 1, 0.36, 1)';
  const motionDurationMs = prefersReducedMotion ? 0 : 460;
  const motionClassName = prefersReducedMotion
    ? 'transition-none'
    : 'transition-[top,left,width,height,transform,opacity,box-shadow] will-change-[top,left,width,height,transform]';
  const contentMotionClassName = prefersReducedMotion
    ? ''
    : 'animate-[guide-step-fade_320ms_cubic-bezier(0.22,1,0.36,1)]';
  const motionStyle = prefersReducedMotion
    ? undefined
    : {
      transitionDuration: `${motionDurationMs}ms`,
      transitionTimingFunction: motionCurve,
    };

  return (
    <div data-testid="app-guide-overlay" className="pointer-events-none fixed inset-0 z-[180]">
      {focusRect ? (
        <>
          <div
            className="absolute left-0 right-0 top-0 bg-slate-950/34"
            style={{ height: focusRect.top }}
          />
          <div
            className="absolute left-0 bg-slate-950/34"
            style={{ top: focusRect.top, width: focusRect.left, height: focusRect.height }}
          />
          <div
            className="absolute right-0 bg-slate-950/34"
            style={{ top: focusRect.top, width: Math.max(0, window.innerWidth - focusRect.right), height: focusRect.height }}
          />
          <div
            className="absolute bottom-0 left-0 right-0 bg-slate-950/34"
            style={{ top: focusRect.bottom }}
          />
        </>
      ) : (
        <div className="absolute inset-0 bg-slate-950/34" />
      )}

      {focusRect ? (
        <div
          data-testid="app-guide-highlight"
          className={cn(
            'absolute rounded-[24px] border border-sky-400/80 bg-white/12 shadow-[0_0_0_1px_rgba(255,255,255,0.32),0_0_0_12px_rgba(56,189,248,0.18),0_18px_42px_rgba(14,165,233,0.18)] dark:bg-white/[0.04]',
            motionClassName,
          )}
          style={{
            top: focusRect.top,
            left: focusRect.left,
            width: focusRect.width,
            height: focusRect.height,
            ...motionStyle,
          }}
        >
          <div className="absolute -left-[2px] -top-[2px] h-6 w-6 rounded-tl-[18px] border-l-[3px] border-t-[3px] border-sky-400" />
          <div className="absolute -right-[2px] -top-[2px] h-6 w-6 rounded-tr-[18px] border-r-[3px] border-t-[3px] border-sky-400" />
          <div className="absolute -bottom-[2px] -left-[2px] h-6 w-6 rounded-bl-[18px] border-b-[3px] border-l-[3px] border-sky-400" />
          <div className="absolute -bottom-[2px] -right-[2px] h-6 w-6 rounded-br-[18px] border-b-[3px] border-r-[3px] border-sky-400" />
        </div>
      ) : null}

      {anchorPoint ? (
        <>
          <div
            className={cn(
              'absolute -translate-x-1/2 -translate-y-1/2',
              motionClassName,
            )}
            style={{ top: anchorPoint.top, left: anchorPoint.left, ...motionStyle }}
          >
            <div
              className={cn(
                'h-7 w-7 rounded-full bg-sky-400/25',
                prefersReducedMotion ? '' : 'animate-[guide-anchor-pulse_1.8s_cubic-bezier(0.16,1,0.3,1)_infinite]',
              )}
            />
          </div>
          <div
            data-testid="app-guide-anchor"
            className={cn(
              'absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-sky-500 shadow-[0_0_0_4px_rgba(56,189,248,0.18),0_8px_18px_rgba(14,165,233,0.28)]',
              motionClassName,
            )}
            style={{ top: anchorPoint.top, left: anchorPoint.left, ...motionStyle }}
          />
        </>
      ) : null}

      <div
        ref={cardRef}
        data-testid="app-guide-card"
        className={cn(
          'pointer-events-auto absolute w-[min(360px,calc(100vw-2rem))] overflow-visible rounded-[28px] border border-sky-200/70 bg-[#fcfdff] p-5 text-[#163047] shadow-[0_24px_64px_rgba(15,23,42,0.18)] dark:border-sky-300/16 dark:bg-[#0f1722] dark:text-white',
          motionClassName,
        )}
        style={{
          top: cardPosition.top,
          left: cardPosition.left,
          transform: 'translateZ(0)',
          ...motionStyle,
        }}
      >
        {arrowStyle ? (
          <div
            data-testid="app-guide-arrow"
            className={cn(
              'pointer-events-none absolute h-4 w-4 rotate-45 rounded-[4px] border border-sky-200/70 bg-[#fcfdff] shadow-[0_12px_24px_rgba(15,23,42,0.12)] dark:border-sky-300/16 dark:bg-[#0f1722]',
              motionClassName,
            )}
            style={{
              ...arrowStyle,
              ...motionStyle,
              transitionDuration: `${motionDurationMs}ms`,
              transitionTimingFunction: motionCurve,
            }}
          />
        ) : null}
        <div key={step.id} className={contentMotionClassName}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full bg-sky-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-700 dark:bg-sky-400/12 dark:text-sky-200">
                <Sparkles className="h-3.5 w-3.5" />
                <span>{t(guide.titleKey, { ns: guide.namespace })}</span>
              </div>
              <p className="mt-3 text-[12px] font-medium text-[#607089] dark:text-white/58" data-testid="app-guide-progress">
                {progressLabel}
              </p>
            </div>
            <button
              type="button"
              aria-label={t('actions.close', { ns: 'common' })}
              onClick={closeGuide}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#6b7a8d] transition hover:bg-black/5 hover:text-[#233247] dark:text-white/58 dark:hover:bg-white/8 dark:hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <h3 className="mt-4 text-[20px] font-semibold tracking-[-0.02em]" data-testid="app-guide-title">
            {t(step.titleKey, { ns: guide.namespace })}
          </h3>
          <p className="mt-2 text-[14px] leading-7 text-[#526175] dark:text-white/70" data-testid="app-guide-description">
            {t(step.descriptionKey, { ns: guide.namespace })}
          </p>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={closeGuide}
              className="h-9 rounded-full px-3 text-[#607089] hover:bg-black/5 hover:text-[#233247] dark:text-white/62 dark:hover:bg-white/8 dark:hover:text-white"
              data-testid="app-guide-skip"
            >
              {t('actions.skip', { ns: 'common' })}
            </Button>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={previousGuideStep}
                disabled={activeStepIndex === 0}
                className={cn(
                  'h-9 rounded-full px-4 text-[13px] font-medium',
                  activeStepIndex === 0 && 'opacity-50',
                )}
                data-testid="app-guide-back"
              >
                {t('actions.back', { ns: 'common' })}
              </Button>
              <Button
                type="button"
                onClick={advanceGuide}
                className="h-9 rounded-full px-4 text-[13px] font-medium"
                data-testid="app-guide-next"
              >
                {activeStepIndex >= guide.steps.length - 1
                  ? t('guide.finish', { ns: guide.namespace })
                  : t('actions.next', { ns: 'common' })}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
