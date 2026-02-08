import { describe, expect, it } from 'vitest';
import {
  actionItemRoute,
  asArray,
  asRecord,
  resolveSystemHealthTab,
  textList,
} from './systemHealth';

describe('system health helpers', () => {
  it('normalizes unsafe table data without throwing', () => {
    expect(asArray([{ id: 1 }])).toEqual([{ id: 1 }]);
    expect(asArray(null)).toEqual([]);
    expect(asArray({ items: [] })).toEqual([]);
    expect(asRecord({ status: 'ok' })).toEqual({ status: 'ok' });
    expect(asRecord([])).toEqual({});
  });

  it('formats mixed warning values into readable text', () => {
    expect(textList(['pending', { reason: 'file_missing' }, 7, false, null])).toEqual([
      'pending',
      'file_missing',
      '7',
      'false',
    ]);
  });

  it('resolves only known system health tabs', () => {
    expect(resolveSystemHealthTab('?tab=governance')).toBe('governance');
    expect(resolveSystemHealthTab('?tab=unknown')).toBe('actions');
    expect(resolveSystemHealthTab('')).toBe('actions');
  });

  it('routes action center items to precise remediation pages', () => {
    expect(actionItemRoute({ code: 'api_failed_24h' })).toBe('/system-health?tab=api');
    expect(actionItemRoute({ code: 'accounting_reports_missing' })).toBe('/system-health?tab=accounting');
    expect(actionItemRoute({ code: 'knowledge_index_attention' })).toBe('/system-health?tab=governance');
    expect(actionItemRoute({ code: 'retail_trend_anomaly' })).toBe('/retail/alert');
    expect(actionItemRoute({ code: 'report_254_pending' })).toBe('/reports');
  });
});
