export function createAssistantSessionId(prefix = 'ai') {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function isClearAssistantCommand(value) {
  return /^(清空|清除|清屏|重置|删除)(问答|对话|聊天|记录|上下文)?$|^(clear|reset|delete)\s+(chat|conversation|history|context)$|^(очисти|сбрось|удали)\s+(чат|диалог|историю|контекст)$/i.test(String(value || '').trim());
}

export function isAssistantCellObject(cell) {
  return cell && typeof cell === 'object' && !Array.isArray(cell);
}

export function assistantCellText(cell) {
  if (isAssistantCellObject(cell)) {
    return String(cell.value ?? cell.text ?? cell.label ?? '');
  }
  return String(cell ?? '');
}

export function assistantCellSpan(cell, key) {
  const value = isAssistantCellObject(cell) ? Number(cell[key] || 0) : 0;
  return Number.isFinite(value) && value > 1 ? value : undefined;
}

export function shouldSkipAssistantCell(cell) {
  return Boolean(isAssistantCellObject(cell) && cell.skip);
}

export function isAssistantTotalRow(row) {
  return /合计|平均|итого|средн/i.test(assistantCellText((row || [])[0]));
}

export function compactAssistantPlan(plan, maxSubPlans = 5) {
  if (!plan || typeof plan !== 'object') return undefined;
  return {
    domain: plan.domain,
    intent: plan.intent,
    route: plan.route,
    metric: plan.metric,
    dimensions: plan.dimensions,
    entities: plan.entities,
    period: plan.period,
    tool: plan.tool,
    businessTerms: plan.businessTerms,
    comparison: plan.comparison,
    executionHints: plan.executionHints,
    assumptions: plan.assumptions,
    selfCheck: plan.selfCheck,
    subPlans: Array.isArray(plan.subPlans)
      ? plan.subPlans.slice(0, maxSubPlans).map(item => compactAssistantPlan(item, maxSubPlans)).filter(Boolean)
      : undefined,
    needsClarification: plan.needsClarification,
    clarification: plan.clarification,
    clarificationResolved: plan.clarificationResolved,
    explicit: plan.explicit,
    visual: plan.visual,
    contextUsed: plan.contextUsed,
  };
}

export function buildAssistantPageContext(source = {}) {
  const path = source.path ?? source.pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '');
  const search = source.search ?? (typeof window !== 'undefined' ? window.location.search : '');
  const hash = source.hash ?? (typeof window !== 'undefined' ? window.location.hash : '');
  const params = Object.fromEntries(new URLSearchParams(search).entries());
  const segments = String(path || '').split('/').filter(Boolean);
  return {
    path,
    search,
    hash,
    module: segments[0] || '',
    page: segments[1] || (segments[0] || 'home'),
    title: source.title ?? (typeof document !== 'undefined' ? document.title : ''),
    searchParams: params,
  };
}

function assistantMessageHint(item) {
  const plan = compactAssistantPlan(item.assistantPlan);
  return {
    role: item.role,
    content: String(item.content || item.answer || '').slice(0, 500),
    periodLabel: item.periodLabel,
    assistantPlan: plan,
    chartHints: (item.charts || []).slice(0, 3).map(chart => ({
      title: chart.title,
      type: chart.type,
      xAxis: (chart.xAxis || []).slice(0, 12),
    })),
    tableHints: (item.tables || []).slice(0, 2).map(table => ({
      title: table.title,
      columns: (table.columns || []).slice(0, 8),
      firstRows: (table.rows || []).slice(0, 3),
    })),
  };
}

export function buildAssistantConversationContext({
  messages = [],
  sessionId,
  pageContext,
  maxMessages = 8,
} = {}) {
  const lastAssistant = [...messages].reverse().find(item => item?.role === 'assistant' && item.assistantPlan);
  return {
    sessionId,
    pageContext: pageContext || buildAssistantPageContext(),
    lastAssistantPlan: compactAssistantPlan(lastAssistant?.assistantPlan),
    recentMessages: messages
      .filter(item => item && item.role && (item.content || item.answer))
      .slice(-maxMessages)
      .map(assistantMessageHint),
  };
}

export function tableToCsv(table) {
  const rows = [table?.columns || [], ...(table?.rows || [])];
  return rows.map(row => (Array.isArray(row) ? row : [row]).map(cell => {
    const text = assistantCellText(cell).replace(/"/g, '""');
    return /[",\n]/.test(text) ? `"${text}"` : text;
  }).join(',')).join('\n');
}
