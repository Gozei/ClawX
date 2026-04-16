/**
 * Chat Input Component
 * Textarea with send button and universal file upload support.
 * Enter to send, Shift+Enter for new line.
 * Supports: native file picker, clipboard paste, drag & drop.
 * Files are staged to disk via IPC — only lightweight path references
 * are sent with the message (no base64 over WebSocket).
 */
import { useState, useRef, useEffect, useCallback, useLayoutEffect, useMemo } from 'react';
import { SendHorizontal, Square, X, Paperclip, Music, FileArchive, File, Loader2, AtSign, FileCode, FileImage, ChevronDown, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { hostApiFetch } from '@/lib/host-api';
import { invokeIpc } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useProviderStore } from '@/stores/providers';
import { useSettingsStore } from '@/stores/settings';
import type { AgentSummary } from '@/types/agent';
import type { ProviderAccount } from '@/lib/providers';
import { buildProviderListItems, type ProviderListItem } from '@/lib/provider-accounts';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

// ── Types ────────────────────────────────────────────────────────

export interface FileAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  dedupeKey?: string;
  stagedPath: string;        // disk path for gateway
  preview: string | null;    // data URL for images, null for others
  status: 'staging' | 'ready' | 'error';
  error?: string;
}

interface ChatInputProps {
  onSend: (text: string, attachments?: FileAttachment[], targetAgentId?: string | null) => void;
  onQueueOfflineMessage?: (text: string, attachments?: FileAttachment[], targetAgentId?: string | null) => void;
  onStop?: () => void;
  disabled?: boolean;
  sending?: boolean;
  isEmpty?: boolean;
  prefillText?: string;
  prefillNonce?: number;
}

type ModelOption = {
  value: string;
  label: string;
  accountId: string;
  vendorId: ProviderAccount['vendorId'];
  modelId: string;
  authMode: ProviderAccount['authMode'];
  baseUrl?: string;
  apiProtocol?: ProviderAccount['apiProtocol'];
  validationKey: string;
};

const OPENAI_OAUTH_RUNTIME_PROVIDER = 'openai-codex';
const GOOGLE_OAUTH_RUNTIME_PROVIDER = 'google-gemini-cli';

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

function getConfiguredModelIds(account: ProviderAccount): string[] {
  return Array.from(new Set([
    account.model || '',
    ...(account.metadata?.customModels ?? []),
  ].map((model) => model.trim()).filter(Boolean)));
}

function resolveModelSourceAccount(item: ProviderListItem, modelId: string): ProviderAccount {
  const normalizedModelId = modelId.trim();
  return [item.account, ...item.aliases].find((account) => (
    getConfiguredModelIds(account).includes(normalizedModelId)
  )) ?? item.account;
}

function getModelApiProtocol(
  account: ProviderAccount,
  modelId: string,
): ProviderAccount['apiProtocol'] | undefined {
  return account.metadata?.modelProtocols?.[modelId] || account.apiProtocol;
}

function shouldValidateModelOption(option: ModelOption): boolean {
  return option.authMode === 'api_key' || option.authMode === 'local';
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return String(error);
}


// ── Helpers ──────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function FileExtIcon({ ext, color, className }: { ext: string; color: string; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" fill={`${color}20`}/>
      <path d="M14 2v4a2 2 0 0 0 2 2h4"/>
      <text x="12" y="18" fontSize="6.5" fontFamily="sans-serif" fontWeight="bold" textAnchor="middle" stroke="none" fill={color}>{ext.toUpperCase()}</text>
    </svg>
  );
}

function FileIcon({ mimeType, fileName, className }: { mimeType: string; fileName?: string; className?: string }) {
  const t = mimeType.toLowerCase();
  const n = (fileName || '').toLowerCase();

  if (t.startsWith('image/') || t.startsWith('video/') || n.match(/\.(jpg|jpeg|png|gif|webp|mp4|mov|avi|webm)$/i)) return <FileImage color="#8b5cf6" className={className} />;
  if (t.startsWith('audio/') || n.match(/\.(mp3|wav|ogg|m4a)$/i)) return <Music color="#eab308" className={className} />;
  if (t.includes('pdf') || n.endsWith('.pdf')) return <FileExtIcon ext="PDF" color="#ef4444" className={className} />;
  if (t.includes('spreadsheet') || t.includes('excel') || t.includes('csv') || n.match(/\.(xls|xlsx|csv)$/i)) return <FileExtIcon ext="XLS" color="#22c55e" className={className} />;
  if (t.includes('wordprocessing') || t.includes('msword') || t.includes('document') || n.match(/\.(doc|docx)$/i)) return <FileExtIcon ext="DOC" color="#3b82f6" className={className} />;
  if (t.includes('presentation') || t.includes('powerpoint') || n.match(/\.(ppt|pptx)$/i)) return <FileExtIcon ext="PPT" color="#f97316" className={className} />;
  if (t.startsWith('text/') || t === 'application/json' || t === 'application/xml' || n.match(/\.(txt|json|xml|md|csv|log)$/i)) return <FileCode color="#64748b" className={className} />;
  if (t.includes('zip') || t.includes('compressed') || t.includes('archive') || t.includes('tar') || t.includes('rar') || t.includes('7z') || n.match(/\.(zip|rar|7z|tar|gz)$/i)) return <FileArchive color="#ec4899" className={className} />;

  return <File color="#94a3b8" className={className} />;
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
}: ChatInputProps) {
  const { t, i18n } = useTranslation('chat');
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [targetAgentId, setTargetAgentId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelSwitchWidth, setModelSwitchWidth] = useState('180px');
  const [dragOver, setDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const modelLabelMeasureRef = useRef<HTMLSpanElement>(null);
  const isComposingRef = useRef(false);
  const agents = useAgentsStore((s) => s.agents);
  const defaultModelRef = useAgentsStore((s) => s.defaultModelRef);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const providerAccounts = useProviderStore((s) => s.accounts);
  const providerStatuses = useProviderStore((s) => s.statuses);
  const providerVendors = useProviderStore((s) => s.vendors);
  const providerDefaultAccountId = useProviderStore((s) => s.defaultAccountId);
  const refreshProviderSnapshot = useProviderStore((s) => s.refreshProviderSnapshot);
  const getAccountApiKey = useProviderStore((s) => s.getAccountApiKey);
  const chatFontScale = useSettingsStore((s) => s.chatFontScale);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const sessions = useChatStore((s) => s.sessions);
  const sessionModels = useChatStore((s) => s.sessionModels);
  const currentAgent = useMemo(
    () => (agents ?? []).find((agent) => agent.id === currentAgentId) ?? null,
    [agents, currentAgentId],
  );
  const currentSession = useMemo(
    () => (sessions ?? []).find((session) => session.key === currentSessionKey) ?? null,
    [currentSessionKey, sessions],
  );
  const previousSessionKeyRef = useRef(currentSessionKey);
  const activeSessionKeyRef = useRef(currentSessionKey);
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
        .map((model) => {
          const sourceAccount = resolveModelSourceAccount(item, model.id);
          const apiProtocol = getModelApiProtocol(sourceAccount, model.id);
          return {
            value: `${runtimeProviderKey}/${model.id}`,
            label: `${item.displayName} / ${model.id}`,
            accountId: sourceAccount.id,
            vendorId: sourceAccount.vendorId,
            modelId: model.id,
            authMode: sourceAccount.authMode,
            baseUrl: sourceAccount.baseUrl,
            apiProtocol,
            validationKey: [
              sourceAccount.id,
              model.id,
              sourceAccount.baseUrl || '',
              apiProtocol || '',
            ].join('|'),
          };
        });
    })
  ), [providerItems]);
  const effectiveModelRef = (sessionModels[currentSessionKey] || currentSession?.model || defaultModelRef || '').trim();
  const selectedModelValue = useMemo(() => {
    if (!effectiveModelRef) return '';
    return modelOptions.some((option) => option.value === effectiveModelRef) ? effectiveModelRef : '';
  }, [effectiveModelRef, modelOptions]);
  const activeModelValue = selectedModelValue;
  const selectedModelLabel = useMemo(
    () => modelOptions.find((option) => option.value === selectedModelValue)?.label || t('composer.selectModel'),
    [modelOptions, selectedModelValue, t],
  );
  const isModelSwitchDisabled = sending || modelOptions.length === 0;
  const attachmentKeys = useMemo(
    () => new Set(attachments.map((attachment) => attachment.dedupeKey).filter(Boolean)),
    [attachments],
  );

  useLayoutEffect(() => {
    const measuredLabelWidth = modelLabelMeasureRef.current?.offsetWidth ?? 0;
    const nextWidthPx = Math.min(Math.max(Math.ceil(measuredLabelWidth + 64), 150), 360);
    setModelSwitchWidth(`${nextWidthPx}px`);
  }, [selectedModelLabel]);

  useLayoutEffect(() => {
    activeSessionKeyRef.current = currentSessionKey;
    if (previousSessionKeyRef.current === currentSessionKey) {
      return;
    }
    previousSessionKeyRef.current = currentSessionKey;
    setInput('');
    setAttachments([]);
    setTargetAgentId(null);
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
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [disabled]);

  useEffect(() => {
    if (!targetAgentId) return;
    if (targetAgentId === currentAgentId) {
      setTargetAgentId(null);
      setPickerOpen(false);
      return;
    }
    if (!(agents ?? []).some((agent) => agent.id === targetAgentId)) {
      setTargetAgentId(null);
      setPickerOpen(false);
    }
  }, [agents, currentAgentId, targetAgentId]);

  useEffect(() => {
    if (!pickerOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [pickerOpen]);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!modelMenuRef.current?.contains(event.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [modelMenuOpen]);

  useEffect(() => {
    if (providerAccounts.length > 0 || providerStatuses.length > 0 || providerVendors.length > 0) return;
    void refreshProviderSnapshot();
  }, [providerAccounts.length, providerStatuses.length, providerVendors.length, refreshProviderSnapshot]);

  useEffect(() => {
    setModelMenuOpen(false);
  }, [currentAgentId]);

  useEffect(() => {
    if (currentSession) return;
    if (sessionModels[currentSessionKey]) return;
    if (defaultModelRef?.trim()) {
      useChatStore.setState((state) => {
        if (state.sessionModels[currentSessionKey]) {
          return {};
        }
        return {
          sessionModels: {
            ...state.sessionModels,
            [currentSessionKey]: defaultModelRef.trim(),
          },
        };
      });
      return;
    }

    let cancelled = false;
    void fetchAgents()
      .then(() => {
        if (cancelled) return;
        const latestDefaultModelRef = (useAgentsStore.getState().defaultModelRef || '').trim();
        if (!latestDefaultModelRef) return;
        useChatStore.setState((state) => {
          if (state.currentSessionKey !== currentSessionKey) {
            return {};
          }
          if (state.sessionModels[currentSessionKey]) {
            return {};
          }
          const storedModel = state.sessions.find((session) => session.key === currentSessionKey)?.model;
          if (storedModel) {
            return {};
          }
          return {
            sessionModels: {
              ...state.sessionModels,
              [currentSessionKey]: latestDefaultModelRef,
            },
          };
        });
      })
      .catch(() => {
        // Ignore background refresh failures here; sendMessage performs its own guard before dispatch.
      });
    return () => {
      cancelled = true;
    };
  }, [currentSession, currentSessionKey, defaultModelRef, fetchAgents, sessionModels]);

  // ── File staging via native dialog ─────────────────────────────

  const pickFiles = useCallback(async () => {
    try {
      const result = await invokeIpc('dialog:open', {
        properties: ['openFile', 'multiSelections'],
      }) as { canceled: boolean; filePaths?: string[] };
      if (result.canceled || !result.filePaths?.length) return;
      const draftSessionKey = currentSessionKey;
      if (draftSessionKey !== activeSessionKeyRef.current) return;

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
      for (const filePath of nextFilePaths) {
        const tempId = crypto.randomUUID();
        tempIds.push(tempId);
        // Handle both Unix (/) and Windows (\) path separators
        const fileName = filePath.split(/[\\/]/).pop() || 'file';
        setAttachments(prev => [...prev, {
          id: tempId,
          fileName,
          mimeType: '',
          fileSize: 0,
          dedupeKey: buildPathAttachmentKey(filePath),
          stagedPath: '',
          preview: null,
          status: 'staging' as const,
        }]);
      }

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
        body: JSON.stringify({ filePaths: nextFilePaths }),
      });
      console.log('[pickFiles] Stage result:', staged?.map(s => ({ id: s?.id, fileName: s?.fileName, mimeType: s?.mimeType, fileSize: s?.fileSize, stagedPath: s?.stagedPath, hasPreview: !!s?.preview })));
      if (draftSessionKey !== activeSessionKeyRef.current) return;
      const stagedItems = Array.isArray(staged) ? staged : [];

      // Update each placeholder with real data
      setAttachments(prev => {
        let updated = [...prev];
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
        return updated;
      });
    } catch (err) {
      if (currentSessionKey !== activeSessionKeyRef.current) return;
      console.error('[pickFiles] Failed to stage files:', err);
      // Mark any stuck 'staging' attachments as 'error' so the user can remove them
      // and the send button isn't permanently blocked
      setAttachments(prev => prev.map(a =>
        a.status === 'staging'
          ? { ...a, status: 'error' as const, error: String(err) }
          : a,
      ));
    }
  }, [attachmentKeys, currentSessionKey]);

  // ── Stage browser File objects (paste / drag-drop) ─────────────

  const stageBufferFiles = useCallback(async (files: globalThis.File[]) => {
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
      if (draftSessionKey !== activeSessionKeyRef.current) return;
      const tempId = crypto.randomUUID();
      setAttachments(prev => [...prev, {
        id: tempId,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileSize: file.size,
        dedupeKey: buildBrowserFileAttachmentKey(file),
        stagedPath: '',
        preview: null,
        status: 'staging' as const,
      }]);

      try {
        console.log(`[stageBuffer] Reading file: ${file.name} (${file.type}, ${file.size} bytes)`);
        const base64 = await readFileAsBase64(file);
        if (draftSessionKey !== activeSessionKeyRef.current) return;
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
          }),
        });
        console.log(`[stageBuffer] Staged: id=${staged?.id}, path=${staged?.stagedPath}, size=${staged?.fileSize}`);
        setAttachments(prev => prev.map(a =>
          a.id === tempId ? { ...staged, dedupeKey: buildBrowserFileAttachmentKey(file), status: 'ready' as const } : a,
        ));
      } catch (err) {
        if (draftSessionKey !== activeSessionKeyRef.current) return;
        console.error(`[stageBuffer] Error staging ${file.name}:`, err);
        setAttachments(prev => prev.map(a =>
          a.id === tempId
            ? { ...a, status: 'error' as const, error: String(err) }
            : a,
        ));
      }
    }
  }, [attachmentKeys, currentSessionKey]);

  // ── Attachment management ──────────────────────────────────────

  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  const allReady = attachments.length === 0 || attachments.every(a => a.status === 'ready');
  const hasFailedAttachments = attachments.some((a) => a.status === 'error');
  const canSend = (input.trim() || attachments.length > 0) && allReady && !disabled && !sending;
  const canQueueOffline = (input.trim() || attachments.length > 0) && allReady && disabled && !sending;
  const canStop = sending && !!onStop;
  const isZh = (i18n?.resolvedLanguage || i18n?.language || '').startsWith('zh');

  useEffect(() => {
    if (!prefillText || prefillNonce === 0) {
      return;
    }
    setInput(prefillText);
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.focus();
      const cursor = prefillText.length;
      textareaRef.current.setSelectionRange(cursor, cursor);
    });
  }, [prefillNonce, prefillText]);

  const handleSend = useCallback(() => {
    if (!canSend && !canQueueOffline) return;
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
    setInput('');
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    if (disabled) {
      onQueueOfflineMessage?.(textToSend, attachmentsToSend, targetAgentId);
    } else {
      onSend(textToSend, attachmentsToSend, targetAgentId);
    }
    setTargetAgentId(null);
    setPickerOpen(false);
  }, [input, attachments, canQueueOffline, canSend, disabled, onQueueOfflineMessage, onSend, targetAgentId]);

  const handleStop = useCallback(() => {
    if (!canStop) return;
    onStop?.();
  }, [canStop, onStop]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Backspace' && !input && targetAgentId) {
        setTargetAgentId(null);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        const nativeEvent = e.nativeEvent as KeyboardEvent;
        if (isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) {
          return;
        }
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, input, targetAgentId],
  );

  // Handle paste (Ctrl/Cmd+V with files)
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
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
    [stageBufferFiles],
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
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (e.dataTransfer?.files?.length) {
        stageBufferFiles(Array.from(e.dataTransfer.files));
      }
    },
    [stageBufferFiles],
  );

  const setSessionModel = useCallback((modelRef: string | null) => {
    useChatStore.setState((state) => {
      const nextSessionModels = { ...state.sessionModels };
      if (modelRef) {
        nextSessionModels[currentSessionKey] = modelRef;
      } else {
        delete nextSessionModels[currentSessionKey];
      }

      return {
        sessionModels: nextSessionModels,
        sessions: state.sessions.map((session) => (
          session.key !== currentSessionKey
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
  }, [currentSessionKey]);

  const handleModelChange = useCallback(async (nextModelRef: string) => {
    if (!currentAgentId) return;
    const normalizedNextModelRef = (nextModelRef || '').trim();
    if (!normalizedNextModelRef || normalizedNextModelRef === selectedModelValue) return;

    const nextOption = modelOptions.find((option) => option.value === normalizedNextModelRef);
    const previousLabel = modelOptions.find((option) => option.value === selectedModelValue)?.label
      || selectedModelValue
      || t('composer.selectModel');
    const nextLabel = nextOption?.label || normalizedNextModelRef || t('composer.selectModel');

    try {
      if (nextOption && shouldValidateModelOption(nextOption)) {
        const apiKey = nextOption.authMode === 'api_key'
          ? await getAccountApiKey(nextOption.accountId)
          : null;
        await hostApiFetch('/api/provider-drafts/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountId: nextOption.accountId,
            vendorId: nextOption.vendorId,
            ...(apiKey ? { apiKey } : {}),
            model: nextOption.modelId,
            ...(nextOption.baseUrl ? { baseUrl: nextOption.baseUrl } : {}),
            ...(nextOption.apiProtocol ? { apiProtocol: nextOption.apiProtocol } : {}),
          }),
        });
      }

      setSessionModel(normalizedNextModelRef || null);
      toast.success(t('composer.modelSwitchSuccess', { model: nextLabel }));
    } catch (error) {
      toast.error(t('composer.modelSwitchFailed', {
        model: previousLabel,
        error: getErrorMessage(error),
      }));
    }
  }, [currentAgentId, getAccountApiKey, modelOptions, selectedModelValue, setSessionModel, t]);

  return (
    <div
      data-testid="chat-composer-shell"
      className={cn(
        'w-full max-w-4xl mx-auto px-4 pt-0 pb-6 transition-all duration-300'
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="w-full">
        {/* Attachment Previews */}
        {attachments.length > 0 && (
          <div className="flex gap-2 mb-3 flex-wrap">
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
          'relative rounded-[32px] border px-3 pb-3 pt-3 shadow-[0_20px_56px_rgba(15,23,42,0.12)] backdrop-blur-xl transition-all',
          'bg-[linear-gradient(180deg,rgba(255,255,255,0.84)_0%,rgba(248,250,252,0.72)_100%)] dark:bg-[linear-gradient(180deg,rgba(27,34,46,0.90)_0%,rgba(22,28,38,0.84)_100%)]',
          dragOver ? 'border-primary/60 ring-2 ring-primary/20' : 'border-black/8 dark:border-white/10'
        )} data-testid="chat-composer">
          {selectedTarget && (
            <div className="px-2.5 pb-1 pt-1">
              <button
                type="button"
                onClick={() => setTargetAgentId(null)}
                className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/7 px-3 py-1 text-[13px] font-medium text-foreground transition-colors hover:bg-primary/12"
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
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onCompositionStart={() => {
                  isComposingRef.current = true;
                }}
                onCompositionEnd={() => {
                  isComposingRef.current = false;
                }}
                onPaste={handlePaste}
                placeholder={disabled && !input ? t('composer.gatewayDisconnectedPlaceholder') : t('composer.messagePlaceholder')}
                className="min-h-[62px] max-h-[220px] resize-none border-0 bg-transparent px-3 py-2.5 leading-[1.75] tracking-[0.01em] text-foreground shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/52"
                rows={1}
                style={{ fontSize: inputFontSize }}
              />
            </div>

            <Button
              onClick={sending ? handleStop : handleSend}
              disabled={sending ? !canStop : !(canSend || canQueueOffline)}
              size="icon"
              data-testid="chat-send-button"
              className={`mt-1 shrink-0 h-10 w-10 rounded-full transition-colors ${
                (sending || canSend || canQueueOffline)
                  ? 'bg-[linear-gradient(135deg,#4f8df7_0%,#2f6fe4_100%)] text-white shadow-[0_10px_24px_rgba(47,111,228,0.28)] hover:brightness-105'
                  : 'bg-transparent text-muted-foreground/40 hover:bg-transparent'
              }`}
              variant={sending || canSend || canQueueOffline ? 'default' : 'ghost'}
              title={sending ? t('composer.stop') : disabled ? (isZh ? '离线排队发送' : 'Queue to send') : t('composer.send')}
            >
              {sending ? (
                <Square className="h-4 w-4" fill="currentColor" />
              ) : (
                <SendHorizontal className="h-[18px] w-[18px]" strokeWidth={2} />
              )}
            </Button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 px-2">
            <button
              type="button"
              data-testid="chat-attach-button"
              className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-[13px] font-medium text-foreground/72 transition-colors hover:bg-black/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/8"
              onClick={pickFiles}
              disabled={sending}
              title={t('composer.attachFiles')}
            >
              <Paperclip className="h-4 w-4" />
              <span>{t('composer.attachFiles')}</span>
            </button>

            {showAgentPicker && (
              <div ref={pickerRef} className="relative">
                <button
                  type="button"
                  data-testid="chat-agent-picker-button"
                className={cn(
                  'inline-flex h-9 items-center gap-2 rounded-full px-3 text-[13px] font-medium text-foreground/72 transition-colors hover:bg-black/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/8',
                  (pickerOpen || selectedTarget) && 'bg-primary/10 text-primary hover:bg-primary/20'
                )}
                onClick={() => setPickerOpen((open) => !open)}
                disabled={sending}
                title={t('composer.pickAgent')}
              >
                <AtSign className="h-4 w-4" />
                <span>{selectedTarget ? selectedTarget.name : t('composer.pickAgent')}</span>
                {selectedTarget && (
                    <span
                      role="button"
                      aria-label={t('common:actions.clear', 'Clear')}
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground/80 hover:bg-black/10 hover:text-foreground dark:hover:bg-white/10"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setTargetAgentId(null);
                        setPickerOpen(false);
                        textareaRef.current?.focus();
                      }}
                    >
                      <X className="h-3 w-3" />
                    </span>
                  )}
                </button>
                {pickerOpen && (
                  <div className="absolute left-0 bottom-full z-20 mb-2 w-72 overflow-hidden rounded-2xl border border-black/10 bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-card">
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
                            setTargetAgentId((current) => (current === agent.id ? null : agent.id));
                            setPickerOpen(false);
                            textareaRef.current?.focus();
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
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
                  isModelSwitchDisabled && 'cursor-not-allowed opacity-50'
                )}
                title={t('composer.switchModel')}
                style={{ width: modelSwitchWidth }}
                onClick={() => {
                  if (!isModelSwitchDisabled) {
                    setModelMenuOpen((open) => !open);
                  }
                }}
                disabled={isModelSwitchDisabled}
              >
                <Cpu aria-hidden="true" className="pointer-events-none h-4 w-4 shrink-0 text-current" />
                <span
                  aria-hidden="true"
                  className="pointer-events-none min-w-0 flex-1 overflow-hidden whitespace-nowrap text-clip text-left text-current"
                >
                  {selectedModelLabel}
                </span>
                <ChevronDown className="pointer-events-none h-4 w-4 shrink-0 text-current" />
              </button>
              {modelMenuOpen && !isModelSwitchDisabled && (
                <div className="absolute bottom-full left-0 z-20 mb-2 w-[max-content] min-w-full max-w-[360px] overflow-hidden rounded-xl border border-black/10 bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-card">
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
                </div>
              )}
            </div>
          </div>
        </div>
        {hasFailedAttachments && (
          <Button
            variant="link"
            size="sm"
            className="mt-2.5 h-auto px-4 py-0 text-[11px] text-muted-foreground/58"
            onClick={() => {
              setAttachments((prev) => prev.filter((att) => att.status !== 'error'));
              void pickFiles();
            }}
          >
            {t('composer.retryFailedAttachments')}
          </Button>
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
  return (
    <div className="relative group overflow-hidden rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 shadow-sm">
      <div className="flex items-center gap-3 px-3 h-14 min-w-[180px] max-w-[240px]">
        <FileIcon mimeType={attachment.mimeType} fileName={attachment.fileName} className="h-8 w-8 shrink-0 drop-shadow-sm" />
        <div className="min-w-0 overflow-hidden leading-tight flex flex-col justify-center">
          <p className="text-[13px] font-medium truncate">{attachment.fileName}</p>
          <p className="text-[10px] text-muted-foreground">
            {attachment.fileSize > 0 ? formatFileSize(attachment.fileSize) : '...'}
          </p>
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
          <span className="text-[10px] text-destructive font-medium px-1">Error</span>
        </div>
      )}

      <button
        onClick={onRemove}
        className="absolute right-1.5 top-1.5 rounded-full border border-black/8 bg-white/92 p-1 text-foreground shadow-sm transition-colors hover:bg-white dark:border-white/10 dark:bg-black/70 dark:hover:bg-black"
        title="Remove file"
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
        'flex w-full flex-col items-start rounded-xl px-3 py-2 text-left transition-colors',
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
