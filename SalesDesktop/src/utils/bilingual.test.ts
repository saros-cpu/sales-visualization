import { describe, expect, it } from 'vitest';
import { splitBilingual, isBilingual } from './bilingual';

describe('splitBilingual', () => {
  it('splits Chinese-on-top / Russian-below bilingual full name', () => {
    const { top, bottom } = splitBilingual('Example石油公司CJSC" ExampleCo Petroleum Companyя ExampleCo"');
    expect(top).toBe('Example石油公司');
    expect(bottom).toBe('CJSC" ExampleCo Petroleum Companyя ExampleCo"');
  });

  it('strips trailing separators/quotes from the Chinese top part', () => {
    const { top, bottom } = splitBilingual('Example石油公司 / Example Petroleum CJSC');
    expect(top).toBe('Example石油公司');
    expect(bottom).toBe('Example Petroleum CJSC');
  });

  it('keeps pure Russian name as a single top line', () => {
    const { top, bottom } = splitBilingual('CUSTOMER-H');
    expect(top).toBe('CUSTOMER-H');
    expect(bottom).toBe('');
  });

  it('keeps pure Chinese name as a single top line', () => {
    const { top, bottom } = splitBilingual('STN-63');
    expect(top).toBe('STN-63');
    expect(bottom).toBe('');
  });

  it('handles null/empty input', () => {
    expect(splitBilingual(null)).toEqual({ top: '', bottom: '' });
    expect(splitBilingual('')).toEqual({ top: '', bottom: '' });
    expect(splitBilingual(undefined)).toEqual({ top: '', bottom: '' });
  });

  it('splits bilingual name with Cyrillic quote right after Chinese', () => {
    const { top, bottom } = splitBilingual('油气公司CJSC" CUSTOMER-S Companyя"');
    expect(top).toBe('油气公司');
    expect(bottom).toBe('CJSC" CUSTOMER-S Companyя"');
  });
});

describe('isBilingual', () => {
  it('detects mixed Chinese + Cyrillic', () => {
    expect(isBilingual('Example石油公司CJSC ExampleCo')).toBe(true);
  });

  it('rejects pure Russian and pure Chinese', () => {
    expect(isBilingual('CUSTOMER-H')).toBe(false);
    expect(isBilingual('STN-63')).toBe(false);
    expect(isBilingual(null)).toBe(false);
    expect(isBilingual('')).toBe(false);
  });
});
