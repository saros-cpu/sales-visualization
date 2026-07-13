import { describe, expect, it } from 'vitest';
import { stationNameLines } from './StationNameStack';

describe('StationNameStack helpers', () => {
  it('splits bilingual station names into Chinese and Russian display lines', () => {
    expect(stationNameLines('\u041a\u0430\u0440\u0430-\u0431\u0430\u043b\u0442\u0430 1 / \u5361\u5317')).toEqual({
      primary: '\u5361\u5317',
      secondary: '\u041a\u0430\u0440\u0430-\u0431\u0430\u043b\u0442\u0430 1',
      title: '\u5361\u5317 / \u041a\u0430\u0440\u0430-\u0431\u0430\u043b\u0442\u0430 1',
    });
  });
});
