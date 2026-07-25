import { List, Progress } from 'antd';
import { useTranslation } from 'react-i18next';
import { sortRankingRows } from '@/utils/rankingCharts';

interface Row {
  name: string;
  tons: number;
  amountCny?: number;
  truckTons?: number;
  trainTons?: number;
  truckRows?: number;
  trainRows?: number;
  loadingTruckTons?: number;
  loadingTrainTons?: number;
  unloadingTruckTons?: number;
  unloadingTrainTons?: number;
}

export default function BarList({ rows, showAmount }: { rows: Row[]; showAmount?: boolean }) {
  const { t } = useTranslation();
  const sortedRows = sortRankingRows(rows, (row) => row.tons);
  const max = Math.max(...sortedRows.map((r) => r.tons), 1);
  return (
    <List
      size="small"
      dataSource={sortedRows}
      renderItem={(r) => (
        <List.Item>
          <div style={{ width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ minWidth: 0, wordBreak: 'break-word' }}>
                {r.name}
                {(r.loadingTruckTons !== undefined || r.unloadingTruckTons !== undefined) ? (
                  <>
                    <small style={{ display: 'block', color: '#667085', marginTop: 2 }}>
                      {t('wholesale.loading')}: {t('transport.truck')} {Number(r.loadingTruckTons || 0).toLocaleString()} т
                      {' | '}
                      {t('transport.train')} {Number(r.loadingTrainTons || 0).toLocaleString()} т
                    </small>
                    <small style={{ display: 'block', color: '#667085', marginTop: 2 }}>
                      {t('wholesale.unloading')}: {t('transport.truck')} {Number(r.unloadingTruckTons || 0).toLocaleString()} т
                      {' | '}
                      {t('transport.train')} {Number(r.unloadingTrainTons || 0).toLocaleString()} т
                    </small>
                  </>
                ) : (r.truckTons !== undefined || r.trainTons !== undefined) && (
                  <small style={{ display: 'block', color: '#667085', marginTop: 2 }}>
                    {t('transport.truck')}: {Number(r.truckTons || 0).toLocaleString()} т
                    {' | '}
                    {t('transport.train')}: {Number(r.trainTons || 0).toLocaleString()} т
                  </small>
                )}
              </span>
              <span style={{ flex: '0 0 auto' }}>{r.tons.toLocaleString()} т{showAmount && r.amountCny ? ` / ¥${r.amountCny.toLocaleString()}` : ''}</span>
            </div>
            <Progress percent={Math.round((r.tons / max) * 100)} showInfo={false} strokeColor="#CC0000" />
          </div>
        </List.Item>
      )}
    />
  );
}
