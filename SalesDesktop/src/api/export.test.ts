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
      file: '零售日销表_2026-07.xlsx',
    }));
    vi.stubGlobal('window', {});
    vi.stubGlobal('fetch', fetchMock);

    const { generateAndDownloadReport } = await import('./export');
    await generateAndDownloadReport({ kind: 'retailDaily', yearMonth: '2026-07' });

    expect(firstFetchUrl(fetchMock)).toBe('https://sales.example.com/api/export/monthly/2026-07');
    expect(mocks.downloadWithAuth).toHaveBeenCalledWith(
      'https://sales.example.com/api/export/monthly/2026-07/download',
      '零售日销表_2026-07.xlsx',
    );
  });
});
