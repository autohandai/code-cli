import { useCallback, useEffect, useRef, useState } from 'react';
import type { PeerDescriptor, PeerReceipt, PeerScope } from '../../session/peers/PeerProtocol.js';
import { bindPeerReference, matchPeerMention, parsePeerInput, resolvePeerInput, type PeerComposerDraft, type PeerInstructionMetadata, type PeerReference } from '../peerMention.js';
import { safePeerLabel } from '../../session/peers/PeerScope.js';

export interface PeerComposerOptions {
  initialMetadata?: PeerInstructionMetadata;
  peerScopes?: PeerScope[];
  peersProvider?: (scope?: PeerScope) => PeerDescriptor[];
  onPeersRefresh?: (scope?: PeerScope) => Promise<unknown>;
  onPeerMessage?: (input: { to: string; content: string; replyTo?: string }) => Promise<PeerReceipt>;
  onInstruction: (text: string, metadata?: PeerInstructionMetadata) => void;
  read: () => { text: string; cursor: number };
  replace: (text: string, cursor: number) => void;
  onSubmitted: (text: string, metadata?: PeerInstructionMetadata) => void;
}
export interface PeerComposerView { suggestions: PeerDescriptor[]; activeIndex: number; status?: string; sending: boolean; open: boolean; scope: PeerScope; canCycleScope: boolean; }

export function usePeerComposer(options: PeerComposerOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const bindings = useRef<PeerReference[]>(structuredClone(options.initialMetadata?.peerReferences ?? []));
  const reply = useRef<{ peerId: string; messageId: string } | undefined>(options.initialMetadata?.peerReplyTo && bindings.current[0] ? { peerId: bindings.current[0].peerId, messageId: options.initialMetadata.peerReplyTo } : undefined);
  const dismissed = useRef<string | undefined>(undefined);
  const refreshKey = useRef<string | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const model = useRef<PeerComposerView>({ suggestions: [], activeIndex: 0, sending: false, open: false, scope: options.initialMetadata?.peerScope && options.peerScopes?.includes(options.initialMetadata.peerScope) ? options.initialMetadata.peerScope : 'workspace', canCycleScope: false });
  const [view, setView] = useState(model.current);
  const updateView = useCallback((next: Partial<PeerComposerView>) => { model.current = { ...model.current, ...next }; setView(model.current); }, []);
  const update = useCallback((text: string, cursor: number) => {
    if (!text) { bindings.current = []; reply.current = undefined; }
    const provider = optionsRef.current.peersProvider;
    const scope = model.current.scope;
    const match = provider && dismissed.current !== `${text}\0${cursor}` ? matchPeerMention(text, cursor) : null;
    const key = match ? `${scope}:${match.start}` : undefined;
    if (!match) refreshKey.current = undefined;
    else if (refreshKey.current !== key && optionsRef.current.onPeersRefresh) {
      refreshKey.current = key;
      void optionsRef.current.onPeersRefresh(scope).then(() => {
        if (!mounted.current || refreshKey.current !== key) return;
        const current = optionsRef.current.read();
        const active = matchPeerMention(current.text, current.cursor);
        if (!active || dismissed.current === `${current.text}\0${current.cursor}`) return;
        const query = active.query.toLowerCase();
        const suggestions = (optionsRef.current.peersProvider?.(scope) ?? []).filter(peer => `${peer.alias} ${peer.project} ${peer.peerId}`.toLowerCase().includes(query)).slice(0, 5);
        updateView({ suggestions, activeIndex: Math.min(model.current.activeIndex, Math.max(0, suggestions.length - 1)) });
      }, error => { if (mounted.current) updateView({ status: safePeerLabel(error instanceof Error ? error.message : String(error), 300) }); });
    }
    const query = match?.query.toLowerCase() ?? '';
    const suggestions = match ? (provider?.(scope) ?? []).filter(peer => `${peer.alias} ${peer.project} ${peer.peerId}`.toLowerCase().includes(query)).slice(0, 5) : [];
    updateView({ suggestions, open: !!match, canCycleScope: (optionsRef.current.peerScopes?.length ?? 1) > 1, activeIndex: Math.min(model.current.activeIndex, Math.max(0, suggestions.length - 1)) });
  }, [updateView]);

  const handleKey = useCallback((key: { escape?: boolean; tab?: boolean; return?: boolean; upArrow?: boolean; downArrow?: boolean; shift?: boolean }): boolean => {
    const { text, cursor } = optionsRef.current.read();
    if (!model.current.open) return false;
    if (key.escape) { dismissed.current = `${text}\0${cursor}`; refreshKey.current = undefined; updateView({ suggestions: [], open: false }); return true; }
    if (key.tab && key.shift) {
      const scopes = optionsRef.current.peerScopes ?? ['workspace'];
      const scope = scopes[(scopes.indexOf(model.current.scope) + 1) % scopes.length] ?? 'workspace';
      updateView({ scope, activeIndex: 0, status: undefined });
      update(text, cursor);
      return true;
    }
    if (!model.current.suggestions.length) return false;
    if (key.upArrow || key.downArrow) {
      updateView({ activeIndex: (model.current.activeIndex + (key.upArrow ? -1 : 1) + model.current.suggestions.length) % model.current.suggestions.length });
      return true;
    }
    if (key.return || key.tab && !key.shift) {
      const match = matchPeerMention(text, cursor);
      const selected = model.current.suggestions[model.current.activeIndex];
      if (!match || !selected) return false;
      const completed = bindPeerReference(text, match, selected);
      bindings.current = [...bindings.current.filter(binding => binding.start !== completed.binding.start), completed.binding];
      optionsRef.current.replace(completed.text, completed.cursor);
      dismissed.current = undefined;
      updateView({ suggestions: [], activeIndex: 0, open: false });
      return true;
    }
    return false;
  }, [update, updateView]);

  const submit = useCallback((text: string, handlers?: { onInstruction: PeerComposerOptions['onInstruction']; onAccepted: (kind: 'instruction' | 'direct') => void }): boolean => {
    if (!optionsRef.current.peersProvider) return false;
    const parsed = parsePeerInput(text);
    if (parsed.kind === 'instruction' && !parsed.references.length) return false;
    if (model.current.sending) return true;
    try {
      const resolved = resolvePeerInput(text, bindings.current, optionsRef.current.peersProvider(model.current.scope));
      if (resolved.kind === 'instruction') {
        (handlers?.onInstruction ?? optionsRef.current.onInstruction)(text, { peerReferences: resolved.references, peerScope: model.current.scope });
        optionsRef.current.onSubmitted(text, { peerReferences: resolved.references, peerScope: model.current.scope });
        optionsRef.current.replace('', 0);
        bindings.current = [];
        updateView({ suggestions: [], open: false, status: undefined });
        handlers?.onAccepted('instruction');
        return true;
      }
      const send = optionsRef.current.onPeerMessage;
      if (!send) return false;
      updateView({ suggestions: [], open: false, sending: true, status: `To :${safePeerLabel(resolved.reference.alias)} · sending` });
      const replyTo = reply.current?.peerId === resolved.to ? reply.current.messageId : undefined;
      void send({ to: resolved.to, content: resolved.content, ...(replyTo ? { replyTo } : {}) }).then(receipt => {
        if (['rejected', 'expired', 'unknown'].includes(receipt.state)) {
          updateView({ sending: false, status: `To :${safePeerLabel(resolved.reference.alias)} · ${receipt.state} · ${safePeerLabel(receipt.outcome ?? 'retry or reselect')}` });
          return;
        }
        if (optionsRef.current.read().text.trim() === text.trim()) {
          optionsRef.current.replace('', 0);
          bindings.current = [];
        }
        optionsRef.current.onSubmitted(text, { peerReferences: [resolved.reference], peerScope: model.current.scope, ...(replyTo ? { peerReplyTo: replyTo } : {}) });
        handlers?.onAccepted('direct');
        updateView({ sending: false, status: `To :${safePeerLabel(resolved.reference.alias)} · ${receipt.state}${receipt.outcome ? ` · ${safePeerLabel(receipt.outcome)}` : ''}` });
      }, error => updateView({ sending: false, status: safePeerLabel(error instanceof Error ? error.message : String(error), 300) }));
    } catch (error) { updateView({ status: safePeerLabel(error instanceof Error ? error.message : String(error), 300) }); }
    return true;
  }, [updateView]);

  const applyDraft = useCallback((draft: PeerComposerDraft) => {
    bindings.current = [draft.reference];
    reply.current = draft.replyTo ? { peerId: draft.reference.peerId, messageId: draft.replyTo } : undefined;
    const text = draft.text ?? `:${draft.reference.alias} `;
    optionsRef.current.replace(text, text.length);
    const scope = draft.scope && (optionsRef.current.peerScopes ?? ['workspace']).includes(draft.scope) ? draft.scope : model.current.scope;
    updateView({ scope, suggestions: [], activeIndex: 0, open: false, status: draft.replyTo ? `Reply to :${safePeerLabel(draft.reference.alias)}` : undefined });
  }, [updateView]);

  const snapshotMetadata = useCallback((): PeerInstructionMetadata => ({
    peerReferences: structuredClone(bindings.current), peerScope: model.current.scope,
    ...(reply.current ? { peerReplyTo: reply.current.messageId } : {}),
  }), []);
  const restoreMetadata = useCallback((metadata?: Partial<PeerInstructionMetadata>) => {
    bindings.current = structuredClone(metadata?.peerReferences ?? []);
    reply.current = metadata?.peerReplyTo && bindings.current[0] ? { peerId: bindings.current[0].peerId, messageId: metadata.peerReplyTo } : undefined;
    const scope = metadata?.peerScope && (optionsRef.current.peerScopes ?? ['workspace']).includes(metadata.peerScope) ? metadata.peerScope : model.current.scope;
    updateView({ scope, status: undefined });
    if (optionsRef.current.onPeersRefresh) void optionsRef.current.onPeersRefresh(scope).then(() => {
      if (mounted.current) { const current = optionsRef.current.read(); update(current.text, current.cursor); }
    }, error => { if (mounted.current) updateView({ status: safePeerLabel(error instanceof Error ? error.message : String(error), 300) }); });
  }, [update, updateView]);
  return { view, update, handleKey, submit, applyDraft, snapshotMetadata, restoreMetadata };
}
