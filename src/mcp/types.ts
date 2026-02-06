/**
 * MCP (Model Context Protocol) Type Definitions
 *
 * Types and validation utilities for MCP server configuration
 * and tool definitions. MCP is an industry standard protocol for
 * connecting AI agents to external tools (databases, APIs, custom tools).
 */

// ============================================================================
// MCP Server Configuration
// ============================================================================

/**
 * Configuration for connecting to an MCP server.
 * Supports both stdio (spawned process) and SSE (HTTP) transports.
 */
export interface McpServerConfig {
  /** Unique name for this server */
  name: string;
  /** Transport type: 'stdio' spawns a process, 'sse' connects via HTTP */
  transport: 'stdio' | 'sse';
  /** Command to start the server (stdio transport) */
  command?: string;
  /** Arguments for the command */
  args?: string[];
  /** SSE endpoint URL (sse transport) */
  url?: string;
  /** Environment variables to pass to the server */
  env?: Record<string, string>;
  /** Whether to auto-connect on startup (default: true) */
  autoConnect?: boolean;
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

/**
 * Autohand-compatible representation of an MCP tool.
 * Tool names are prefixed with `mcp__<server>__<tool>` to avoid
 * collisions with built-in tools.
 */
export interface McpToolDefinition {
  /** Tool name with mcp__ prefix: mcp__<server>__<tool> */
  name: string;
  /** Tool description */
  description: string;
  /** JSON Schema for parameters */
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** Which MCP server provides this tool */
  serverName: string;
}

// ============================================================================
// Raw MCP Tool (as received from MCP server)
// ============================================================================

/**
 * Raw tool definition as returned by an MCP server's `tools/list` response.
 */
export interface McpRawTool {
  name: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ============================================================================
// MCP Connection State
// ============================================================================

/** Connection status of an MCP server */
export type McpServerStatus = 'connected' | 'disconnected' | 'error';

/** Runtime state for a connected MCP server */
export interface McpServerState {
  config: McpServerConfig;
  status: McpServerStatus;
  tools: McpToolDefinition[];
  error?: string;
}

// ============================================================================
// Validation
// ============================================================================

const VALID_TRANSPORTS = ['stdio', 'sse'] as const;

/**
 * Validates an MCP server configuration object.
 * Throws a descriptive error if the configuration is invalid.
 *
 * @param config - The server configuration to validate
 * @throws {Error} If configuration is missing required fields
 */
export function validateMcpServerConfig(config: McpServerConfig): void {
  if (!config.name || typeof config.name !== 'string' || config.name.trim() === '') {
    throw new Error('MCP server config requires a non-empty "name" field');
  }

  if (!VALID_TRANSPORTS.includes(config.transport as (typeof VALID_TRANSPORTS)[number])) {
    throw new Error(
      `MCP server config has invalid "transport" type: "${config.transport}". Must be one of: ${VALID_TRANSPORTS.join(', ')}`
    );
  }

  if (config.transport === 'stdio') {
    if (!config.command || typeof config.command !== 'string') {
      throw new Error(
        `MCP stdio server "${config.name}" requires a "command" field`
      );
    }
  }

  if (config.transport === 'sse') {
    if (!config.url || typeof config.url !== 'string') {
      throw new Error(
        `MCP SSE server "${config.name}" requires a "url" field`
      );
    }
  }
}

// ============================================================================
// Conversion
// ============================================================================

/**
 * Converts a raw MCP tool definition to the Autohand-compatible
 * `McpToolDefinition` format, applying the `mcp__<serverName>__<toolName>`
 * naming convention.
 *
 * @param mcpTool - Raw tool definition from an MCP server
 * @param serverName - Name of the MCP server providing this tool
 * @returns Converted tool definition with prefixed name
 */
export function convertMcpToolToAutohand(
  mcpTool: McpRawTool,
  serverName: string
): McpToolDefinition {
  const prefixedName = `mcp__${serverName}__${mcpTool.name}`;

  return {
    name: prefixedName,
    description: mcpTool.description ?? '',
    parameters: {
      type: 'object',
      properties: mcpTool.inputSchema.properties ?? {},
      ...(mcpTool.inputSchema.required && mcpTool.inputSchema.required.length > 0
        ? { required: mcpTool.inputSchema.required }
        : {}),
    },
    serverName,
  };
}
