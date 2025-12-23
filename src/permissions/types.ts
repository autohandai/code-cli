/**
 * Permission System Types
 * @license Apache-2.0
 */

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
  whitelist?: string[];
  /** Commands/tools that are always blocked */
  blacklist?: string[];
  /** Custom rules for fine-grained control */
  rules?: PermissionRule[];
  /** Remember user decisions for this session */
  rememberSession?: boolean;
}

export interface PermissionDecision {
  allowed: boolean;
  reason:
    | 'whitelisted' | 'blacklisted' | 'rule_match' | 'user_approved' | 'user_denied'
    | 'mode_unrestricted' | 'mode_restricted' | 'default'
    | 'external_approved' | 'external_denied' | 'external_error';
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
  /** For 'select' type, the chosen option */
  choice?: string;
  /** For 'input' type, the entered value */
  value?: string;
  /** Reason code */
  reason?: 'external_approved' | 'external_denied';
}

/**
 * Callback function type for external prompts
 */
export type ExternalPromptCallback = (
  request: ExternalPromptRequest
) => Promise<ExternalPromptResponse>;
