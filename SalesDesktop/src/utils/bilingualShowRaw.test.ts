import { describe, expect, it } from 'vitest';
import { shouldShowRaw } from './bilingual';

// shouldShowRaw 判定护栏：覆盖 5.4.1（中文主行比较）、5.4.2（中文文本比较）、
// 5.5.1（俄文词重叠）三个版本演化出的真实场景，防止后续热修回归。

describe('shouldShowRaw — 中文主名相同（5.4.1/5.4.2 场景）', () => {
  it('手录名带分隔符/引号与标准名不同写法 -> 不补显（同一实体）', () => {
    // 5.4.1 失效场景：中文主行带尾部分隔符
    expect(
      shouldShowRaw(
        'Example石油公司 / Example Petroleum CJSC',
        'Example石油公司',
      ),
    ).toBe(false);
  });

  it('标准名与原始名完全一致 -> 不补显', () => {
    expect(shouldShowRaw('Example石油公司CJSC ExampleCo', 'Example石油公司CJSC ExampleCo')).toBe(false);
  });

  it('原始名是标准名的子串 -> 不补显', () => {
    expect(shouldShowRaw('Example石油公司CJSC ExampleCo', 'Example石油公司')).toBe(false);
  });

  it('中文主名相同但写法不同（引号/俄文拼写差异）-> 不补显', () => {
    expect(
      shouldShowRaw(
        'Example石油公司CJSC" ExampleCo Petroleum Companyя ExampleCo"',
        'Example石油公司 / Example Petroleum CJSC',
      ),
    ).toBe(false);
  });

  it('中文主名不同的不同实体 -> 补显（保留核对信息）', () => {
    expect(shouldShowRaw('STN-63 S-64', 'CTY-23')).toBe(true);
  });

  it('标准名纯中文、原始名纯俄文且无重叠词 -> 补显', () => {
    expect(shouldShowRaw('STN-63 S-64', 'X-43')).toBe(true);
  });
});

describe('shouldShowRaw — 纯俄文原始名（5.5.1 场景）', () => {
  const stdZd = 'Example石油公司CJSC" ExampleCo Petroleum Companyя ExampleCo"';

  it('称重表纯俄文原始名 vs 双语标准名（俄文词重叠≥50%）-> 不补显', () => {
    // 5.4.2 中文比较失效场景：raw 无中文字符
    expect(shouldShowRaw(stdZd, 'CJSC\'\'ExampleCo Petroleum Company ExampleCo\'\'')).toBe(false);
  });

  it('俄文词重叠≥50% 视为同一实体（大小写差异）-> 不补显', () => {
    expect(shouldShowRaw(stdZd, 'Example Petroleum CJSC')).toBe(false);
  });

  it('通用法律词（CJSC/НПЗ）不参与重叠计算', () => {
    // 双方只差法律词缀，实体词完全重叠 -> 不补显
    expect(shouldShowRaw('CJSC НПЗ CUSTOMER-H-3', 'CUSTOMER-H-3')).toBe(false);
  });

  it('俄文词重叠不足 50% 的不同实体 -> 保留补显', () => {
    // raw 为 ИП CUSTOMER-V（真实不同实体），与标准名俄文词几乎无重叠
    expect(shouldShowRaw('Example石油公司CJSC" ExampleCo Petroleum Companyя ExampleCo"', 'ИП CUSTOMER-V')).toBe(true);
  });

  it('纯俄文原始名与标准名俄文词完全不同 -> 补显', () => {
    expect(shouldShowRaw('Ч.П.К. ExampleCo АЗС CTY-04', 'CJSC CUSTOMER-M')).toBe(true);
  });
});

describe('shouldShowRaw — 边界', () => {
  it('raw 为空/未传 -> 不补显', () => {
    expect(shouldShowRaw('Example', undefined)).toBe(false);
    expect(shouldShowRaw('Example', null)).toBe(false);
    expect(shouldShowRaw('Example', '')).toBe(false);
  });

  it('value 为空但 raw 有值 -> 以 raw 显示，不补显自身', () => {
    expect(shouldShowRaw(null, 'CUSTOMER-H')).toBe(false);
    expect(shouldShowRaw('', 'CJSC CUSTOMER-J')).toBe(false);
  });

  it('value/raw 都为空 -> 不补显', () => {
    expect(shouldShowRaw(null, null)).toBe(false);
  });
});
