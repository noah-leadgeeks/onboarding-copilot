import { POST } from './route';
import * as sessionModule from '@/lib/auth/session';
import * as extractorModule from '@/lib/sheets/extractor';

jest.mock('@/lib/auth/session');
jest.mock('@/lib/sheets/extractor');
jest.mock('@/lib/db', () => ({
  isDbConfigured: () => false,
  db: {
    select: jest.fn(),
  },
  schema: {
    activities: {},
  },
}));

describe('/api/schedule/sync route', () => {
  const originalEnv = process.env.GOOGLE_SHEETS_ID;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GOOGLE_SHEETS_ID = 'test-spreadsheet-id-123';
  });

  afterAll(() => {
    process.env.GOOGLE_SHEETS_ID = originalEnv;
  });

  it('returns 400 when GOOGLE_SHEETS_ID is missing', async () => {
    delete process.env.GOOGLE_SHEETS_ID;
    const req = new Request('http://localhost/api/schedule/sync', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('GOOGLE_SHEETS_ID');
  });

  it('returns 401 when Google OAuth session token is not present', async () => {
    jest.spyOn(sessionModule, 'getSessionAccessToken').mockResolvedValue(undefined);
    const req = new Request('http://localhost/api/schedule/sync', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.authenticated).toBe(false);
    expect(data.loginUrl).toBe('/api/auth/login');
  });

  it('successfully syncs all activities using batchUpdateSheetRanges', async () => {
    jest.spyOn(sessionModule, 'getSessionAccessToken').mockResolvedValue('valid-access-token');
    const batchSpy = jest.spyOn(extractorModule, 'batchUpdateSheetRanges').mockResolvedValue({
      totalUpdatedRows: 95,
      totalUpdatedColumns: 6,
      totalUpdatedCells: 570,
      totalUpdatedSheets: 1,
    });

    const req = new Request('http://localhost/api/schedule/sync', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.totalActivities).toBe(95);
    expect(data.totalUpdatedRows).toBe(95);
    expect(data.totalUpdatedCells).toBe(570);
    expect(data.chunksCount).toBe(8);

    expect(batchSpy.mock.calls.length).toBe(1);
    const [calledSpreadsheetId, calledData, calledAuth] = batchSpy.mock.calls[0];
    expect(calledSpreadsheetId).toBe('test-spreadsheet-id-123');
    expect(calledData.length).toBe(8);
    expect(calledData[0].range).toBe("'Schedule'!G3:L23");
    expect(calledData[1].range).toBe("'Schedule'!G25:L34");
    expect(calledData[2].range).toBe("'Schedule'!G36:L42");
    expect(calledData[3].range).toBe("'Schedule'!G44:L51");
    expect(calledData[4].range).toBe("'Schedule'!G53:L56");
    expect(calledData[5].range).toBe("'Schedule'!G58:L100");
    expect(calledData[6].range).toBe("'Schedule'!G102:L102");
    expect(calledData[7].range).toBe("'Schedule'!G106:L106");
    expect(calledAuth).toEqual({ accessToken: 'valid-access-token' });
  });

  it('filters by week when week parameter is specified', async () => {
    jest.spyOn(sessionModule, 'getSessionAccessToken').mockResolvedValue('valid-access-token');
    const batchSpy = jest.spyOn(extractorModule, 'batchUpdateSheetRanges').mockResolvedValue({
      totalUpdatedRows: 21,
      totalUpdatedColumns: 6,
      totalUpdatedCells: 126,
      totalUpdatedSheets: 1,
    });

    const req = new Request('http://localhost/api/schedule/sync', {
      method: 'POST',
      body: JSON.stringify({ week: 'Week 1' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.totalActivities).toBe(21);
    expect(data.chunksCount).toBe(1);

    expect(batchSpy.mock.calls.length).toBe(1);
    const [, calledData] = batchSpy.mock.calls[0];
    expect(calledData[0].range).toBe("'Schedule'!G3:L23");
    expect(calledData[0].values.length).toBe(21);
  });

  it('gracefully falls back to sequential updateSheetRange if batchUpdate fails', async () => {
    jest.spyOn(sessionModule, 'getSessionAccessToken').mockResolvedValue('valid-access-token');
    jest.spyOn(extractorModule, 'batchUpdateSheetRanges').mockRejectedValue(new Error('Batch update error'));
    const updateSpy = jest.spyOn(extractorModule, 'updateSheetRange').mockResolvedValue({
      updatedRange: "'Schedule'!G3:L23",
      updatedRows: 21,
      updatedColumns: 6,
      updatedCells: 126,
    });

    const req = new Request('http://localhost/api/schedule/sync', {
      method: 'POST',
      body: JSON.stringify({ week: 'Week 1' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(updateSpy.mock.calls.length).toBe(1);
    expect(updateSpy.mock.calls[0][1]).toBe("'Schedule'!G3:L23");
  });
});
