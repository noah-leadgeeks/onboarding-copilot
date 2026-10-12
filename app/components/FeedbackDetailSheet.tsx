'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import {
  FEEDBACK_DIMENSIONS,
  formatFeedbackDate,
  isRatingComplete,
  normalizeQuestionAddressing,
  QUESTION_ADDRESSING_OPTIONS,
  type FeedbackEntry,
  type FeedbackRatingDimension,
  type FeedbackRatings,
  type FeedbackSession,
  type LikertScore,
  type QuestionAddressingOption,
} from '@/lib/feedback';
import { markSynced, notifySyncChanged } from '@/lib/sync-status';
import { RowTag } from './RowTag';
import { SheetToolsMenu, type SheetToolsMenuItem } from './SheetToolsMenu';
import { shouldSheetCloseOnEscape } from './sheetEscape';
import { useRestoreFocus } from './useRestoreFocus';
import { IconCalendar, IconCheck, IconEdit, IconLightbulb, IconUser, IconX } from './Icons';

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export interface FeedbackDetailSheetProps {
  readonly session: FeedbackSession | null;
  readonly existingEntry?: FeedbackEntry;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSave: (entry: FeedbackEntry) => void;
  readonly onCopyRow?: (entry: FeedbackEntry) => void;
  readonly onPrevSession?: () => void;
  readonly onNextSession?: () => void;
  readonly hasPrev?: boolean;
  readonly hasNext?: boolean;
  readonly isCopied?: boolean;
}

const LIKERT_OPTIONS: Array<{ score: LikertScore; label: string; short: string }> = [
  { score: 6, label: '6. Excellent', short: 'Excellent' },
  { score: 5, label: '5. Very Good', short: 'Very Good' },
  { score: 4, label: '4. Good', short: 'Good' },
  { score: 3, label: '3. Fair', short: 'Fair' },
  { score: 2, label: '2. Poor', short: 'Poor' },
  { score: 1, label: '1. Very Poor', short: 'Very Poor' },
];

interface AddressingChoiceConfig {
  value: QuestionAddressingOption;
  label: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
}

type AddressingChoiceStyle = Omit<AddressingChoiceConfig, 'value' | 'label'>;

// Option values come from QUESTION_ADDRESSING_OPTIONS (single source); badge styling stays local, by position.
const ADDRESSING_STYLES: readonly AddressingChoiceStyle[] = [
  { badgeBg: 'bg-amber-100', badgeText: 'text-amber-900', badgeBorder: 'border-amber-200' },
  { badgeBg: 'bg-purple-100', badgeText: 'text-purple-900', badgeBorder: 'border-purple-200' },
  { badgeBg: 'bg-sky-100', badgeText: 'text-sky-900', badgeBorder: 'border-sky-200' },
];

const ADDRESSING_CHOICES: AddressingChoiceConfig[] = QUESTION_ADDRESSING_OPTIONS.map((value, i) => ({
  value,
  label: value,
  ...ADDRESSING_STYLES[i],
}));

export function FeedbackDetailSheet({
  session,
  existingEntry,
  isOpen,
  onClose,
  onSave,
  onCopyRow,
  onPrevSession,
  onNextSession,
  hasPrev = false,
  hasNext = false,
  isCopied = false,
}: FeedbackDetailSheetProps) {
  const [isEditing, setIsEditing] = useState<boolean>(false);

  // Form state aligned with FeedbackEntry
  const [date, setDate] = useState<string>('');
  const [ratings, setRatings] = useState<Partial<FeedbackRatings>>({});
  const [hasQuestions, setHasQuestions] = useState<boolean>(false);
  const [questionExplanation, setQuestionExplanation] = useState<string>('');
  const [questionAddressing, setQuestionAddressing] = useState<string>('Chat response is fine');
  const [suggestions, setSuggestions] = useState<string>('');
  const [validationError, setValidationError] = useState<string | null>(null);

  // Sheets Sync state
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState<boolean>(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dateId = useId();
  const ratingsHeadingId = useId();
  const questionsLabelId = useId();
  const explanationId = useId();
  const addressingLabelId = useId();
  const suggestionsId = useId();
  useRestoreFocus(isOpen && Boolean(session), closeRef);

  // Sync state whenever session or existingEntry changes
  useEffect(() => {
    setSyncMessage(null);
    setSyncError(null);
    setNeedsAuth(false);

    if (session) {
      if (existingEntry) {
        setDate(existingEntry.date || formatFeedbackDate(new Date()));
        setRatings(existingEntry.ratings);
        setHasQuestions(Boolean(existingEntry.hasQuestions));
        setQuestionExplanation(existingEntry.questionExplanation || '');
        setQuestionAddressing(
          normalizeQuestionAddressing(existingEntry.questionAddressing) || 'Chat response is fine'
        );
        setSuggestions(existingEntry.suggestions || '');
        setIsEditing(false);
      } else {
        setDate(formatFeedbackDate(new Date()));
        setRatings({});
        setHasQuestions(false);
        setQuestionExplanation('');
        setQuestionAddressing('Chat response is fine');
        setSuggestions('');
        setIsEditing(true); // default to edit if not evaluated yet
      }
      setValidationError(null);
    }
  }, [session, existingEntry]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    // Capture phase: runs before the Sheet tools menu's own handler, while the menu is still marked open,
    // so an Escape meant for an open menu (even with focus on its trigger) closes only the menu.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!shouldSheetCloseOnEscape(e)) return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', handleKeyDown, true);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, onClose]);

  if (!isOpen || !session) return null;

  const isEvaluated = Boolean(existingEntry && isRatingComplete(existingEntry.ratings));

  const handleScoreChange = (dimension: FeedbackRatingDimension, score: LikertScore) => {
    setRatings((prev) => ({ ...prev, [dimension]: score }));
    if (validationError) setValidationError(null);
  };

  const handleSyncToSheets = async (entryToSync?: FeedbackEntry) => {
    const targetEntry = entryToSync || existingEntry;
    if (!targetEntry && !isRatingComplete(ratings)) {
      setValidationError('Rate all 6 dimensions before syncing.');
      return;
    }

    const payloadEntry: FeedbackEntry =
      targetEntry ?? {
        id: `fb-${session.id}`,
        sessionId: session.id,
        sessionTitle: session.title,
        pic: session.pic,
        date: date.trim() || formatFeedbackDate(new Date()),
        ratings: {
          communication: ratings.communication!,
          alignment: ratings.alignment!,
          understanding: ratings.understanding!,
          readiness: ratings.readiness!,
          pace: ratings.pace!,
          overall: ratings.overall!,
        },
        hasQuestions,
        questionExplanation: questionExplanation.trim() || undefined,
        questionAddressing: questionAddressing.trim() || undefined,
        suggestions: suggestions.trim() || undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

    setSyncing(true);
    setSyncMessage(null);
    setSyncError(null);
    setNeedsAuth(false);

    try {
      const res = await fetch('/api/sheets/update-cell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheet: 'Feedback Sheet',
          rowNumber: session.rowNumber,
          feedback: payloadEntry,
        }),
      });

      const data = await res.json().catch(() => null);

      if (res.status === 401 || data?.authenticated === false) {
        setNeedsAuth(true);
        setSyncError(
          'Your evaluation is saved here. Sign in with Google to sync it to the sheet, or copy it from Sheet tools instead.'
        );
      } else if (res.ok && data?.success) {
        markSynced(safeLocalStorage());
        notifySyncChanged();
        setSyncMessage('Synced to the sheet.');
      } else {
        setSyncError(
          `${data?.error || data?.message || "Couldn't sync this evaluation."} Your evaluation is saved here; you can copy it from Sheet tools instead.`
        );
      }
    } catch {
      setSyncError("Couldn't reach the server to sync. Your evaluation is saved here; you can copy it from Sheet tools instead.");
    } finally {
      setSyncing(false);
    }
  };

  const handleSave = () => {
    if (!isRatingComplete(ratings)) {
      setValidationError('Rate all 6 dimensions (1 to 6) before saving.');
      return;
    }

    const entry: FeedbackEntry = {
      id: existingEntry?.id ?? `fb-${session.id}`,
      sessionId: session.id,
      sessionTitle: session.title,
      pic: session.pic,
      date: date.trim() || formatFeedbackDate(new Date()),
      ratings: {
        communication: ratings.communication!,
        alignment: ratings.alignment!,
        understanding: ratings.understanding!,
        readiness: ratings.readiness!,
        pace: ratings.pace!,
        overall: ratings.overall!,
      },
      hasQuestions,
      questionExplanation: questionExplanation.trim() || undefined,
      questionAddressing: questionAddressing.trim() || undefined,
      suggestions: suggestions.trim() || undefined,
      createdAt: existingEntry?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    onSave(entry);
    setIsEditing(false);
    void handleSyncToSheets(entry);
  };

  const averageScore = isEvaluated
    ? (
        (existingEntry!.ratings.communication +
          existingEntry!.ratings.alignment +
          existingEntry!.ratings.understanding +
          existingEntry!.ratings.readiness +
          existingEntry!.ratings.pace +
          existingEntry!.ratings.overall) /
        6
      ).toFixed(1)
    : null;

  const sheetItems: SheetToolsMenuItem[] = isEvaluated
    ? [
        {
          id: 'sync-session',
          label: 'Sync this evaluation to the sheet',
          hint: `Writes columns A–M of row ${session.rowNumber}`,
          onSelect: () => handleSyncToSheets(),
          state: syncing ? 'busy' : 'idle',
        },
        ...(onCopyRow
          ? [
              {
                id: 'copy-session',
                label: 'Copy for the sheet',
                hint: `Columns A–M · paste at A${session.rowNumber}`,
                onSelect: () => onCopyRow(existingEntry!),
                state: isCopied ? ('done' as const) : ('idle' as const),
                doneLabel: 'Copied',
              },
            ]
          : []),
      ]
    : [];

  const iconButton =
    'inline-flex size-11 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 disabled:opacity-30 sm:size-9';
  const sectionTitle = 'text-[11px] font-semibold uppercase tracking-wider text-stone-500';
  const fieldLabel = 'block text-[11px] font-semibold uppercase tracking-wider text-stone-600';
  const primaryButton =
    'inline-flex min-h-11 items-center gap-1.5 rounded-full bg-stone-900 px-5 text-xs font-semibold text-white shadow-xs transition hover:bg-stone-800 active:scale-95 disabled:opacity-60 sm:min-h-9';
  const secondaryButton =
    'inline-flex min-h-11 items-center rounded-full border border-stone-200 bg-white px-4 text-xs font-semibold text-stone-700 transition hover:bg-stone-100 active:scale-95 sm:min-h-9';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-detail-sheet-title"
      className="fixed inset-0 z-50 overflow-hidden"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-stone-900/40 backdrop-blur-xs transition-opacity duration-300"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer Container */}
      <div className="fixed inset-y-0 right-0 flex max-w-full pl-0 sm:pl-10 pointer-events-none">
        <div
          className="pointer-events-auto flex w-screen flex-col bg-white shadow-lift
            max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:max-h-[92vh] max-sm:rounded-t-3xl
            sm:max-w-xl sm:h-full sm:rounded-l-3xl animate-fade-in"
        >
          {/* Mobile Handle Indicator */}
          <div className="mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-stone-200 sm:hidden" />

          {/* Header */}
          <div className="flex shrink-0 items-start justify-between gap-2 border-b border-stone-100 p-5 sm:p-6">
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <RowTag rowNumber={session.rowNumber} />
                {session.department && (
                  <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-600">
                    {session.department}
                  </span>
                )}
                {isEvaluated ? (
                  <span className="rounded-full border border-mint-200 bg-mint-50 px-2 py-0.5 text-xs font-semibold text-mint-800">
                    Evaluated · Avg {averageScore}/6
                  </span>
                ) : (
                  <span className="rounded-full border border-peach-200 bg-peach-50 px-2 py-0.5 text-xs font-semibold text-peach-800">
                    Not evaluated yet
                  </span>
                )}
              </div>
              <h2
                id="feedback-detail-sheet-title"
                className="text-lg font-semibold text-stone-900 sm:text-xl leading-snug"
              >
                {session.title}
              </h2>
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
                <span className="flex min-w-0 items-center gap-1">
                  <IconUser className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                  Led by <strong className="truncate text-stone-700">{session.pic}</strong>
                </span>
                {existingEntry?.date && (
                  <span className="flex items-center gap-1">
                    <IconCalendar className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                    Evaluated on <strong className="text-stone-700">{existingEntry.date}</strong>
                  </span>
                )}
              </div>
            </div>

            {/* Prev / Next & Close */}
            <div className="flex items-center gap-1 shrink-0">
              {onPrevSession && (
                <button
                  type="button"
                  disabled={!hasPrev}
                  onClick={onPrevSession}
                  className={iconButton}
                  title="Previous session"
                  aria-label="Previous session"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              )}
              {onNextSession && (
                <button
                  type="button"
                  disabled={!hasNext}
                  onClick={onNextSession}
                  className={iconButton}
                  title="Next session"
                  aria-label="Next session"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              )}
              <button ref={closeRef} type="button" onClick={onClose} className={iconButton} aria-label="Close">
                <IconX className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Body */}
          {/* Focusable so keyboard users can scroll it even when it holds no controls (view mode). */}
          <div
            role="region"
            aria-label="Evaluation details"
            tabIndex={0}
            className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6 space-y-6 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-stone-900"
          >
            {/* Sync Status Banners */}
            {syncMessage && (
              <div role="status" className="flex items-center gap-2 rounded-xl border border-mint-200 bg-mint-50 p-3 text-xs font-medium text-mint-900 animate-fade-in">
                <IconCheck className="h-4 w-4 shrink-0 text-mint-700" />
                <span>{syncMessage}</span>
              </div>
            )}
            {syncError && (
              <div role="alert" className="space-y-2 rounded-xl border border-peach-200 bg-peach-50 p-3 text-xs font-medium text-peach-900 animate-fade-in">
                <p>{syncError}</p>
                {needsAuth && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <a
                      href="/api/auth/login"
                      className="inline-flex min-h-11 items-center gap-1 rounded-full bg-stone-900 px-4 text-xs font-semibold text-white transition hover:bg-stone-800 sm:min-h-9"
                    >
                      Sign in with Google
                    </a>
                    <a
                      href="/settings"
                      className="inline-flex min-h-11 items-center px-2 text-xs font-medium text-stone-700 underline hover:text-stone-900 sm:min-h-9"
                    >
                      Open Settings
                    </a>
                  </div>
                )}
              </div>
            )}
            {!isEditing && existingEntry ? (
              /* VIEW MODE */
              <>
                {/* 6 Dimensions Breakdown */}
                <section className="rounded-2xl border border-stone-100 bg-white p-4 shadow-2xs space-y-3">
                  <div className="flex items-center justify-between gap-2 border-b border-stone-100 pb-2.5">
                    <h3 className={sectionTitle}>Ratings</h3>
                    <span className="rounded-md bg-mint-50 px-2 py-0.5 text-xs font-bold text-mint-800">
                      Score: {averageScore} / 6.0
                    </span>
                  </div>

                  <div className="space-y-3">
                    {FEEDBACK_DIMENSIONS.map((dim) => {
                      const score = existingEntry.ratings[dim.key] as LikertScore;
                      const opt = LIKERT_OPTIONS.find((o) => o.score === score);
                      const pct = ((score || 0) / 6) * 100;

                      return (
                        <div key={dim.key} className="space-y-1">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="min-w-0 font-medium text-stone-700">{dim.shortLabel}</span>
                            <span className="shrink-0 font-bold text-stone-900">
                              {score}/6 · <span className="font-normal text-stone-500">{opt?.short}</span>
                            </span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-stone-100" aria-hidden="true">
                            <div
                              className="h-full rounded-full bg-mint-500 transition-all duration-300"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* Questions & suggestions */}
                <section className="space-y-3">
                  <h3 className={sectionTitle}>Questions and suggestions</h3>

                  <div className="rounded-2xl border border-stone-100 bg-stone-50/70 p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-stone-600">Questions about the topic</span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          existingEntry.hasQuestions ? 'bg-peach-100 text-peach-800' : 'bg-mint-100 text-mint-800'
                        }`}
                      >
                        {existingEntry.hasQuestions ? 'Yes · Had questions' : 'No · All clear'}
                      </span>
                    </div>

                    {existingEntry.questionExplanation ? (
                      <div>
                        <span className="mb-1 block text-xs font-medium text-stone-500">Explanation</span>
                        <p className="whitespace-pre-wrap rounded-xl border border-stone-100 bg-white p-3 text-xs text-stone-800">
                          {existingEntry.questionExplanation}
                        </p>
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-2xl border border-stone-100 bg-stone-50/70 p-4 space-y-1.5">
                    <span className="block text-xs font-semibold text-stone-600">How you’d like questions answered</span>
                    {(() => {
                      const val = normalizeQuestionAddressing(existingEntry.questionAddressing);
                      const match = ADDRESSING_CHOICES.find((c) => c.value === val);
                      return match ? (
                        <span
                          className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${match.badgeBg} ${match.badgeText} ${match.badgeBorder}`}
                        >
                          {match.label}
                        </span>
                      ) : (
                        <span className="text-xs text-stone-600">{val || '—'}</span>
                      );
                    })()}
                  </div>

                  {existingEntry.suggestions && (
                    <div className="rounded-2xl border border-stone-100 bg-stone-50/70 p-4">
                      <span className="mb-1 block text-xs font-semibold text-stone-600">Suggestions for improvement</span>
                      <p className="whitespace-pre-wrap text-xs text-stone-800">{existingEntry.suggestions}</p>
                    </div>
                  )}
                </section>
              </>
            ) : (
              /* EDIT MODE */
              <div className="space-y-6">
                {validationError && (
                  <div role="alert" className="rounded-xl border border-peach-200 bg-peach-50 p-3 text-xs font-medium text-peach-900">
                    {validationError}
                  </div>
                )}

                {/* Evaluation Date */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor={dateId} className={fieldLabel}>
                    Evaluation date
                  </label>
                  <input
                    id={dateId}
                    type="text"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    placeholder="DD/MM/YYYY"
                    className="min-h-11 rounded-xl border border-stone-200 bg-stone-50 px-3 text-xs text-stone-800 placeholder:text-stone-500 focus:border-stone-900 focus:bg-white focus:outline-none sm:min-h-9"
                  />
                </div>

                {/* Rating dimensions */}
                <section aria-labelledby={ratingsHeadingId} className="space-y-4">
                  <h3 id={ratingsHeadingId} className={`border-b border-stone-100 pb-2 ${sectionTitle}`}>
                    Rate each dimension (1 to 6)
                  </h3>

                  {FEEDBACK_DIMENSIONS.map((dim) => {
                    const currentScore = ratings[dim.key];
                    const dimLabelId = `${ratingsHeadingId}-${dim.key}`;
                    return (
                      <div
                        key={dim.key}
                        role="group"
                        aria-labelledby={dimLabelId}
                        className="rounded-2xl border border-stone-100 bg-stone-50/50 p-3.5 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span id={dimLabelId} className="min-w-0 text-xs font-semibold text-stone-800">
                            {dim.shortLabel}
                          </span>
                          <span className="shrink-0 text-xs font-bold text-mint-800">
                            {currentScore ? `${currentScore} / 6` : 'Not rated'}
                          </span>
                        </div>
                        <p className="text-xs text-stone-600">{dim.statement}</p>

                        <div className="grid grid-cols-3 gap-1.5 pt-1 sm:grid-cols-6">
                          {LIKERT_OPTIONS.map((opt) => {
                            const isSelected = currentScore === opt.score;
                            return (
                              <button
                                key={opt.score}
                                type="button"
                                aria-pressed={isSelected}
                                aria-label={`${opt.score}, ${opt.short}`}
                                onClick={() => handleScoreChange(dim.key, opt.score)}
                                className={`flex min-h-11 min-w-0 flex-col items-center justify-center rounded-xl px-1 py-1 text-center transition ${
                                  isSelected
                                    ? 'bg-stone-900 font-bold text-white shadow-xs'
                                    : 'border border-stone-200 bg-white text-stone-700 hover:bg-stone-100'
                                }`}
                              >
                                <span className="text-xs">{opt.score}</span>
                                <span className="max-w-full truncate text-xs">{opt.short}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </section>

                {/* Q1: Do you have questions? */}
                <div role="group" aria-labelledby={questionsLabelId} className="space-y-2">
                  <span id={questionsLabelId} className={fieldLabel}>
                    Do you have any questions about today&apos;s topic?
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      aria-pressed={!hasQuestions}
                      onClick={() => {
                        setHasQuestions(false);
                        setQuestionAddressing("I don't have any questions today");
                      }}
                      className={`min-h-11 flex-1 rounded-xl border p-2.5 text-xs font-semibold transition ${
                        !hasQuestions
                          ? 'border-mint-500 bg-mint-50 text-mint-900 shadow-2xs'
                          : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'
                      }`}
                    >
                      No · Everything clear
                    </button>
                    <button
                      type="button"
                      aria-pressed={hasQuestions}
                      onClick={() => {
                        setHasQuestions(true);
                        setQuestionAddressing('Chat response is fine');
                      }}
                      className={`inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border p-2.5 text-xs font-semibold transition ${
                        hasQuestions
                          ? 'border-peach-500 bg-peach-50 text-peach-900 shadow-2xs'
                          : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'
                      }`}
                    >
                      <IconLightbulb className="h-3.5 w-3.5 text-peach-700" />
                      <span>Yes · I have questions</span>
                    </button>
                  </div>
                </div>

                {/* Q2: Explanation */}
                <div>
                  <label htmlFor={explanationId} className={`${fieldLabel} mb-1`}>
                    Explain your answer or questions
                  </label>
                  <textarea
                    id={explanationId}
                    rows={2}
                    value={questionExplanation}
                    onChange={(e) => setQuestionExplanation(e.target.value)}
                    placeholder="Details or questions about the session…"
                    className="w-full rounded-xl border border-stone-200 bg-white p-3 text-xs text-stone-800 placeholder:text-stone-500 focus:border-stone-900 focus:outline-none"
                  />
                </div>

                {/* Q3: Question Addressing */}
                <div role="group" aria-labelledby={addressingLabelId} className="space-y-2">
                  <span id={addressingLabelId} className={fieldLabel}>
                    How would you like your question answered?
                  </span>
                  <div className="flex flex-col gap-2">
                    {ADDRESSING_CHOICES.map((choice) => {
                      const isSelected = questionAddressing === choice.value;
                      return (
                        <button
                          key={choice.value}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => setQuestionAddressing(choice.value)}
                          className={`flex min-h-11 items-center justify-between rounded-xl border p-2.5 text-left text-xs transition ${
                            isSelected
                              ? `${choice.badgeBg} ${choice.badgeBorder} ${choice.badgeText} font-semibold ring-1 ring-stone-900`
                              : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-50'
                          }`}
                        >
                          <span>{choice.label}</span>
                          {isSelected && <IconCheck className="h-4 w-4 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Q4: Suggestions */}
                <div>
                  <label htmlFor={suggestionsId} className={`${fieldLabel} mb-1`}>
                    Suggestions for improvement
                  </label>
                  <textarea
                    id={suggestionsId}
                    rows={2}
                    value={suggestions}
                    onChange={(e) => setSuggestions(e.target.value)}
                    placeholder="Suggestions for future sessions or topics…"
                    className="w-full rounded-xl border border-stone-200 bg-white p-3 text-xs text-stone-800 placeholder:text-stone-500 focus:border-stone-900 focus:outline-none"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Sticky Bottom Actions */}
          <div className="shrink-0 border-t border-stone-100 bg-stone-50/90 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {!isEditing ? (
                <>
                  {sheetItems.length > 0 ? (
                    <SheetToolsMenu items={sheetItems} placement="up" align="start" className="mr-auto" />
                  ) : (
                    <span className="mr-auto" />
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={onClose}
                      className="inline-flex min-h-11 items-center rounded-full px-3 text-xs font-medium text-stone-600 transition hover:text-stone-900 sm:min-h-9"
                    >
                      Close
                    </button>
                    <button type="button" onClick={() => setIsEditing(true)} className={primaryButton}>
                      <IconEdit className="h-3.5 w-3.5" />
                      <span>{isEvaluated ? 'Edit evaluation' : 'Fill in evaluation'}</span>
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      if (existingEntry) {
                        setIsEditing(false);
                      } else {
                        onClose();
                      }
                    }}
                    className={secondaryButton}
                  >
                    Cancel
                  </button>

                  <button type="button" disabled={syncing} onClick={handleSave} className={primaryButton}>
                    <IconCheck className="h-4 w-4" />
                    <span>{syncing ? 'Saving…' : 'Save Evaluation'}</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
