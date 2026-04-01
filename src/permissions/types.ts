/**
 * Permission System Types
 * @license Apache-2.0
 */
import type { ToolPattern } from './toolPatterns.js';

export type PermissionMode = 'interactive' | 'unrestricted' | 'restricted' | 'external';

export interface PermissionRule {
  /** Tool name (e.g., 'run_command', 'delete_path') */
  tool: string;
  /** Pattern to match (glob-style, e.g., 'npm *', 'git status') */
  pattern?: string;
  /** Action to take when matched */
  action: 'allow' | 'deny' | 'prompt';
}

export interface PermissionSettings {
  /** Permission mode: interactive (default), unrestricted (no prompts), restricted (deny all dangerous), external (use callback) */
  mode?: PermissionMode;
  /** Commands/tools that never require approval */
  allowList?: string[];
  /** Commands/tools that are always blocked */
  denyList?: string[];
  /** @deprecated legacy alias for allowList */
  whitelist?: string[];
  /** @deprecated legacy alias for denyList */
  blacklist?: string[];
  /** Custom rules for fine-grained control */
  rules?: PermissionRule[];
  /** Remember user decisions for this session */
  rememberSession?: boolean;
  /** Patterns that are always denied (checked before allowPatterns) */
  denyPatterns?: ToolPattern[];
  /** Patterns that are always allowed (checked after denyPatterns) */
  allowPatterns?: ToolPattern[];
  /** If non-empty, only tools matching these patterns are allowed */
  availableTools?: ToolPattern[];
  /** Tools matching these patterns are always excluded/denied */
  excludedTools?: ToolPattern[];
  /** If true, all file-path tools are allowed without prompting */
  allPathsAllowed?: boolean;
  /** If true, all URL-fetching tools are allowed without prompting */
  allUrlsAllowed?: boolean;
}

export interface PermissionDecision {
  allowed: boolean;
  reason:
    | 'allow_list' | 'deny_list' | 'rule_match' | 'user_approved' | 'user_denied'
    | 'mode_unrestricted' | 'mode_restricted' | 'default'
    | 'external_approved' | 'external_denied' | 'external_error'
    | 'pattern_denied' | 'pattern_allowed' | 'not_in_available' | 'excluded'
    | 'all_paths_allowed' | 'all_urls_allowed'
    | 'session_allow_list' | 'session_deny_list'
    | 'project_allow_list' | 'project_deny_list'
    | 'user_allow_list' | 'user_deny_list';
  cached?: boolean;
}

export interface PermissionContext {
  tool: string;
  command?: string;
  args?: string[];
  path?: string;
  description?: string;
}

/**
 * External permission callback request
 */
export interface ExternalPromptRequest {
  type: 'confirm' | 'select' | 'input';
  message: string;
  /** For 'select' type */
  choices?: Array<{ name: string; message: string }>;
  /** For 'input' type */
  initial?: string;
  /** Additional context for the prompt */
  context?: PermissionContext;
}

/**
 * External permission callback response
 */
export interface ExternalPromptResponse {
  /** Whether the action was approved */
  allowed: boolean;
  /** Structured decision when the callback supports the richer permission model */
  decision?: PermissionPromptDecision;
  /** For 'select' type, the chosen option */
  choice?: string;
  /** For 'input' type, the entered value */
  value?: string;
  /** Optional free-form alternative to use instead of the original input */
  alternative?: string;
  /** Reason code */
  reason?: 'external_approved' | 'external_denied';
}

/**
 * Callback function type for external prompts
 */
export type ExternalPromptCallback = (
  request: ExternalPromptRequest
) => Promise<ExternalPromptResponse>;

export type PermissionPromptDecision =
  | 'allow_once'
  | 'deny_once'
  | 'allow_session'
  | 'deny_session'
  | 'allow_always_project'
  | 'allow_always_user'
  | 'deny_always_project'
  | 'deny_always_user'
  | 'alternative';

export interface PermissionPromptResult {
  decision: PermissionPromptDecision;
  alternative?: string;
}

export type PermissionPromptResponse = boolean | PermissionPromptResult;

export interface PermissionScopeSnapshot {
  path: string;
  allowList: string[];
  denyList: string[];
}

export interface PermissionSnapshot {
  mode: PermissionMode;
  rememberSession: boolean;
  session: PermissionScopeSnapshot;
  project: PermissionScopeSnapshot;
  user: PermissionScopeSnapshot;
  effective: PermissionScopeSnapshot;
}

export function normalizePermissionPromptResponse(
  response: PermissionPromptResponse | null | undefined
): PermissionPromptResult {
  if (typeof response === 'boolean') {
    return { decision: response ? 'allow_once' : 'deny_once' };
  }
  if (!response) {
    return { decision: 'deny_once' };
  }
  return response;
}

export function isAllowedPermissionPrompt(result: PermissionPromptResult): boolean {
  return result.decision === 'allow_once'
    || result.decision === 'allow_session'
    || result.decision === 'allow_always_project'
    || result.decision === 'allow_always_user'
    || result.decision === 'alternative';
}
