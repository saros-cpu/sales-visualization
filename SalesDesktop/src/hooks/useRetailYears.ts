import { useEffect, useState } from 'react';
import { getYears } from '@/api/retail';
import { normalizeRetailYears } from '@/utils/retailPeriod';

export function useRetailYears(initialYear = new Date().getFullYear()) {
  const [year, setYear] = useState(initialYear);
  const [yearOptions, setYearOptions] = useState<number[]>(() => normalizeRetailYears([], initialYear));

  useEffect(() => {
    let active = true;
    const applyYears = (values?: Array<number | string> | null) => {
      const options = normalizeRetailYears(values, initialYear);
      setYearOptions(options);
      setYear((prev) => (options.includes(prev) ? prev : options[0]));
    };

    getYears()
      .then((list) => {
        if (active) applyYears(list);
      })
      .catch(() => {
        if (active) applyYears();
      });

    return () => { active = false; };
  }, [initialYear]);

  return { year, setYear, yearOptions };
}
