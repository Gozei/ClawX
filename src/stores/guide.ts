import { create } from 'zustand';

interface GuideState {
  activeGuideId: string | null;
  activeStepIndex: number;
  startGuide: (guideId: string, stepIndex?: number) => void;
  nextGuideStep: () => void;
  previousGuideStep: () => void;
  stopGuide: () => void;
}

export const useGuideStore = create<GuideState>((set) => ({
  activeGuideId: null,
  activeStepIndex: 0,

  startGuide: (guideId, stepIndex = 0) => {
    const normalizedGuideId = guideId.trim();
    if (!normalizedGuideId) return;
    set({
      activeGuideId: normalizedGuideId,
      activeStepIndex: Math.max(0, Math.floor(stepIndex)),
    });
  },

  nextGuideStep: () => {
    set((state) => ({
      activeStepIndex: state.activeStepIndex + 1,
    }));
  },

  previousGuideStep: () => {
    set((state) => ({
      activeStepIndex: Math.max(0, state.activeStepIndex - 1),
    }));
  },

  stopGuide: () => {
    set({
      activeGuideId: null,
      activeStepIndex: 0,
    });
  },
}));
