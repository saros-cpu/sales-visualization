import { DatePicker } from 'antd';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';

interface Props {
  value: number | string;
  onChange: (year: number, month?: number) => void;
  picker?: 'year' | 'month';
}

export default function PeriodPicker({ value, onChange, picker = 'year' }: Props) {
  const parsed: Dayjs = picker === 'year'
    ? dayjs(`${value}`, 'YYYY')
    : dayjs(`${value}`, 'YYYY-MM');
  return (
    <DatePicker
      picker={picker}
      value={parsed}
      onChange={(d) => {
        if (!d) return;
        if (picker === 'year') onChange(d.year());
        else onChange(d.year(), d.month() + 1);
      }}
      format={picker === 'year' ? 'YYYY' : 'YYYY-MM'}
    />
  );
}
