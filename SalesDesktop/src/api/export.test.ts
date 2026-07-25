import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  downloadWithAuth: vi.fn(),
  refreshAccessToken: vi.fn(async () => ''),
  message: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('./download', () => ({
  downloadWithAuth: mocks.downloadWithAuth,
}));

vi.mock('./http', () => ({
  API_HOST: 'https://sales.example.com',
  refreshAccessToken: mocks.refreshAccessToken,
}));

vi.mock('antd', () => ({
  message: mocks.message,
}));

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

function firstFetchUrl(fetchMock: ReturnType<typeof vi.fn>) {
  return (fetchMock.mock.calls[0] as unknown[])[0];
}

describe('desktop report export API', () => {
  beforeEach(() => {
    mocks.downloadWithAuth.mockReset();
    mocks.refreshAccessToken.mockClear();
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('generates monthly analysis reports through the shared web endpoint', async () => {
    const openExternal = vi.fn();
    const fetchMock = vi.fn(async () => jsonResponse({
      status: 'ok',
      docxDownloadUrl: '/api/export/analysis/download/month.docx',
      htmlDownloadUrl: '/api/export/analysis/download/month.html',
      htmlViewUrl: '/api/export/analysis/view/month.html',
      docxFile: 'month.docx',
      htmlFile: 'month.html',
    }));
    vi.stubGlobal('window', { electronAPI: { openExternal } });
    vi.stubGlobal('fetch', fetchMock);

    const { generateAndDownloadReport } = await import('./export');
    const result = await generateAndDownloadReport({ kind: 'analysisMonthly', yearMonth: '2026-07' });

    expect(firstFetchUrl(fetchMock)).toBe('https://sales.example.com/api/export/analysis/monthly/2026-07');
    expect(mocks.downloadWithAuth).toHaveBeenCalledWith('https://sales.example.com/api/export/analysis/download/month.docx', 'month.docx');
    expect(mocks.downloadWithAuth).toHaveBeenCalledWith('https://sales.example.com/api/export/analysis/download/month.html', 'month.html');
    expect(openExternal).toHaveBeenCalledWith('https://sales.example.com/api/export/analysis/view/month.html');
    expect(result.downloaded).toHaveLength(2);
  });

  it('generates yearly analysis reports through the shared web endpoint', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      status: 'ok',
      docxDownloadUrl: '/api/export/analysis/download/year.docx',
      docxFile: 'year.docx',
    }));
    vi.stubGlobal('window', {});
    vi.stubGlobal('fetch', fetchMock);

    const { generateAndDownloadReport } = await import('./export');
    await generateAndDownloadReport({ kind: 'analysisYearly', year: 2026 });

    expect(firstFetchUrl(fetchMock)).toBe('https://sales.example.com/api/export/analysis/yearly/2026');
    expect(mocks.downloadWithAuth).toHaveBeenCalledWith('https://sales.example.com/api/export/analysis/download/year.docx', 'year.docx');
  });

  it('generates retail daily workbooks before downloading the saved file', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      status: 'ok',
      file: '加油站七月份日销表10.08.xlsx',
    }));
    vi.stubGlobal('window', {});
    vi.stubGlobal('fetch', fetchMock);

    const { generateAndDownloadReport } = await import('./export');
    await generateAndDownloadReport({ kind: 'retailDaily', yearMonth: '2026-07' });

    expect(firstFetchUrl(fetchMock)).toBe('https://sales.example.com/api/export/monthly/2026-07');
    expect(mocks.downloadWithAuth).toHaveBeenCalledWith(
      'https://sales.example.com/api/export/monthly/2026-07/download',
      '加油站七月份日销表10.08.xlsx',
    );
  });

  it('downloads single day retail workbook when generated with the monthly report', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      status: 'ok',
      file: '加油站八月份日销表12.08.xlsx',
      singleDayFile: '加油站八月份零售日报08.12.xlsx',
      singleDayDownloadUrl: '/api/export/monthly/2026-08/daily/download',
    }));
    vi.stubGlobal('window', {});
    vi.stubGlobal('fetch', fetchMock);

    const { generateAndDownloadReport } = await import('./export');
    await generateAndDownloadReport({ kind: 'retailDaily', yearMonth: '2026-08' });

    expect(mocks.downloadWithAuth).toHaveBeenCalledWith(
      'https://sales.example.com/api/export/monthly/2026-08/download',
      '加油站八月份日销表12.08.xlsx',
    );
    expect(mocks.downloadWithAuth).toHaveBeenCalledWith(
      'https://sales.example.com/api/export/monthly/2026-08/daily/download',
      '加油站八月份零售日报08.12.xlsx',
    );
  });

  it('generates daily briefing workbooks through the shared export endpoint', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      status: 'ok',
      file: 'ProductTeam销售日报表2026.08.10.xlsx',
    }));
    vi.stubGlobal('window', {});
    vi.stubGlobal('fetch', fetchMock);

    const { downloadDailyBriefingReport } = await import('./export');
    await downloadDailyBriefingReport('2026-08-10');

    expect(firstFetchUrl(fetchMock)).toBe('https://sales.example.com/api/export/daily-briefing/2026-08-10');
    expect(mocks.downloadWithAuth).toHaveBeenCalledWith(
      'https://sales.example.com/api/export/daily-briefing/2026-08-10/download',
      'ProductTeam销售日报表2026.08.10.xlsx',
    );
  });

  it('refreshes daily briefing generation without forcing a second download regeneration', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      status: 'ok',
      file: 'ProductTeam销售日报表2026.08.10.xlsx',
    }));
    vi.stubGlobal('window', {});
    vi.stubGlobal('fetch', fetchMock);

    const { downloadDailyBriefingReport } = await import('./export');
    await downloadDailyBriefingReport('2026-08-10', true);

    expect(firstFetchUrl(fetchMock)).toBe('https://sales.example.com/api/export/daily-briefing/2026-08-10?refresh=1');
    expect(mocks.downloadWithAuth).toHaveBeenCalledWith(
      'https://sales.example.com/api/export/daily-briefing/2026-08-10/download',
      'ProductTeam销售日报表2026.08.10.xlsx',
    );
  });

  it('generates monthly wholesale reports through the shared web endpoint', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      status: 'ok',
      docxDownloadUrl: '/api/export/analysis/sales/download/wholesale-month.docx',
      docxFile: 'wholesale-month.docx',
    }));
    vi.stubGlobal('window', {});
    vi.stubGlobal('fetch', fetchMock);

    const { downloadWholesaleReport } = await import('./export');
    await downloadWholesaleReport({ year: 2026, month: 7 });

    expect(firstFetchUrl(fetchMock)).toBe('https://sales.example.com/api/export/analysis/wholesale/monthly/2026-07');
    expect(mocks.downloadWithAuth).toHaveBeenCalledWith(
      'https://sales.example.com/api/export/analysis/sales/download/wholesale-month.docx',
      'wholesale-month.docx',
    );
  });

  it('generates yearly wholesale reports through the shared web endpoint', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      status: 'ok',
      htmlDownloadUrl: '/api/export/analysis/sales/download/wholesale-year.html',
      htmlFile: 'wholesale-year.html',
    }));
    vi.stubGlobal('window', {});
    vi.stubGlobal('fetch', fetchMock);

    const { downloadWholesaleReport } = await import('./export');
    await downloadWholesaleReport({ year: 2026 });

    expect(firstFetchUrl(fetchMock)).toBe('https://sales.example.com/api/export/analysis/wholesale/yearly/2026');
    expect(mocks.downloadWithAuth).toHaveBeenCalledWith(
      'https://sales.example.com/api/export/analysis/sales/download/wholesale-year.html',
      'wholesale-year.html',
    );
  });
});
