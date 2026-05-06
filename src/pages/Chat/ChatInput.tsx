/**
 * Chat Input Component
 * Textarea with send button and universal file upload support.
 * Enter to send, Shift+Enter for new line.
 * Supports: native file picker, clipboard paste, drag & drop.
 * Files are staged to disk via IPC — only lightweight path references
 * are sent with the message (no base64 over WebSocket).
 */
import { useState, useRef, useEffect, useCallback, useLayoutEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { SendHorizontal, Square, X, Paperclip, Loader2, AtSign, ChevronDown, Cpu } from 'lucide-react';
import { FileTypeIcon } from './file-icon';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { hostApiFetch } from '@/lib/host-api';
import { invokeIpc } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useAgentsStore } from '@/stores/agents';
import {
  useChatStore,
  type ChatComposerDraft,
  type ChatComposerDraftUpdate,
  type ChatMessageDispatchOptions,
  type ComposerFileAttachment,
} from '@/stores/chat';
import { useProviderStore } from '@/stores/providers';
import { useSettingsStore } from '@/stores/settings';
import type { AgentSummary } from '@/types/agent';
import type { ProviderAccount } from '@/lib/providers';
import { buildProviderListItems } from '@/lib/provider-accounts';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CHAT_CONTENT_COLUMN_MAX_WIDTH_CLASS } from './layout';
import { ClampedFileName } from './ClampedFileName';

// ── Types ────────────────────────────────────────────────────────

export type FileAttachment = ComposerFileAttachment;

interface ChatInputProps {
  onSend: (
    text: string,
    attachments?: FileAttachment[],
    targetAgentId?: string | null,
    options?: ChatMessageDispatchOptions,
  ) => void;
  onQueueOfflineMessage?: (
    text: string,
    attachments?: FileAttachment[],
    targetAgentId?: string | null,
    options?: ChatMessageDispatchOptions,
  ) => void;
  onStop?: () => void;
  disabled?: boolean;
  sending?: boolean;
  isEmpty?: boolean;
  prefillText?: string;
  prefillNonce?: number;
  shellPaddingLeftPx?: number;
  shellPaddingRightPx?: number;
}

type ModelOption = {
  value: string;
  label: string;
};

const OPENAI_OAUTH_RUNTIME_PROVIDER = 'openai-codex';
const GOOGLE_OAUTH_RUNTIME_PROVIDER = 'google-gemini-cli';
const EMPTY_CHAT_COMPOSER_DRAFT: ChatComposerDraft = {
  text: '',
  attachments: [],
  targetAgentId: null,
};

function getRuntimeProviderKey(account: ProviderAccount): string {
  if (account.authMode === 'oauth_browser') {
    if (account.vendorId === 'openai') return OPENAI_OAUTH_RUNTIME_PROVIDER;
    if (account.vendorId === 'google') return GOOGLE_OAUTH_RUNTIME_PROVIDER;
  }
  if (account.vendorId === 'custom' || account.vendorId === 'ollama') {
    const prefix = `${account.vendorId}-`;
    if (account.id.startsWith(prefix)) {
      const suffix = account.id.slice(prefix.length);
      if (suffix.length === 8 && !suffix.includes('-')) {
        return account.id;
      }
    }
    return `${account.vendorId}-${account.id.replace(/-/g, '').slice(0, 8)}`;
  }
  if (account.vendorId === 'minimax-portal-cn') {
    return 'minimax-portal';
  }
  return account.vendorId;
}

function resolveComposerSessionKey(
  agents: AgentSummary[],
  currentSessionKey: string,
  targetAgentId: string | null,
): string {
  const normalizedTargetAgentId = (targetAgentId || '').trim().toLowerCase();
  if (!normalizedTargetAgentId) {
    return currentSessionKey;
  }

  return agents.find((agent) => agent.id === normalizedTargetAgentId)?.mainSessionKey
    || `agent:${normalizedTargetAgentId}:main`;
}


// ── Helpers ──────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function normalizePath(value: string): string {
  return value.trim().replace(/\//g, '\\').toLowerCase();
}

function buildPathAttachmentKey(filePath: string): string {
  return `path:${normalizePath(filePath)}`;
}

function buildBrowserFileAttachmentKey(file: Pick<File, 'name' | 'size' | 'type' | 'lastModified'>): string {
  return `file:${file.name.trim().toLowerCase()}|${file.size}|${(file.type || '').trim().toLowerCase()}|${file.lastModified}`;
}

function isDeferredSessionModelPersistenceError(error: unknown): boolean {
  const message = typeof error === 'string'
    ? error
    : error instanceof Error
      ? error.message
      : '';
  const normalized = message.trim().toLowerCase();
  return normalized.startsWith('session not found:')
    || normalized.startsWith('invalid sessionkey:');
}

/**
 * Read a browser File object as base64 string (without the data URL prefix).
 */
function readFileAsBase64(file: globalThis.File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (!dataUrl || !dataUrl.includes(',')) {
        reject(new Error(`Invalid data URL from FileReader for ${file.name}`));
        return;
      }
      const base64 = dataUrl.split(',')[1];
      if (!base64) {
        reject(new Error(`Empty base64 data for ${file.name}`));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

// ── Component ────────────────────────────────────────────────────

export function ChatInput({
  onSend,
  onQueueOfflineMessage,
  onStop,
  disabled = false,
  sending = false,
  prefillText,
  prefillNonce = 0,
  shellPaddingLeftPx,
  shellPaddingRightPx,
}: ChatInputProps) {
  const { t, i18n } = useTranslation('chat');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelSwitchPending, setModelSwitchPending] = useState(false);
  const [modelSwitchWidth, setModelSwitchWidth] = useState('180px');
  const [dragOver, setDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const pickerPanelRef = useRef<HTMLDivElement>(null);
  const modelMenuPanelRef = useRef<HTMLDivElement>(null);
  const modelLabelMeasureRef = useRef<HTMLSpanElement>(null);
  const isComposingRef = useRef(false);
  const [pickerMenuStyle, setPickerMenuStyle] = useState<{ left: number; bottom: number; width: number } | null>(null);
  const [modelMenuStyle, setModelMenuStyle] = useState<{ left: number; bottom: number; width: number } | null>(null);
  const agents = useAgentsStore((s) => s.agents);
  const defaultModelRef = useAgentsStore((s) => s.defaultModelRef);
  const providerAccounts = useProviderStore((s) => s.accounts);
  const providerStatuses = useProviderStore((s) => s.statuses);
  const providerVendors = useProviderStore((s) => s.vendors);
  const providerDefaultAccountId = useProviderStore((s) => s.defaultAccountId);
  const refreshProviderSnapshot = useProviderStore((s) => s.refreshProviderSnapshot);
  const chatFontScale = useSettingsStore((s) => s.chatFontScale);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const composerDraft = useChatStore(useCallback(
    (state) => state.composerDrafts[currentSessionKey] ?? EMPTY_CHAT_COMPOSER_DRAFT,
    [currentSessionKey],
  ));
  const setComposerDraft = useChatStore((s) => s.setComposerDraft);
  const clearComposerDraft = useChatStore((s) => s.clearComposerDraft);
  const sessions = useChatStore((s) => s.sessions);
  const sessionModels = useChatStore((s) => s.sessionModels);
  const input = composerDraft.text;
  const attachments = composerDraft.attachments;
  const targetAgentId = composerDraft.targetAgentId;
  const currentAgent = useMemo(
    () => (agents ?? []).find((agent) => agent.id === currentAgentId) ?? null,
    [agents, currentAgentId],
  );
  const previousSessionKeyRef = useRef(currentSessionKey);
  const currentAgentName = useMemo(
    () => currentAgent?.name ?? currentAgentId,
    [currentAgent, currentAgentId],
  );
  const mentionableAgents = useMemo(
    () => (agents ?? []).filter((agent) => agent.id !== currentAgentId),
    [agents, currentAgentId],
  );
  const selectedTarget = useMemo(
    () => (agents ?? []).find((agent) => agent.id === targetAgentId) ?? null,
    [agents, targetAgentId],
  );
  const activeComposerSessionKey = useMemo(
    () => resolveComposerSessionKey(agents ?? [], currentSessionKey, targetAgentId),
    [agents, currentSessionKey, targetAgentId],
  );
  const activeComposerSession = useMemo(
    () => (sessions ?? []).find((session) => session.key === activeComposerSessionKey) ?? null,
    [activeComposerSessionKey, sessions],
  );
  const allowLocalOnlyModelPersistence = !activeComposerSession && !activeComposerSessionKey.endsWith(':main');
  const showAgentPicker = mentionableAgents.length > 0;
  const inputFontSize = `${Math.round(15 * (chatFontScale / 100) * 10) / 10}px`;
  const providerItems = useMemo(
    () => buildProviderListItems(providerAccounts, providerStatuses, providerVendors, providerDefaultAccountId),
    [providerAccounts, providerDefaultAccountId, providerStatuses, providerVendors],
  );
  const modelOptions = useMemo<ModelOption[]>(() => (
    providerItems.flatMap((item) => {
      const runtimeProviderKey = getRuntimeProviderKey(item.account);
      return item.models
        .filter((model) => model.source !== 'recommended')
        .slice()
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((model) => ({
          value: `${runtimeProviderKey}/${model.id}`,
          label: `${item.displayName} / ${model.id}`,
        }));
    })
  ), [providerItems]);
  const sessionBackedModelRef = (
    sessionModels[activeComposerSessionKey]
    || activeComposerSession?.model
    || ''
  ).trim();
  const effectiveModelRef = (
    sessionBackedModelRef
    || defaultModelRef
    || ''
  ).trim();
  const selectedModelValue = useMemo(() => {
    // 会话已选模型优先反显，并与发送参数保持同源一致
    if (sessionBackedModelRef) {
      return sessionBackedModelRef;
    }
    return effectiveModelRef;
  }, [effectiveModelRef, sessionBackedModelRef]);
  const activeModelValue = selectedModelValue;
  const activeModelRef = activeModelValue || effectiveModelRef;
  const selectedModelLabel = useMemo(
    () => modelOptions.find((option) => option.value === selectedModelValue)?.label || selectedModelValue || t('composer.selectModel'),
    [modelOptions, selectedModelValue, t],
  );
  const isZh = (i18n?.resolvedLanguage || i18n?.language || '').startsWith('zh');
  const isModelInOptions = useCallback((modelRef: string | null | undefined) => {
    const normalized = (modelRef || '').trim();
    return !!normalized && modelOptions.some((option) => option.value === normalized);
  }, [modelOptions]);
  const getModelValidationErrorMessage = useCallback(() => (
    isZh
      ? '当前会话模型不可用，请在模型选择器中选择一个可用模型'
      : 'Current session model is unavailable. Select an available model before sending.'
  ), [isZh]);
  const getMissingModelErrorMessage = useCallback(() => (
    isZh
      ? '当前会话未选择模型，请先选择一个可用模型'
      : 'No model is selected for this session. Select an available model before sending.'
  ), [isZh]);
  const queueActionLabel = isZh ? '加入队列' : 'Queue to send';
  const canEditDraft = !disabled || !!onQueueOfflineMessage;
  const hasModelOptions = modelOptions.length > 0;
  const isModelSwitchUnavailable = !hasModelOptions;
  const isModelSwitchDisabled = isModelSwitchUnavailable || modelSwitchPending;
  const attachmentKeys = useMemo(
    () => new Set(attachments.map((attachment) => attachment.dedupeKey).filter(Boolean)),
    [attachments],
  );
  const updateComposerDraftForSession = useCallback((
    sessionKey: string,
    nextDraft: ChatComposerDraftUpdate,
  ) => {
    setComposerDraft(sessionKey, nextDraft);
  }, [setComposerDraft]);
  const updateCurrentComposerDraft = useCallback((
    nextDraft: ChatComposerDraftUpdate,
  ) => {
    updateComposerDraftForSession(currentSessionKey, nextDraft);
  }, [currentSessionKey, updateComposerDraftForSession]);
  const updateCurrentAttachments = useCallback((
    updater: FileAttachment[] | ((attachments: FileAttachment[]) => FileAttachment[]),
  ) => {
    updateCurrentComposerDraft((draft) => ({
      ...draft,
      attachments: typeof updater === 'function' ? updater(draft.attachments) : updater,
    }));
  }, [updateCurrentComposerDraft]);
  const updateCurrentTargetAgentId = useCallback((
    nextTargetAgentId: string | null | ((currentTargetAgentId: string | null) => string | null),
  ) => {
    updateCurrentComposerDraft((draft) => ({
      ...draft,
      targetAgentId: typeof nextTargetAgentId === 'function'
        ? nextTargetAgentId(draft.targetAgentId)
        : nextTargetAgentId,
    }));
  }, [updateCurrentComposerDraft]);

  useLayoutEffect(() => {
    const measuredLabelWidth = modelLabelMeasureRef.current?.offsetWidth ?? 0;
    const nextWidthPx = Math.min(Math.max(Math.ceil(measuredLabelWidth + 64), 150), 360);
    setModelSwitchWidth(`${nextWidthPx}px`);
  }, [selectedModelLabel]);

  const updatePickerMenuPosition = useCallback(() => {
    const anchor = pickerRef.current;
    if (!anchor) {
      setPickerMenuStyle(null);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const viewportPadding = 12;
    const width = Math.min(288, Math.max(window.innerWidth - viewportPadding * 2, 200));
    const left = Math.min(
      Math.max(rect.left, viewportPadding),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
    );

    setPickerMenuStyle({
      left,
      bottom: Math.max(window.innerHeight - rect.top + 8, viewportPadding),
      width,
    });
  }, []);

  const updateModelMenuPosition = useCallback(() => {
    const anchor = modelMenuRef.current;
    if (!anchor) {
      setModelMenuStyle(null);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const viewportPadding = 12;
    const width = Math.min(
      Math.max(Math.ceil(rect.width), 180),
      Math.max(window.innerWidth - viewportPadding * 2, 220),
      360,
    );
    const left = Math.min(
      Math.max(rect.left, viewportPadding),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
    );

    setModelMenuStyle({
      left,
      bottom: Math.max(window.innerHeight - rect.top + 8, viewportPadding),
      width,
    });
  }, []);

  useLayoutEffect(() => {
    if (previousSessionKeyRef.current === currentSessionKey) {
      return;
    }
    previousSessionKeyRef.current = currentSessionKey;
    setPickerOpen(false);
    setModelMenuOpen(false);
    setDragOver(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [currentSessionKey]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  // Focus textarea on mount (avoids Windows focus loss after session delete + native dialog)
  useEffect(() => {
    if (canEditDraft && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [canEditDraft]);

  useEffect(() => {
    if (!targetAgentId) return;
    if (targetAgentId === currentAgentId) {
      updateCurrentTargetAgentId(null);
      setPickerOpen(false);
      return;
    }
    if (!(agents ?? []).some((agent) => agent.id === targetAgentId)) {
      updateCurrentTargetAgentId(null);
      setPickerOpen(false);
    }
  }, [agents, currentAgentId, targetAgentId, updateCurrentTargetAgentId]);

  useEffect(() => {
    if (!pickerOpen) return;
    updatePickerMenuPosition();

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!pickerRef.current?.contains(target) && !pickerPanelRef.current?.contains(target)) {
        setPickerOpen(false);
      }
    };
    const handleViewportChange = () => updatePickerMenuPosition();

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [pickerOpen, updatePickerMenuPosition]);

  useEffect(() => {
    if (!modelMenuOpen) return;
    updateModelMenuPosition();

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!modelMenuRef.current?.contains(target) && !modelMenuPanelRef.current?.contains(target)) {
        setModelMenuOpen(false);
      }
    };
    const handleViewportChange = () => updateModelMenuPosition();

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [modelMenuOpen, updateModelMenuPosition]);

  useEffect(() => {
    if (providerAccounts.length > 0 || providerStatuses.length > 0 || providerVendors.length > 0) return;
    void refreshProviderSnapshot();
  }, [providerAccounts.length, providerStatuses.length, providerVendors.length, refreshProviderSnapshot]);

  useEffect(() => {
    setModelMenuOpen(false);
  }, [currentAgentId]);

  // ── File staging via native dialog ─────────────────────────────

  const pickFiles = useCallback(async () => {
    if (!canEditDraft) return;
    const draftSessionKey = currentSessionKey;
    try {
      const result = await invokeIpc('dialog:open', {
        properties: ['openFile', 'multiSelections'],
      }) as { canceled: boolean; filePaths?: string[] };
      if (result.canceled || !result.filePaths?.length) return;

      const seenKeys = new Set(attachmentKeys);
      let skippedDuplicates = false;
      const nextFilePaths = result.filePaths.filter((filePath) => {
        const key = buildPathAttachmentKey(filePath);
        if (seenKeys.has(key)) {
          skippedDuplicates = true;
          return false;
        }
        seenKeys.add(key);
        return true;
      });
      if (skippedDuplicates) {
        toast.warning('不要重复添加文件');
      }
      if (nextFilePaths.length === 0) return;

      // Add placeholder entries immediately
      const tempIds: string[] = [];
      const placeholders = nextFilePaths.map((filePath) => {
        const tempId = crypto.randomUUID();
        tempIds.push(tempId);
        return {
          id: tempId,
          fileName: filePath.split(/[\\/]/).pop() || 'file',
          mimeType: '',
          fileSize: 0,
          dedupeKey: buildPathAttachmentKey(filePath),
          stagedPath: '',
          preview: null,
          status: 'staging' as const,
        };
      });
      updateComposerDraftForSession(draftSessionKey, (draft) => ({
        ...draft,
        attachments: [...draft.attachments, ...placeholders],
      }));

      // Stage all files via IPC
      console.log('[pickFiles] Staging files:', nextFilePaths);
      const staged = await hostApiFetch<Array<{
        id: string;
        fileName: string;
        mimeType: string;
        fileSize: number;
        stagedPath: string;
        preview: string | null;
      }>>('/api/files/stage-paths', {
        method: 'POST',
        body: JSON.stringify({
          filePaths: nextFilePaths,
          sessionKey: activeComposerSessionKey,
        }),
      });
      console.log('[pickFiles] Stage result:', staged?.map(s => ({ id: s?.id, fileName: s?.fileName, mimeType: s?.mimeType, fileSize: s?.fileSize, stagedPath: s?.stagedPath, hasPreview: !!s?.preview })));
      const stagedItems = Array.isArray(staged) ? staged : [];

      // Update each placeholder with real data
      updateComposerDraftForSession(draftSessionKey, (draft) => {
        let updated = [...draft.attachments];
        for (let i = 0; i < tempIds.length; i++) {
          const tempId = tempIds[i];
          const data = stagedItems[i];
          if (data) {
            updated = updated.map(a =>
              a.id === tempId
                ? { ...data, dedupeKey: buildPathAttachmentKey(nextFilePaths[i] || data.stagedPath), status: 'ready' as const }
                : a,
            );
          } else {
            console.warn(`[pickFiles] No staged data for tempId=${tempId} at index ${i}`);
            updated = updated.map(a =>
              a.id === tempId
                ? { ...a, status: 'error' as const, error: 'Staging failed' }
                : a,
            );
          }
        }
        return {
          ...draft,
          attachments: updated,
        };
      });
    } catch (err) {
      console.error('[pickFiles] Failed to stage files:', err);
      // Mark any stuck 'staging' attachments as 'error' so the user can remove them
      // and the send button isn't permanently blocked
      updateComposerDraftForSession(draftSessionKey, (draft) => ({
        ...draft,
        attachments: draft.attachments.map((attachment) => (
          attachment.status === 'staging'
            ? { ...attachment, status: 'error' as const, error: String(err) }
            : attachment
        )),
      }));
    }
  }, [activeComposerSessionKey, attachmentKeys, canEditDraft, currentSessionKey, updateComposerDraftForSession]);

  // ── Stage browser File objects (paste / drag-drop) ─────────────

  const stageBufferFiles = useCallback(async (files: globalThis.File[]) => {
    if (!canEditDraft) return;
    const draftSessionKey = currentSessionKey;
    const seenKeys = new Set(attachmentKeys);
    let skippedDuplicates = false;
    const nextFiles = files.filter((file) => {
      const key = buildBrowserFileAttachmentKey(file);
      if (seenKeys.has(key)) {
        skippedDuplicates = true;
        return false;
      }
      seenKeys.add(key);
      return true;
    });
    if (skippedDuplicates) {
      toast.warning('不要重复添加文件');
    }

    for (const file of nextFiles) {
      const tempId = crypto.randomUUID();
      updateComposerDraftForSession(draftSessionKey, (draft) => ({
        ...draft,
        attachments: [...draft.attachments, {
          id: tempId,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          fileSize: file.size,
          dedupeKey: buildBrowserFileAttachmentKey(file),
          stagedPath: '',
          preview: null,
          status: 'staging' as const,
        }],
      }));

      try {
        console.log(`[stageBuffer] Reading file: ${file.name} (${file.type}, ${file.size} bytes)`);
        const base64 = await readFileAsBase64(file);
        console.log(`[stageBuffer] Base64 length: ${base64?.length ?? 'null'}`);
        const staged = await hostApiFetch<{
          id: string;
          fileName: string;
          mimeType: string;
          fileSize: number;
          stagedPath: string;
          preview: string | null;
        }>('/api/files/stage-buffer', {
          method: 'POST',
          body: JSON.stringify({
            base64,
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            sessionKey: activeComposerSessionKey,
          }),
        });
        console.log(`[stageBuffer] Staged: id=${staged?.id}, path=${staged?.stagedPath}, size=${staged?.fileSize}`);
        updateComposerDraftForSession(draftSessionKey, (draft) => ({
          ...draft,
          attachments: draft.attachments.map((attachment) => (
            attachment.id === tempId
              ? { ...staged, dedupeKey: buildBrowserFileAttachmentKey(file), status: 'ready' as const }
              : attachment
          )),
        }));
      } catch (err) {
        console.error(`[stageBuffer] Error staging ${file.name}:`, err);
        updateComposerDraftForSession(draftSessionKey, (draft) => ({
          ...draft,
          attachments: draft.attachments.map((attachment) => (
            attachment.id === tempId
              ? { ...attachment, status: 'error' as const, error: String(err) }
              : attachment
          )),
        }));
      }
    }
  }, [activeComposerSessionKey, attachmentKeys, canEditDraft, currentSessionKey, updateComposerDraftForSession]);

  // ── Attachment management ──────────────────────────────────────

  const removeAttachment = useCallback((id: string) => {
    updateCurrentAttachments((currentAttachments) => currentAttachments.filter((attachment) => attachment.id !== id));
  }, [updateCurrentAttachments]);

  const allReady = attachments.length === 0 || attachments.every(a => a.status === 'ready');
  const hasFailedAttachments = attachments.some((a) => a.status === 'error');
  const hasDraftContent = input.trim().length > 0 || attachments.length > 0;
  const canSend = hasDraftContent && allReady && !disabled && !sending;
  const canQueueDraft = hasDraftContent && allReady && !!onQueueOfflineMessage && (disabled || sending);
  const canStop = sending && !!onStop;
  const canPrimaryAction = canSend || canQueueDraft || canStop;
  const primaryActionTitle = sending
    ? (canQueueDraft ? queueActionLabel : t('composer.stop'))
    : (canQueueDraft ? queueActionLabel : t('composer.send'));

  useEffect(() => {
    if (!prefillText || prefillNonce === 0) {
      return;
    }
    updateCurrentComposerDraft((draft) => ({
      ...draft,
      text: prefillText,
    }));
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.focus();
      const cursor = prefillText.length;
      textareaRef.current.setSelectionRange(cursor, cursor);
    });
  }, [prefillNonce, prefillText, updateCurrentComposerDraft]);

  const setSessionModel = useCallback((modelRef: string | null) => {
    useChatStore.setState((state) => {
      const nextSessionModels = { ...state.sessionModels };
      if (modelRef) {
        nextSessionModels[activeComposerSessionKey] = modelRef;
      } else {
        delete nextSessionModels[activeComposerSessionKey];
      }

      return {
        sessionModels: nextSessionModels,
        sessions: state.sessions.map((session) => (
          session.key !== activeComposerSessionKey
            ? session
            : (
                modelRef
                  ? { ...session, model: modelRef }
                  : (() => {
                      const { model: _model, ...rest } = session;
                      return rest;
                    })()
              )
        )),
      };
    });
  }, [activeComposerSessionKey]);

  const handleModelChange = useCallback(async (nextModelRef: string) => {
    const normalizedNextModelRef = (nextModelRef || '').trim();
    const previousModelValue = selectedModelValue;
    const nextOption = modelOptions.find((option) => option.value === normalizedNextModelRef);
    const nextLabel = nextOption?.label || normalizedNextModelRef || t('composer.selectModel');
    const previousLabel = modelOptions.find((option) => option.value === previousModelValue)?.label
      || selectedModelLabel
      || t('composer.selectModel');
    const applyLocalModelSelection = () => {
      setSessionModel(normalizedNextModelRef || null);
      toast.success(t('composer.modelSwitchSuccess', { model: nextLabel }));
    };

    if (normalizedNextModelRef === previousModelValue) {
      return;
    }

    if (allowLocalOnlyModelPersistence) {
      applyLocalModelSelection();
      return;
    }

    try {
      setModelSwitchPending(true);
      const result = await hostApiFetch<{ success?: boolean; error?: string }>(
        '/api/sessions/model',
        {
          method: 'POST',
          body: JSON.stringify({
            sessionKey: activeComposerSessionKey,
            modelRef: normalizedNextModelRef || null,
          }),
        },
      );

      if (!result?.success) {
        if (allowLocalOnlyModelPersistence || isDeferredSessionModelPersistenceError(result?.error)) {
          applyLocalModelSelection();
          return;
        }
        throw new Error(result?.error || 'Failed to persist session model');
      }

      applyLocalModelSelection();
    } catch (error) {
      if (allowLocalOnlyModelPersistence || isDeferredSessionModelPersistenceError(error)) {
        applyLocalModelSelection();
        return;
      }
      toast.error(t('composer.modelSwitchFailed', {
        model: previousLabel,
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setModelSwitchPending(false);
    }
  }, [activeComposerSessionKey, allowLocalOnlyModelPersistence, modelOptions, selectedModelLabel, selectedModelValue, setSessionModel, t]);

  const handleSubmitDraft = useCallback(async () => {
    if (!canSend && !canQueueDraft) return;
    const modelRefForDispatch = (activeModelRef || '').trim();
    if (!modelRefForDispatch) {
      toast.error(getMissingModelErrorMessage());
      return;
    }
    if (!isModelInOptions(modelRefForDispatch)) {
      toast.error(getModelValidationErrorMessage());
      return;
    }
    const readyAttachments = attachments.filter(a => a.status === 'ready');
    // Capture values before clearing — clear input immediately for snappy UX,
    // but keep attachments available for the async send
    const textToSend = input.trim();
    const attachmentsToSend = readyAttachments.length > 0 ? readyAttachments : undefined;
    console.log(`[handleSend] text="${textToSend.substring(0, 50)}", attachments=${attachments.length}, ready=${readyAttachments.length}, sending=${!!attachmentsToSend}`);
    if (attachmentsToSend) {
      console.log('[handleSend] Attachment details:', attachmentsToSend.map(a => ({
        id: a.id, fileName: a.fileName, mimeType: a.mimeType, fileSize: a.fileSize,
        stagedPath: a.stagedPath, status: a.status, hasPreview: !!a.preview,
      })));
    }
    clearComposerDraft(currentSessionKey);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    if (canQueueDraft) {
      onQueueOfflineMessage?.(textToSend, attachmentsToSend, targetAgentId, {
        sessionKey: activeComposerSessionKey,
        modelRef: modelRefForDispatch,
      });
      toast.success(isZh ? '已加入待发送队列' : 'Added to the send queue');
    } else {
      onSend(textToSend, attachmentsToSend, targetAgentId, {
        sessionKey: activeComposerSessionKey,
        modelRef: modelRefForDispatch,
      });
    }
    setPickerOpen(false);
  }, [
    activeComposerSessionKey,
    activeModelRef,
    attachments,
    canQueueDraft,
    canSend,
    clearComposerDraft,
    currentSessionKey,
    getMissingModelErrorMessage,
    getModelValidationErrorMessage,
    input,
    isModelInOptions,
    isZh,
    onQueueOfflineMessage,
    onSend,
    targetAgentId,
  ]);

  const handleStop = useCallback(() => {
    if (!canStop) return;
    onStop?.();
  }, [canStop, onStop]);

  const handlePrimaryAction = useCallback(() => {
    if (canQueueDraft || !sending) {
      void handleSubmitDraft();
      return;
    }
    handleStop();
  }, [canQueueDraft, handleStop, handleSubmitDraft, sending]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Backspace' && !input && targetAgentId) {
        updateCurrentTargetAgentId(null);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        const nativeEvent = e.nativeEvent as KeyboardEvent;
        if (isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) {
          return;
        }
        e.preventDefault();
        void handleSubmitDraft();
      }
    },
    [handleSubmitDraft, input, targetAgentId, updateCurrentTargetAgentId],
  );

  // Handle paste (Ctrl/Cmd+V with files)
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (!canEditDraft) return;
      const items = e.clipboardData?.items;
      if (!items) return;

      const pastedFiles: globalThis.File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) pastedFiles.push(file);
        }
      }
      if (pastedFiles.length > 0) {
        e.preventDefault();
        stageBufferFiles(pastedFiles);
      }
    },
    [canEditDraft, stageBufferFiles],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (!canEditDraft) return;
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (e.dataTransfer?.files?.length) {
        stageBufferFiles(Array.from(e.dataTransfer.files));
      }
    },
    [canEditDraft, stageBufferFiles],
  );

  return (
      <div
        data-testid="chat-composer-shell"
        data-session-key={currentSessionKey}
        className={cn(
          'relative w-full pt-0 pb-2 transition-all duration-300',
          (pickerOpen || modelMenuOpen) && 'z-[140]',
        )}
        style={{
          paddingLeft: shellPaddingLeftPx != null ? `${shellPaddingLeftPx}px` : '1rem',
          paddingRight: shellPaddingRightPx != null ? `${shellPaddingRightPx}px` : '1rem',
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className={cn('mx-auto w-full', CHAT_CONTENT_COLUMN_MAX_WIDTH_CLASS)}>
        {/* Attachment Previews */}
        {attachments.length > 0 && (
          <div className="mb-3 grid grid-cols-3 gap-2">
            {attachments.map((att) => (
              <AttachmentPreview
                key={att.id}
                attachment={att}
                onRemove={() => removeAttachment(att.id)}
              />
            ))}
          </div>
        )}

        {/* Input Row */}
        <div className={cn(
          'relative rounded-[20px] border px-3 pb-3 pt-3 shadow-[0_20px_56px_rgba(15,23,42,0.12)] backdrop-blur-xl transition-all',
          'bg-[linear-gradient(180deg,rgba(255,255,255,0.84)_0%,rgba(248,250,252,0.72)_100%)] dark:bg-[linear-gradient(180deg,rgba(39,48,64,0.96)_0%,rgba(34,42,56,0.92)_100%)]',
          dragOver ? 'border-primary/60 ring-2 ring-primary/20' : 'border-black/8 dark:border-white/[0.14]'
        )} data-testid="chat-composer">
          {selectedTarget && (
            <div className="px-2.5 pb-1 pt-1">
              <button
                type="button"
                onClick={() => updateCurrentTargetAgentId(null)}
                className="inline-flex items-center gap-1.5 rounded-[10px] border border-primary/20 bg-primary/7 px-3 py-1 text-[13px] font-medium text-foreground transition-colors hover:bg-primary/12"
                title={t('composer.clearTarget')}
              >
                <span>{t('composer.targetChip', { agent: selectedTarget.name })}</span>
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
          )}

          <div className="flex items-start gap-2.5">
            <div className="relative flex-1">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => updateCurrentComposerDraft((draft) => ({
                  ...draft,
                  text: e.target.value,
                }))}
                onKeyDown={handleKeyDown}
                onCompositionStart={() => {
                  isComposingRef.current = true;
                }}
                onCompositionEnd={() => {
                  isComposingRef.current = false;
                }}
                onPaste={handlePaste}
                placeholder={disabled && !input ? t('composer.gatewayDisconnectedPlaceholder') : t('composer.messagePlaceholder')}
                disabled={!canEditDraft}
                className="min-h-[24px] max-h-[220px] resize-none border-0 bg-transparent px-3 py-1 leading-[1.6] tracking-[0.01em] text-foreground shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/52"
                rows={1}
                style={{ fontSize: inputFontSize }}
              />
            </div>

            <Button
              onClick={handlePrimaryAction}
              disabled={!canPrimaryAction}
              size="icon"
              data-testid="chat-send-button-hidden"
              className={`hidden shrink-0 h-10 w-10 rounded-[12px] transition-colors ${
                (sending || canSend || canQueueDraft)
                  ? 'bg-[linear-gradient(135deg,#4f8df7_0%,#2f6fe4_100%)] text-white shadow-[0_10px_24px_rgba(47,111,228,0.28)] hover:brightness-105'
                  : 'bg-transparent text-muted-foreground/40 hover:bg-transparent'
              }`}
              variant={sending || canSend || canQueueDraft ? 'default' : 'ghost'}
              title={primaryActionTitle}
            >
              {sending ? (
                <Square className="h-4 w-4" fill="currentColor" />
              ) : (
                <SendHorizontal className="h-[18px] w-[18px]" strokeWidth={2} />
              )}
            </Button>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-2">
            <div className="flex flex-wrap items-center gap-0">
            <button
              type="button"
              data-testid="chat-attach-button"
              className="inline-flex h-9 items-center gap-2 rounded-[10px] px-3 text-[13px] font-medium text-foreground/68 transition-colors hover:bg-black/5 hover:text-foreground/82 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/8"
              onClick={pickFiles}
              disabled={!canEditDraft}
              title={t('composer.attachFiles')}
            >
              <Paperclip className="h-4 w-4" />
              <span>文件</span>
            </button>

            {showAgentPicker && (
              <div ref={pickerRef} className="relative">
                <button
                  type="button"
                  data-testid="chat-agent-picker-button"
                className={cn(
                  'inline-flex h-9 items-center gap-2 rounded-[10px] px-3 text-[13px] font-medium text-foreground/68 transition-colors hover:bg-black/5 hover:text-foreground/82 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/8',
                  (pickerOpen || selectedTarget) && 'bg-primary/10 text-primary hover:bg-primary/20'
                )}
                onClick={() => setPickerOpen((open) => !open)}
                disabled={!canEditDraft}
                title={t('composer.role', '角色')}
              >
                <AtSign className="h-4 w-4" />
                <span>{selectedTarget ? selectedTarget.name : t('composer.role', '角色')}</span>
                {selectedTarget && (
                    <span
                      role="button"
                      aria-label={t('common:actions.clear', 'Clear')}
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground/80 hover:bg-black/10 hover:text-foreground dark:hover:bg-white/10"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        updateCurrentTargetAgentId(null);
                        setPickerOpen(false);
                        textareaRef.current?.focus();
                      }}
                    >
                      <X className="h-3 w-3" />
                    </span>
                  )}
                </button>
              </div>
            )}

            <div ref={modelMenuRef} className="relative">
              <span
                ref={modelLabelMeasureRef}
                aria-hidden="true"
                className="pointer-events-none absolute -z-10 overflow-hidden whitespace-nowrap px-0 text-[13px] font-medium opacity-0"
              >
                {selectedModelLabel}
              </span>
              <button
                type="button"
                data-testid="chat-model-switch"
                className={cn(
                  'inline-flex h-9 max-w-full items-center gap-1.5 rounded-[10px] pl-2.5 pr-2 text-[13px] font-medium text-foreground/68 transition-colors',
                  !isModelSwitchDisabled && 'hover:bg-black/5 hover:text-foreground/82 dark:hover:bg-white/8',
                  isModelSwitchUnavailable && 'cursor-not-allowed opacity-50',
                  modelSwitchPending && 'cursor-wait opacity-50 text-foreground/62'
                )}
                title={t('composer.switchModel')}
                style={{ width: modelSwitchWidth }}
                onClick={() => {
                  if (!isModelSwitchDisabled) {
                    setModelMenuOpen((open) => !open);
                  }
                }}
                disabled={isModelSwitchDisabled}
                aria-busy={modelSwitchPending}
              >
                <Cpu aria-hidden="true" className="pointer-events-none h-4 w-4 shrink-0 text-current" />
                <span
                  aria-hidden="true"
                  className="pointer-events-none min-w-0 flex-1 overflow-hidden whitespace-nowrap text-clip text-left text-current"
                >
                  {selectedModelLabel}
                </span>
                <span
                  className="pointer-events-none flex h-4 w-4 shrink-0 items-center justify-center"
                  data-testid="chat-model-switch-trailing"
                >
                  {modelSwitchPending ? (
                    <Loader2
                      data-testid="chat-model-switch-spinner"
                      className="h-4 w-4 animate-spin text-current"
                    />
                  ) : (
                    <ChevronDown
                      data-testid="chat-model-switch-chevron"
                      className="h-4 w-4 text-current"
                    />
                  )}
                </span>
              </button>
            </div>

            </div>

            <Button
              onClick={handlePrimaryAction}
              disabled={!canPrimaryAction}
              size="icon"
              data-testid="chat-send-button"
              className={`shrink-0 h-10 w-10 rounded-[12px] transition-colors ${
                (sending || canSend || canQueueDraft)
                  ? 'bg-[linear-gradient(135deg,#4f8df7_0%,#2f6fe4_100%)] text-white shadow-[0_10px_24px_rgba(47,111,228,0.28)] hover:brightness-105'
                  : 'bg-transparent text-muted-foreground/40 hover:bg-transparent'
              }`}
              variant={sending || canSend || canQueueDraft ? 'default' : 'ghost'}
              title={primaryActionTitle}
            >
              {sending ? (
                <Square className="h-4 w-4" fill="currentColor" />
              ) : (
                <SendHorizontal className="h-[18px] w-[18px]" strokeWidth={2} />
              )}
            </Button>
          </div>
        </div>
        {hasFailedAttachments && (
          <Button
            variant="link"
            size="sm"
            className="mt-2.5 h-auto px-4 py-0 text-[11px] text-muted-foreground/58"
            onClick={() => {
              updateCurrentAttachments((currentAttachments) => currentAttachments.filter((attachment) => attachment.status !== 'error'));
              void pickFiles();
            }}
          >
            {t('composer.retryFailedAttachments')}
          </Button>
        )}
        <p
          data-testid="chat-composer-disclaimer"
          className="mt-2 px-2 text-center text-xs leading-5 text-black dark:text-white/90"
        >
          {t('composer.disclaimer')}
        </p>
        {pickerOpen && pickerMenuStyle && createPortal(
          <div
            ref={pickerPanelRef}
            data-testid="chat-agent-picker-menu"
            className="fixed z-[180] overflow-hidden rounded-xl border border-black/10 bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-card"
            style={{
              left: `${pickerMenuStyle.left}px`,
              bottom: `${pickerMenuStyle.bottom}px`,
              width: `${pickerMenuStyle.width}px`,
            }}
          >
            <div className="px-3 py-2 text-[11px] font-medium text-muted-foreground/80">
              {t('composer.agentPickerTitle', { currentAgent: currentAgentName })}
            </div>
            <div className="max-h-64 overflow-y-auto">
              {mentionableAgents.map((agent) => (
                <AgentPickerItem
                  key={agent.id}
                  agent={agent}
                  selected={agent.id === targetAgentId}
                  onSelect={() => {
                    updateCurrentTargetAgentId((current) => (current === agent.id ? null : agent.id));
                    setPickerOpen(false);
                    textareaRef.current?.focus();
                  }}
                />
              ))}
            </div>
          </div>,
          document.body,
        )}
        {modelMenuOpen && !isModelSwitchDisabled && modelMenuStyle && createPortal(
          <div
            ref={modelMenuPanelRef}
            data-testid="chat-model-switch-menu"
            className="fixed z-[180] overflow-hidden rounded-xl border border-black/10 bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-card"
            style={{
              left: `${modelMenuStyle.left}px`,
              bottom: `${modelMenuStyle.bottom}px`,
              width: `${modelMenuStyle.width}px`,
            }}
          >
            <div className="max-h-64 overflow-y-auto">
              {modelOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={cn(
                    'flex w-full items-center rounded-[10px] px-3 py-2 text-left text-[13px] font-medium transition-colors',
                    option.value === activeModelValue
                      ? 'bg-primary text-primary-foreground'
                      : 'text-foreground/82 hover:bg-black/5 dark:hover:bg-white/5'
                  )}
                  onClick={() => {
                    setModelMenuOpen(false);
                    void handleModelChange(option.value);
                  }}
                >
                  <span className="truncate">{option.label}</span>
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
      </div>
    </div>
  );
}

// ── Attachment Preview ───────────────────────────────────────────

function AttachmentPreview({
  attachment,
  onRemove,
}: {
  attachment: FileAttachment;
  onRemove: () => void;
}) {
  const { t } = useTranslation(['chat', 'common']);

  return (
    <div className="relative min-w-0 overflow-hidden rounded-xl border border-black/10 bg-white/80 shadow-[0_14px_34px_rgba(15,23,42,0.08)] backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.06]">
      <div data-testid="chat-input-attachment-body" className="flex h-14 min-w-0 items-center gap-3 px-3">
        <FileTypeIcon mimeType={attachment.mimeType} fileName={attachment.fileName} />
        <div className="min-w-0 flex-1 overflow-hidden leading-tight flex flex-col justify-center">
          <ClampedFileName
            text={attachment.fileName}
            metaText={attachment.fileSize > 0 ? formatFileSize(attachment.fileSize) : '...'}
            containerClassName="h-8"
            textClassName="text-[13px] font-medium leading-[1.25]"
            metaClassName="text-[10px] leading-[1.25]"
            fadeTestId="chat-input-attachment-fade"
            textTestId="chat-input-attachment-name"
          />
        </div>
      </div>

      {/* Staging overlay */}
      {attachment.status === 'staging' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/35">
          <Loader2 className="h-4 w-4 text-white animate-spin" />
        </div>
      )}

      {/* Error overlay */}
      {attachment.status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-destructive/20">
          <span className="text-[10px] text-destructive font-medium px-1">{t('common:status.error')}</span>
        </div>
      )}

      <button
        onClick={onRemove}
        className="absolute right-1.5 top-1.5 rounded-[8px] border border-black/8 bg-white/92 p-1 text-foreground shadow-sm transition-colors hover:bg-white dark:border-white/10 dark:bg-black/70 dark:hover:bg-black"
        title={t('filePreview.removeFile')}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function AgentPickerItem({
  agent,
  selected,
  onSelect,
}: {
  agent: AgentSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full flex-col items-start rounded-[10px] px-3 py-2 text-left transition-colors',
        selected ? 'bg-primary/10 text-foreground' : 'hover:bg-black/5 dark:hover:bg-white/5'
      )}
    >
      <span className="text-[14px] font-medium text-foreground">{agent.name}</span>
      <span className="text-[11px] text-muted-foreground">
        {agent.modelDisplay}
      </span>
    </button>
  );
}
