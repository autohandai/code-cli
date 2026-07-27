/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
export { buildActivity, derivePhase, type ActivityInput } from './PeerActivityPublisher.js';
export {
  PeerAwarenessManager,
  type PeerAwarenessManagerOptions,
  type PeerRefresh,
} from './PeerAwarenessManager.js';
export {
  isGitMutationCommand,
  normalizePeerPath,
  resolveAwarenessTier,
  warnForClaimConflict,
  warnForFileWrite,
  warnForGitMutation,
  warnForRepoDrift,
  type AwarenessTier,
  type PeerWarning,
} from './PeerWarnings.js';
export { readRepoHead, type RepoHead } from './RepoStateReader.js';
