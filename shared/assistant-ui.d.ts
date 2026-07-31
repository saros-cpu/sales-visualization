export function createAssistantSessionId(prefix?: string): string;
export function isClearAssistantCommand(value: string): boolean;
export function isAssistantCellObject(cell: unknown): boolean;
export function assistantCellText(cell: unknown): string;
export function assistantCellSpan(cell: unknown, key: 'rowSpan' | 'colSpan'): number | undefined;
export function shouldSkipAssistantCell(cell: unknown): boolean;
export function isAssistantTotalRow(row: unknown[]): boolean;
export function compactAssistantPlan<T = any>(plan?: T, maxSubPlans?: number): T | undefined;
export function buildAssistantPageContext(source?: {
  path?: string;
  pathname?: string;
  search?: string;
  hash?: string;
  title?: string;
}): Record<string, any>;
export function buildAssistantConversationContext(options?: {
  messages?: Array<Record<string, any>>;
  sessionId?: string;
  pageContext?: Record<string, any>;
  maxMessages?: number;
}): Record<string, any>;
export function tableToCsv(table: any): string;
