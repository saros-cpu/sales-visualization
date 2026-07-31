import { describe, expect, it } from 'vitest';
import { taskLabel } from './admin-helpers';

describe('admin helper labels', () => {
  it('labels current automation tasks', () => {
    expect(taskLabel('exchange_rates')).toBe('自动补充汇率');
    expect(taskLabel('market_watch')).toBe('自动补充市场观察');
    expect(taskLabel('retail_snapshots')).toBe('自动补充零售/自用油/利润快照');
    expect(taskLabel('retail_accounting_reports')).toBe('自动生成吉方日报');
    expect(taskLabel('all')).toBe('全部任务');
  });

  it('does not mask legacy automation_all records as current tasks', () => {
    expect(taskLabel('automation_all')).toBe('automation_all');
  });
});
