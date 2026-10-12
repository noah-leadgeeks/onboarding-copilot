'use client';
import { useEffect, useState, type ChangeEvent } from 'react';
import { pendingSyncStorageKey, readPendingSyncs } from '@/lib/sync-queue';
import { isHealthSnapshot, notifySyncChanged, retryPendingSessionSyncs, type HealthSnapshot } from '@/lib/sync-status';
import { connectionLines, friendlyExtractError, isSheetNotConfiguredError, type ConnectionTone } from '@/lib/connection-status';
import { SyncStatusChip } from '@/app/components/SyncStatusChip';
import { AgentAccessSection } from '@/app/components/AgentAccessSection';
import { IMPORTED_SCHEDULE_STORAGE_KEY, readImportedSchedule, writeImportedSchedule, type ImportedSchedule } from '@/lib/imported-schedule';
import { DIARY_STORAGE_KEY, mergeImportedDiary, readDiary, type StoredDiary } from '@/lib/local-records';
import { FEEDBACK_STORAGE_KEY, readFeedbackEntries, upsertFeedbackEntry, writeFeedbackEntries } from '@/lib/feedback';
import { isActivityList } from '@/lib/sheets/types';
import type { Activity } from '@/lib/types/activity';
import type { ExtractedSpreadsheetContent } from '@/lib/sheets/extractor';
import {
  IconAlertTriangle,
  IconCheck,
  IconClock,
  IconExternalLink,
} from '@/app/components/Icons';

type ImportPreview = { activities: Activity[]; skipped: number; warnings: string[]; diary?: StoredDiary[] };

const toneDot: Record<ConnectionTone, string> = {
  ok: 'bg-mint-600',
  warn: 'bg-peach-600',
  off: 'border border-stone-400 bg-stone-100',
};

const toneText: Record<ConnectionTone, string> = {
  ok: 'text-mint-800',
  warn: 'text-peach-800',
  off: 'text-stone-600',
};

function isImportPreview(value: unknown): value is ImportPreview {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return isActivityList(record.activities)
    && typeof record.skipped === 'number'
    && Array.isArray(record.warnings)
    && record.warnings.every((warning) => typeof warning === 'string')
    && (record.diary === undefined || Array.isArray(record.diary));
}

export default function SettingsPage() {
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [healthError, setHealthError] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [imported, setImported] = useState<ImportedSchedule | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importError, setImportError] = useState('');
  const [importMessage, setImportMessage] = useState('');
  const [session, setSession] = useState<{ authenticated: boolean; user: { name: string; email: string; picture?: string } | null } | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractResult, setExtractResult] = useState<ExtractedSpreadsheetContent | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [lastExtractSource, setLastExtractSource] = useState<'local' | 'sheets' | undefined>(undefined);
  const [retrying, setRetrying] = useState(false);
  const [checkingHealth, setCheckingHealth] = useState(false);

  async function handleExtractSheets(source?: 'local' | 'sheets') {
    setExtracting(true);
    setExtractError(null);
    setLastExtractSource(source);
    try {
      const url = `/api/sheets/extract${source ? '?source=' + source : ''}`;
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setExtractError(data.message || data.error || 'Couldn’t load the spreadsheet.');
        setExtractResult(null);
      } else {
        setExtractResult(data.data);
        setExtractError(null);
      }
    } catch (err: unknown) {
      setExtractError(err instanceof Error ? err.message : 'Couldn’t reach the server to load the spreadsheet.');
    } finally {
      setExtracting(false);
    }
  }

  function applyExtractedSchedule() {
    if (!extractResult?.schedule?.activities?.length) return;
    const activities = extractResult.schedule.activities;
    writeImportedSchedule({
      activities,
      importedAt: new Date().toISOString(),
    });
    setImported({
      activities,
      importedAt: new Date().toISOString(),
    });
    if (extractResult.diary?.entries?.length) {
      const existingDiary = readDiary(localStorage.getItem(DIARY_STORAGE_KEY));
      const merged = mergeImportedDiary(existingDiary, extractResult.diary.entries);
      localStorage.setItem(DIARY_STORAGE_KEY, JSON.stringify(merged));
    }
    if (extractResult.feedback?.entries?.length) {
      const existingFeedback = readFeedbackEntries(localStorage.getItem(FEEDBACK_STORAGE_KEY));
      let mergedFeedback = [...existingFeedback];
      for (const item of extractResult.feedback.entries) {
        mergedFeedback = upsertFeedbackEntry(mergedFeedback, item);
      }
      localStorage.setItem(FEEDBACK_STORAGE_KEY, writeFeedbackEntries(mergedFeedback));
    }
    setImportMessage(
      `Applied ${activities.length} activities, ${extractResult.diary?.entries?.length || 0} diary notes, and ${extractResult.feedback?.entries?.length || 0} feedback evaluations.`
    );
  }

  async function refreshSession() {
    try {
      const res = await fetch('/api/auth/session', { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as { authenticated: boolean; user: { name: string; email: string; picture?: string } | null };
        setSession(data);
      }
    } catch {
      /* ignore session fetch error */
    }
  }

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.href = '/login?logout=success';
    }
  }


  async function retryPending() {
    if (retrying) return;
    setRetrying(true);
    try {
      const { synced, remaining } = await retryPendingSessionSyncs(localStorage, fetch);
      setPendingCount(remaining.length);
      setSyncMessage(
        synced.length
          ? `${synced.length} session${synced.length === 1 ? '' : 's'} synced`
          : remaining.length
            ? 'No waiting sessions could be synced yet'
            : 'No sessions are waiting to sync'
      );
    } finally {
      setRetrying(false);
      notifySyncChanged();
    }
  }
  async function refreshHealth() {
    setCheckingHealth(true);
    try {
      const response = await fetch('/api/health', { cache: 'no-store' }).catch(() => null);
      const value: unknown = response?.ok ? await response.json().catch(() => null) : null;
      if (isHealthSnapshot(value)) { setHealth(value); setHealthError(false); } else setHealthError(true);
    } finally {
      setCheckingHealth(false);
    }
  }
  async function importSchedule(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (!file) return;
    setParsing(true);
    setImportError('');
    setImportMessage('');
    const body = new FormData();
    body.append('file', file);
    const response = await fetch('/api/import', { method: 'POST', body }).catch(() => null);
    setParsing(false);
    if (!response?.ok) {
      const value: unknown = await response?.json().catch(() => null);
      const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
      setImportError(record && typeof record.error === 'string' ? record.error : 'Import failed. The file could not be read.');
      return;
    }
    const value: unknown = await response.json().catch(() => null);
    if (!isImportPreview(value)) { setImportError('The file could not be understood. Check the format and try again.'); return; }
    setPreview(value);
  }
  function confirmImport() {
    if (!preview) return;
    const schedule: ImportedSchedule = { activities: preview.activities, importedAt: new Date().toISOString() };
    localStorage.setItem(IMPORTED_SCHEDULE_STORAGE_KEY, writeImportedSchedule(schedule));
    let diaryMsg = '';
    if (preview.diary && preview.diary.length > 0) {
      const existingDiary = readDiary(localStorage.getItem(DIARY_STORAGE_KEY));
      const merged = mergeImportedDiary(existingDiary, preview.diary);
      const importedCount = merged.length - existingDiary.length;
      localStorage.setItem(DIARY_STORAGE_KEY, JSON.stringify(merged));
      diaryMsg = ` and ${importedCount} diary note${importedCount === 1 ? '' : 's'}`;
    }
    setImported(schedule);
    setImportMessage(`Schedule imported · ${schedule.activities.length} activities${diaryMsg}`);
    setPreview(null);
  }
  function discardImport() {
    setPreview(null);
    setImportMessage('');
  }
  function removeImported() {
    localStorage.removeItem(IMPORTED_SCHEDULE_STORAGE_KEY);
    setImported(null);
    setImportMessage('Imported schedule removed. Using the default schedule.');
  }
  useEffect(() => {
    void refreshHealth();
    void refreshSession();
    setPendingCount(readPendingSyncs(localStorage.getItem(pendingSyncStorageKey())).length);
    setImported(readImportedSchedule(localStorage.getItem(IMPORTED_SCHEDULE_STORAGE_KEY)));

    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'success') {
      setAuthNotice('Connected to Google successfully!');
      window.history.replaceState(null, '', '/settings');
    } else if (params.get('error')) {
      const err = params.get('error');
      setAuthNotice(err === 'access_denied' ? 'Sign in was cancelled.' : `Google authentication failed (${err}).`);
      window.history.replaceState(null, '', '/settings');
    }
  }, []);

  useEffect(() => {
    if (session?.authenticated && !extractResult && !extracting && !extractError) {
      void handleExtractSheets();
    }
  }, [session?.authenticated, extractResult, extracting, extractError]);

  const lines = health ? connectionLines(health) : [];
  // "No sheet configured" is a setup fact, not a failure: shown in a neutral tone (still with Retry).
  const extractNotConfigured = isSheetNotConfiguredError(extractError);
  const signInLabel = session?.authenticated ? 'Signed in' : health?.integrations.oauth ? 'Available' : health ? 'Not configured' : 'Checking…';
  const signInTone: ConnectionTone = session?.authenticated ? 'ok' : 'off';
  const sheetUrl = health?.spreadsheetId
    ? `https://docs.google.com/spreadsheets/d/${health.spreadsheetId}/edit?gid=592196667#gid=592196667`
    : null;
  const smallButton =
    'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-4 text-xs font-semibold transition active:scale-95 disabled:opacity-50 sm:min-h-9';

  return <main className="mx-auto min-h-screen max-w-4xl px-5 py-6 text-stone-900 sm:px-8 sm:py-8">
    <header className="animate-fade-up pb-8"><p className="text-sm font-medium text-stone-500">Preferences</p><h1 className="mt-2 text-4xl font-semibold tracking-tight text-stone-900 sm:text-5xl">Settings</h1><p className="mt-3 text-lg text-stone-600">Your app, your way.</p></header>
    <section data-tour="settings-connection-card" aria-labelledby="settings-connection-title" className="animate-fade-up stagger-1 mt-10 rounded-card bg-white p-6 shadow-soft sm:p-8">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h2 id="settings-connection-title" className="flex items-center gap-2 text-lg font-semibold text-stone-900">
          <span aria-hidden="true" className="inline-block size-2 rounded-full bg-sky-300" />
          Connection
        </h2>
        <button
          type="button"
          onClick={() => {
            void refreshHealth();
            void refreshSession();
          }}
          disabled={checkingHealth}
          className="min-h-11 rounded-full border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:opacity-60"
        >
          {checkingHealth ? 'Checking…' : 'Refresh'}
        </button>
      </div>

      {authNotice && (
        <p className="mt-3 rounded-xl bg-sun-50 p-3 text-sm text-stone-700" role="status">
          {authNotice}
        </p>
      )}

      {healthError && (
        <div role="alert" className="mt-4 flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-peach-200 bg-peach-50 px-4 py-3 text-sm text-peach-900">
          <p className="flex min-w-0 items-start gap-2">
            <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-peach-700" />
            <span>Couldn’t check the connection. Your work is still saved on this device.</span>
          </p>
          <button
            type="button"
            onClick={() => void refreshHealth()}
            disabled={checkingHealth}
            className={`${smallButton} bg-stone-900 text-white hover:bg-stone-800`}
          >
            {checkingHealth ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}

      {session?.authenticated && session.user ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-mint-50/80 p-4 ring-1 ring-mint-200">
          <div className="flex items-center gap-3 min-w-0">
            {session.user.picture ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={session.user.picture}
                alt={session.user.name}
                className="size-10 shrink-0 rounded-full border border-mint-200"
              />
            ) : (
              <div aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-mint-200 font-semibold text-mint-800">
                {session.user.name?.[0] || 'U'}
              </div>
            )}
            <div className="min-w-0">
              <p className="font-semibold text-stone-900 truncate">{session.user.name}</p>
              <p className="text-xs text-stone-600 truncate">{session.user.email}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleLogout()}
            className={`${smallButton} border border-stone-200 bg-white text-stone-700 hover:bg-stone-50`}
          >
            Sign out
          </button>
        </div>
      ) : (
        health?.integrations.oauth && (
          <div className="mt-4">
            <a
              href="/api/auth/login"
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-stone-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-700 active:scale-95"
            >
              <svg className="size-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z"/>
                <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"/>
                <path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.8 0-1.3.2-2.1.4-2.8L1.9 6.3C.7 8.7 0 10.3 0 12s.7 3.3 1.9 5.7l3.7-2.9z"/>
                <path fill="#34A853" d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16C3.7 19.7 7.5 23 12 23z"/>
              </svg>
              Sign in with Google
            </a>
          </div>
        )
      )}

      {!health && !healthError ? (
        <p className="mt-4 text-sm text-stone-500" role="status">Checking the connection…</p>
      ) : (
        <dl className="mt-4 divide-y divide-stone-100 text-sm">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
            <dt className="text-stone-600">Google sign-in</dt>
            <dd className={`flex items-center gap-2 font-medium ${toneText[signInTone]}`}>
              <span aria-hidden="true" className={`inline-block size-2.5 shrink-0 rounded-full ${toneDot[signInTone]}`} />
              {signInLabel}
            </dd>
          </div>
          {lines.map((line) => (
            <div key={line.id} className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
              <dt className="text-stone-600">{line.label}</dt>
              <dd className={`flex min-w-0 items-center gap-2 font-medium ${toneText[line.tone]}`}>
                <span aria-hidden="true" className={`inline-block size-2.5 shrink-0 rounded-full ${toneDot[line.tone]}`} />
                <span>{line.value}</span>
                {line.detail && (
                  <span className="min-w-0 truncate font-mono text-xs font-normal text-stone-600" title={line.detail}>
                    · {line.detail}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {health?.spreadsheetId && (
        <div className="mt-5 flex flex-wrap items-center gap-2 rounded-2xl border border-stone-200/80 bg-stone-50/70 p-4">
          <button
            type="button"
            disabled={extracting}
            onClick={() => void handleExtractSheets('sheets')}
            className={`${smallButton} bg-stone-900 text-white hover:bg-stone-700`}
          >
            {extracting ? 'Loading…' : 'Load everything from the spreadsheet'}
          </button>
          <button
            type="button"
            disabled={extracting}
            onClick={() => void handleExtractSheets('local')}
            className={`${smallButton} border border-stone-200 bg-white font-medium text-stone-700 hover:bg-stone-100`}
          >
            Test with local workbook
          </button>
          {sheetUrl && (
            <a
              href={sheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`${smallButton} border border-stone-200 bg-white font-medium text-sky-800 hover:bg-sky-50`}
            >
              <span>Open the spreadsheet</span>
              <IconExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}

      {extractError && (
        <div
          role={extractNotConfigured ? 'status' : 'alert'}
          className={`mt-4 flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm ${
            extractNotConfigured ? 'border-stone-200 bg-stone-50 text-stone-700' : 'border-peach-200 bg-peach-50 text-peach-900'
          }`}
        >
          <p className="flex min-w-0 items-start gap-2">
            <IconAlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${extractNotConfigured ? 'text-stone-500' : 'text-peach-700'}`} />
            <span className="min-w-0 break-words">
              <span className="font-semibold">Couldn’t load the spreadsheet.</span> {friendlyExtractError(extractError)}
            </span>
          </p>
          <button
            type="button"
            onClick={() => void handleExtractSheets(lastExtractSource)}
            disabled={extracting}
            className={`${smallButton} bg-stone-900 text-white hover:bg-stone-800`}
          >
            {extracting ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}

      {importMessage && (
        <p role="status" className="mt-4 flex items-center gap-2 text-sm text-mint-800">
          <IconCheck className="h-4 w-4 shrink-0" /> {importMessage}
        </p>
      )}

      {extractResult && (
        <div className="mt-4 rounded-xl border border-mint-200 bg-mint-50/80 p-4 space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="inline-flex min-w-0 items-center gap-1.5 font-semibold text-mint-900">
              <IconCheck className="h-4 w-4 text-mint-700 shrink-0" />
              <span>Loaded everything from {extractResult.title || 'the spreadsheet'}</span>
            </p>
            {extractResult.schedule?.activities && (
              <button
                type="button"
                onClick={applyExtractedSchedule}
                className={`${smallButton} bg-stone-900 text-white hover:bg-stone-800`}
              >
                Apply schedule
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            <div className="rounded-lg border border-mint-100 bg-white p-2.5">
              <span className="block text-lg font-bold text-stone-900">{extractResult.schedule?.count ?? 0}</span>
              <span className="text-xs font-medium text-stone-600">Activities</span>
            </div>
            <div className="rounded-lg border border-mint-100 bg-white p-2.5">
              <span className="block text-lg font-bold text-stone-900">{extractResult.diary?.count ?? 0}</span>
              <span className="text-xs font-medium text-stone-600">Diary notes</span>
            </div>
            <div className="rounded-lg border border-mint-100 bg-white p-2.5">
              <span className="block text-lg font-bold text-stone-900">{extractResult.timeline?.count ?? 0}</span>
              <span className="text-xs font-medium text-stone-600">Timeline stages</span>
            </div>
            <div className="rounded-lg border border-mint-100 bg-white p-2.5">
              <span className="block text-lg font-bold text-stone-900">{extractResult.feedback?.count ?? 0}</span>
              <span className="text-xs font-medium text-stone-600">Feedback sessions</span>
            </div>
          </div>

          {extractResult.sheets && extractResult.sheets.length > 0 && (
            <div className="border-t border-mint-200/60 pt-2 text-xs text-stone-600">
              <span className="font-medium text-stone-700">Tabs found:</span>{' '}
              {extractResult.sheets.map((s: { title: string; rowCount: number; columnCount: number }, idx: number) => (
                <span key={s.title}>
                  {idx > 0 && ' · '}
                  <span className="font-semibold text-stone-800">{s.title}</span> ({s.rowCount} rows)
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
    <section aria-labelledby="settings-sync-title" className="animate-fade-up stagger-2 mt-6 rounded-card bg-white p-6 shadow-soft sm:p-8">
      <SyncStatusChip variant="full" className="mb-3" />
      <h2 id="settings-sync-title" className="flex items-center gap-2 text-lg font-semibold text-stone-900"><span aria-hidden="true" className="inline-block size-2 rounded-full bg-mint-300" />Sync</h2>
      <p className="mt-3 text-stone-600">Completed sessions and learning notes sync after confirmation. Everything stays saved on this device if a service is unavailable.</p>
      <button type="button" onClick={() => void retryPending()} disabled={!pendingCount || retrying} className="mt-4 min-h-11 rounded-full border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:opacity-40 disabled:hover:transform-none">{retrying ? 'Retrying…' : 'Retry pending sync'}</button>
      <p className="mt-3 text-sm text-stone-600" role="status">
        {pendingCount ? <span className="inline-flex items-center gap-1.5 text-peach-800"><IconClock className="h-4 w-4 shrink-0" /> {pendingCount} session{pendingCount === 1 ? '' : 's'} waiting to sync</span> : <span className="inline-flex items-center gap-1.5 text-mint-800"><IconCheck className="h-4 w-4 shrink-0" /> No sessions waiting to sync</span>}
        {syncMessage && <span className="mt-1 block text-stone-600">{syncMessage}</span>}
      </p>
    </section>
    <AgentAccessSection />
    <section className="animate-fade-up stagger-4 mt-6 rounded-card bg-white p-6 shadow-soft sm:p-8"><h2 className="flex items-center gap-2 text-lg font-semibold text-stone-900"><span aria-hidden="true" className="inline-block size-2 rounded-full bg-lavender-300" />Guide tour</h2><p className="mt-3 text-stone-600">New to the cockpit? Take a short walkthrough of Today, the timeline, quick notes, and more.</p><a href="/?tour=start" className="mt-4 inline-flex min-h-11 items-center rounded-full border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50">Take the tour again</a></section></main>;
}
