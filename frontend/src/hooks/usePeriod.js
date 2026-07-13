import { useState, useEffect, useCallback } from 'react';
import { getPeriods } from '../api/sales';
import { normalizeRetailYears } from '../utils/retail-helpers';

// 从 localStorage 恢复用户上次选择的时间段
function getSavedPeriod() {
  try {
    return {
      year: localStorage.getItem('salesPeriodYear') || String(new Date().getFullYear()),
      month: localStorage.getItem('salesPeriodMonth') || '',
    };
  } catch {
    return { year: String(new Date().getFullYear()), month: '' };
  }
}

function savePeriod(year, month) {
  try {
    if (year) localStorage.setItem('salesPeriodYear', year);
    localStorage.setItem('salesPeriodMonth', month || '');
  } catch {
    // localStorage may be unavailable
  }
}

export function usePeriod() {
  const [years, setYears] = useState([]);
  const saved = getSavedPeriod();
  const [year, setYearState] = useState(saved.year);
  const [month, setMonthState] = useState(saved.month);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fallbackYears = normalizeRetailYears([]).slice().reverse();
    getPeriods()
      .then((data) => {
        const list = normalizeRetailYears(data.years?.length ? data.years : fallbackYears).slice().reverse();
        setYears(list);
        // 如果当前 year 不在列表中，使用最新年份
        const latest = String(Math.max(...list));
        if (!list.includes(Number(year))) {
          setYearState(latest);
        }
      })
      .catch(() => setYears(fallbackYears))
      .finally(() => setLoading(false));
  }, []);

  const setYear = useCallback((y) => {
    setYearState(y);
    savePeriod(y, month);
  }, [month]);

  const setMonth = useCallback((m) => {
    setMonthState(m);
    savePeriod(year, m);
  }, [year]);

  return {
    years,
    year,
    month,
    setYear,
    setMonth,
    loading,
    // 显示标签
    label: month ? `${year} 年 ${month} 月` : `${year} 年全年`,
  };
}
