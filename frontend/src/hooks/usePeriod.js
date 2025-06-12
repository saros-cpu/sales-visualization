import { useState, useEffect, useCallback } from 'react';
import { getPeriods } from '../api/sales';

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
    getPeriods()
      .then((data) => {
        const list = data.years?.length ? data.years : [2023, 2024, 2025, 2026];
        setYears(list);
        // 如果当前 year 不在列表中，使用最新年份
        const latest = String(Math.max(...list));
        if (!list.includes(Number(year))) {
          setYearState(latest);
        }
      })
      .catch(() => setYears([2023, 2024, 2025, 2026]))
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
