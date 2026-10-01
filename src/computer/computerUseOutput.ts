export const COMPUTER_USE_TOOL_PREFIX = 'mcp__autohand-computer-use__';

export interface ComputerUseStep {
  id: string;
  label: string;
  status: 'running' | 'done' | 'unverified' | 'failed' | 'cancelled';
  detail?: string;
}

export function computerUseStepLabel(tool: string, args: Record<string, unknown>): string {
  const name = tool.slice(COMPUTER_USE_TOOL_PREFIX.length);
  const app = [args.query, args.app_name, args.name].find(value => typeof value === 'string');
  const target = typeof app === 'string' ? app.replace(/[\p{Cc}\p{Cf}]/gu, ' ').slice(0, 70).trim() : '';
  const labels: Record<string, string> = {
    list_apps: target ? `Finding ${target}` : 'Finding the app',
    launch_app: target ? `Opening ${target}` : 'Opening the app',
    list_windows: 'Finding the window', get_window_state: 'Checking the window',
    get_desktop_state: 'Checking the desktop', get_state: 'Checking the screen',
    type_text: 'Writing text', press_key: 'Pressing a key', click: 'Clicking the target',
    double_click: 'Double-clicking the target', scroll: 'Scrolling', drag: 'Dragging',
    move_mouse: 'Moving the pointer', verify_state: 'Verifying the result', focus_window: 'Focusing the window',
  };
  return labels[name] ?? name.replaceAll('_', ' ').replace(/^./u, character => character.toUpperCase());
}

export function computerUseStepResult(success: boolean, output: string): Pick<ComputerUseStep, 'status' | 'detail'> {
  if (!success) {
    return { status: 'failed', detail: output.split('\n')[0]?.replace(/[\p{Cc}\p{Cf}]/gu, ' ').slice(0, 140) || 'Action failed' };
  }
  return /unverified|unverifiable|could not confirm/iu.test(output)
    ? { status: 'unverified', detail: 'Needs verification' }
    : { status: 'done' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isComputerUseStep(value: unknown): value is ComputerUseStep {
  return isRecord(value) && typeof value.id === 'string' && typeof value.label === 'string'
    && typeof value.status === 'string' && ['running', 'done', 'unverified', 'failed', 'cancelled'].includes(value.status)
    && (value.detail === undefined || typeof value.detail === 'string');
}

export function boundComputerUseObservation(tool: string, args: Record<string, unknown>, properties: Record<string, unknown>): Record<string, unknown> {
  if (!['get_window_state', 'get_desktop_state', 'get_state'].includes(tool)) return { ...args };
  const bounded = { ...args };
  for (const [field, limit] of Object.entries({ max_elements: 80, max_depth: 12, max_dimension: 1280 })) {
    const schema = properties[field];
    if (bounded[field] !== undefined || !isRecord(schema) || schema.type !== 'integer') continue;
    if (field === 'max_dimension' && bounded.max_image_dimension !== undefined) continue;
    const minimum = typeof schema.minimum === 'number' ? schema.minimum : 1;
    const maximum = typeof schema.maximum === 'number' ? schema.maximum : Infinity;
    bounded[field] = Math.min(maximum, Math.max(minimum, limit));
  }
  return bounded;
}

export function compactComputerUseResult(result: unknown): unknown {
  if (!isRecord(result) || result.isError === true || !isRecord(result.structuredContent)) return result;
  const original = result.structuredContent;
  const structured = { ...original };
  delete structured._note;
  const tree = typeof original.tree_markdown === 'string' ? original.tree_markdown : undefined;
  const hasElements = Array.isArray(original.elements) && original.elements.length > 0;
  if (hasElements) delete structured.tree_markdown;
  const content = Array.isArray(result.content) ? result.content.flatMap((item: unknown) => {
    if (!isRecord(item) || item.type !== 'text' || typeof item.text !== 'string') return [item];
    try {
      if (JSON.stringify(JSON.parse(item.text)) === JSON.stringify(original)) return [];
    } catch { /* Human-readable summaries remain useful alongside structured observations. */ }
    const text = tree && hasElements ? item.text.replace(tree, '').trim() : item.text;
    return text ? [{ ...item, text }] : [];
  }) : result.content;
  return { ...result, structuredContent: structured, content };
}
