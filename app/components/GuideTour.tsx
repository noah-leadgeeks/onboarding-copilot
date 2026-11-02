'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { clampStep } from '@/lib/guide-tour';
import { OFFICIAL_SCHEDULE_ACTIVITIES } from '@/lib/schedule-catalog';

export type GuideTourStep = {
  /** Optional route to navigate to for this step */
  route?: string;
  /** `data-tour` attribute value of the highlight target. Omit for a centered step. */
  target?: string;
  /** Primary category badge (e.g. "Diary Feature", "Daily Execution", etc.) */
  badge?: string;
  title: string;
  body: string;
  /** Actionable, numbered step-by-step instructions */
  steps?: readonly string[];
  /** Helpful tip or reminder */
  proTip?: string;
};

export const allPagesTourSteps: readonly GuideTourStep[] = [
  {
    route: '/',
    badge: 'Welcome to NOVA',
    title: 'Your onboarding cockpit',
    body: 'Starting a new role involves lots of activities, documents and check-ins. NOVA is your personal companion designed to keep your first 90 days calm, organized, and clear — with zero guesswork. Let’s explore how to use the core feature on every page!',
    proTip: '💡 This tour will navigate through each page and show you how to take action step-by-step.',
  },
  {
    route: '/',
    target: 'current-activity',
    badge: 'Today · Daily Execution',
    title: 'How to track your daily work',
    body: 'Your day is focused on one activity at a time. You never need to calculate hours or guess what to do next.',
    steps: [
      'Check your current task: The card shows your scheduled topic, who leads it, and the planned duration.',
      'Click "Start Stopwatch": Press it when you begin. NOVA records your exact start time automatically.',
      'Click "Finish & Stop": When you are done, NOVA calculates your duration. Then choose "Write Diary Reflection" to capture a quick note.',
    ],
    proTip: '💡 Stepping away for a break? Hit "Pause Stopwatch" anytime to pause the timer without losing your progress.',
  },
  {
    route: '/schedule',
    target: 'schedule-toolbar',
    badge: 'Schedule · 90-Day Plan',
    title: 'How to explore & check off sessions',
    body: `Explore all ${OFFICIAL_SCHEDULE_ACTIVITIES.length} onboarding activities planned across Weeks 1–10 and Months 2 & 3 in one master calendar.`,
    steps: [
      'Filter by Week: Click tabs like "Week 1", "Week 2", or "Today" to see scheduled sessions.',
      'Search topics or trainers: Type any topic, mentor name, or session number to find activities instantly.',
      'Click any activity card: Open the side drawer to see detailed subtopics, syllabus outlines, or update your progress.',
    ],
    proTip: "💡 Open any activity's Sheet tools to copy or sync its row.",
  },
  {
    route: '/timeline',
    target: 'timeline-stage-cards',
    badge: 'Timeline · Milestones',
    title: 'How to track 30-60-90 day deliverables',
    body: 'Your 90-day journey is divided into 3 clear phases: Stage 1 (Training), Stage 2 (Trial), and Stage 3 (Transition).',
    steps: [
      'View phase deliverables: Click any stage card to view required presentations, trial assignments, and HR evidence.',
      'Check off completed items: Tick off deliverables as you finish them to advance your stage progress toward 100%.',
      'Track stage dates: Set and review your planned start and completion dates to stay on schedule with HR.',
    ],
    proTip: '💡 Open "Sheet tools" at the top and choose "Copy for spreadsheet" to copy all stage dates and checklists in one go.',
  },
  {
    route: '/reviews',
    target: 'reviews-cards-grid',
    badge: 'Reviews · Manager 1-on-1s',
    title: 'How to prepare for manager check-ins',
    body: 'At the end of Month 1, Month 2, and Month 3, you will have a formal check-in conversation with your manager.',
    steps: [
      'Open your upcoming review: Click Month 1, Month 2, or Month 3 to view your review agenda. First month and Monthly score live in the tabs at the top of Reviews.',
      'Write your self-reflection: Fill in your achievements, challenges faced, and goals for the next month.',
      'Align during your meeting: Walk through company core values (HARPS) and technical rubric together with your manager.',
    ],
    proTip: '💡 Draft your reflections a few days before your review meeting so you feel confident and prepared.',
  },
  {
    route: '/diary',
    target: 'diary-topics-list',
    badge: 'Diary · Learning Notes',
    title: 'How to write your daily notes',
    body: 'The HR workbook requires you to document learnings across 28 syllabus topics. NOVA makes recording them fast and effortless.',
    steps: [
      'Pick today’s session: Find your topic in the list and click "Write notes".',
      'Write 3 things you learned: Jot down 3 concise takeaways from the session. Click "Suggest ideas" if you need inspiration!',
      'Add your notes: Note down your reflections, questions, or ideas for your mentor.',
      'Save: Click "Save notes" to keep them safely on your device.',
    ],
    proTip: '💡 Sheet tools on any topic lets you copy it for the spreadsheet.',
  },
  {
    route: '/feedback',
    target: 'feedback-sessions-list',
    badge: 'Feedback · Weekly Reflections',
    title: 'How to rate onboarding sessions',
    body: 'Your feedback helps your mentor and HR team ensure you have all the support and resources you need.',
    steps: [
      'Select an onboarding session: Click any session you attended this week to open its rating panel.',
      'Rate on a 1-to-6 scale: Score key dimensions like topic clarity, material quality, and mentor support.',
      'Share questions & comments: Type any questions or suggestions so your team can help immediately.',
    ],
    proTip: '💡 Use Sheet tools to send your evaluation to the spreadsheet, or copy it to paste yourself.',
  },
  {
    route: '/glossary',
    target: 'glossary-tabs-container',
    badge: 'Glossary · Training Library',
    title: 'How to find training videos & guides',
    body: 'Never waste time hunting through email threads or chat messages for training links and company guides.',
    steps: [
      'Search by keyword: Type any topic, system name, or term to instantly find matching materials.',
      'Filter by format: Switch between All, Video recordings, and Online Meeting links.',
      'Direct links: Click any module card to view syllabus objectives and open documents or slides directly.',
    ],
    proTip: '💡 Check the "Workbook Guide" tab to understand exactly what each tab in the company spreadsheet is for.',
  },
  {
    route: '/settings',
    target: 'settings-connection-card',
    badge: 'Settings · Data & Sync',
    title: 'How data backup & Google Sheets sync work',
    body: 'NOVA is built local-first so your work is always preserved, even if you lose your internet connection.',
    steps: [
      'Automatic local saving: All timers, notes, and feedback save instantly in your browser.',
      'Connect Google: Sign in with Google whenever you want your work kept in step with the company spreadsheet.',
      'Copy-paste fallback: Every page has a Sheet tools menu with copy-paste fallbacks formatted for the company workbook.',
    ],
    proTip: '💡 You can restart this guide tour anytime from this page or from the sidebar footer.',
  },
  {
    target: 'assistant-launcher',
    badge: 'Ask NOVA · AI Assistant',
    title: 'How to ask NOVA for help anytime',
    body: 'Have questions about who to contact, company policies, or what’s on your schedule today?',
    steps: [
      'Click the floating sparkle ✨ button: Located in the bottom right corner of every screen.',
      'Ask in plain English: Ask questions like "What’s my schedule today?" or "Who is my mentor for Week 2?".',
      'Instant answers: NOVA knows your syllabus, schedule, and company guides to give you helpful answers immediately.',
    ],
    proTip: '💡 Press the Escape key anytime to quickly close the assistant chat.',
  },
  {
    route: '/',
    badge: 'You’re All Set!',
    title: 'Ready to start your journey!',
    body: 'You now know how to use every core feature in NOVA. Move at your own pace, take things one task at a time, and remember: NOVA handles the tracking so you can focus on learning.',
    proTip: '💡 If you ever want a refresher, click "🧭 Quick Guide Tour" in the sidebar or press ⌘K.',
  },
];

/** Maintained for backwards compatibility */
export const todayTourSteps: readonly GuideTourStep[] = allPagesTourSteps;

// Self-contained styles so the tour renders identically regardless of the
// Tailwind pipeline state.
const guideTourCss = `
.guide-tour-shield { position: fixed; inset: 0; z-index: 40; }
.guide-tour-shield--dim { background: rgb(28 25 23 / 0.45); animation: guide-fade 0.25s ease both; }
.guide-tour-spotlight { position: fixed; z-index: 41; pointer-events: none; border: 2px solid #23ae77; border-radius: 16px; box-shadow: 0 0 0 9999px rgb(28 25 23 / 0.45); animation: guide-fade 0.25s ease both; }
.guide-tour-popover { position: fixed; z-index: 50; width: min(30rem, calc(100vw - 2rem)); max-height: calc(100vh - 2rem); overflow-y: auto; background: #ffffff; border: 1px solid #e7e5e4; border-radius: 20px; padding: 22px 24px; box-shadow: 0 16px 40px rgb(87 70 31 / 0.14); font-family: inherit; animation: guide-pop-in 0.32s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
.guide-tour-popover--centered { left: 50%; top: 50%; transform: translate(-50%, -50%); animation-name: guide-pop-center; }
.guide-tour-top-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.guide-tour-badge { display: inline-block; padding: 3px 9px; border-radius: 9999px; background: #ecfdf5; color: #047857; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
.guide-tour-step-label { margin: 0; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; color: #78716c; }
.guide-tour-title { margin: 4px 0 0; font-size: 19px; line-height: 1.25; font-weight: 700; color: #1c1917; }
.guide-tour-body { margin: 8px 0 0; font-size: 13.5px; line-height: 1.5; color: #57534e; }
.guide-tour-steps-list { margin: 12px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
.guide-tour-steps-item { display: flex; align-items: flex-start; gap: 10px; font-size: 13px; line-height: 1.45; color: #292524; background: #fafaf7; border: 1px solid #f5f5f4; border-radius: 12px; padding: 8px 10px; }
.guide-tour-step-num { flex-shrink: 0; width: 20px; height: 20px; border-radius: 9999px; background: #1c1917; color: #ffffff; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; margin-top: 1px; }
.guide-tour-protip { margin-top: 12px; padding: 8px 12px; border-radius: 12px; background: #fefce8; border: 1px solid #fef08a; font-size: 12px; color: #854d0e; line-height: 1.45; }
.guide-tour-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-top: 20px; }
.guide-tour-dots { display: flex; align-items: center; gap: 6px; }
.guide-tour-dot { width: 6px; height: 6px; border-radius: 9999px; background: #d6d3d1; transition: width 0.2s ease, background-color 0.2s ease; }
.guide-tour-dot--active { width: 16px; background: #23ae77; }
.guide-tour-actions { display: flex; align-items: center; gap: 8px; }
.guide-tour-button { min-height: 44px; border-radius: 12px; padding: 8px 16px; font-size: 14px; font-weight: 500; cursor: pointer; }
.guide-tour-button--back { background: #ffffff; border: 1px solid #e7e5e4; color: #57534e; }
.guide-tour-button--back:hover { background: #fafaf7; }
.guide-tour-button--skip { background: none; border: none; color: #78716c; text-decoration: underline; text-underline-offset: 4px; padding: 8px 12px; }
.guide-tour-button--skip:hover { color: #1c1917; }
.guide-tour-button--primary { background: #1c1917; border: 1px solid #1c1917; color: #ffffff; font-weight: 600; padding: 8px 20px; }
.guide-tour-button--primary:hover { background: #292524; }
.guide-tour-button:focus-visible { outline: 2px solid #23ae77; outline-offset: 2px; }
@keyframes guide-fade { from { opacity: 0; } }
@keyframes guide-pop-in { from { opacity: 0; transform: translateY(10px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes guide-pop-center { from { opacity: 0; transform: translate(-50%, calc(-50% + 10px)) scale(0.97); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
`;

const VIEWPORT_MARGIN = 16;
const POPOVER_GAP = 12;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

type Rect = { top: number; left: number; width: number; height: number };

export function GuideTour({
  steps,
  open,
  currentRoute,
  onNavigate,
  onFinish,
}: {
  steps: readonly GuideTourStep[];
  open: boolean;
  currentRoute?: string;
  onNavigate?: (route: string) => void;
  onFinish: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [spotlight, setSpotlight] = useState<Rect | null>(null);
  const [popoverTop, setPopoverTop] = useState<number | null>(null);
  const [popoverLeft, setPopoverLeft] = useState<number | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const step = steps[index];
  const isFirst = index === 0;
  const isLast = index === steps.length - 1;
  const centered = !step?.target;

  const goToStep = useCallback(
    (nextIdx: number) => {
      const clamped = clampStep(nextIdx, steps.length);
      setIndex(clamped);
      const targetStep = steps[clamped];
      if (targetStep?.route && onNavigate && currentRoute !== targetStep.route) {
        onNavigate(targetStep.route);
      }
    },
    [steps, onNavigate, currentRoute]
  );

  const next = useCallback(() => goToStep(index + 1), [goToStep, index]);
  const back = useCallback(() => goToStep(index - 1), [goToStep, index]);
  const finish = useCallback(() => {
    setIndex(0);
    onFinish();
  }, [onFinish]);

  const updatePosition = useCallback(() => {
    if (!step || centered) {
      setSpotlight(null);
      setPopoverTop(null);
      setPopoverLeft(null);
      return;
    }
    const element = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    if (!element || (element.offsetWidth === 0 && element.offsetHeight === 0)) {
      // Target not rendered or hidden (e.g. mobile hidden sidebar): fall back to a centered step.
      setSpotlight(null);
      setPopoverTop(null);
      setPopoverLeft(null);
      return;
    }
    const rect = element.getBoundingClientRect();
    setSpotlight({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    const popover = popoverRef.current;
    const popoverWidth = popover?.offsetWidth ?? 440;
    const popoverHeight = popover?.offsetHeight ?? 280;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    let top: number;
    let left: number;

    // If target is docked on the left (e.g. sidebar nav) and element is narrow, position alongside it
    if (rect.right + popoverWidth + POPOVER_GAP + VIEWPORT_MARGIN <= viewportWidth && rect.left < 320 && rect.width < 320) {
      left = rect.right + POPOVER_GAP;
      top = clamp(
        rect.top + rect.height / 2 - popoverHeight / 2,
        VIEWPORT_MARGIN,
        Math.max(VIEWPORT_MARGIN, viewportHeight - popoverHeight - VIEWPORT_MARGIN)
      );
    } else if (rect.bottom + popoverHeight + POPOVER_GAP + VIEWPORT_MARGIN <= viewportHeight) {
      top = rect.bottom + POPOVER_GAP;
      left = clamp(rect.left + rect.width / 2 - popoverWidth / 2, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewportWidth - popoverWidth - VIEWPORT_MARGIN));
    } else if (rect.top - popoverHeight - POPOVER_GAP - VIEWPORT_MARGIN >= 0) {
      top = rect.top - popoverHeight - POPOVER_GAP;
      left = clamp(rect.left + rect.width / 2 - popoverWidth / 2, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewportWidth - popoverWidth - VIEWPORT_MARGIN));
    } else {
      top = clamp((viewportHeight - popoverHeight) / 2, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewportHeight - popoverHeight - VIEWPORT_MARGIN));
      left = clamp(rect.left + rect.width / 2 - popoverWidth / 2, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewportWidth - popoverWidth - VIEWPORT_MARGIN));
    }
    setPopoverTop(top);
    setPopoverLeft(left);
  }, [step, centered]);

  useLayoutEffect(() => {
    updatePosition();
  }, [updatePosition, index]);

  // Bring the highlighted element into view whenever the step changes.
  useEffect(() => {
    if (!step || centered) return;
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    if (el && (el.offsetWidth > 0 || el.offsetHeight > 0)) {
      el.scrollIntoView({
        block: 'center',
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      });
    }
  }, [index, step, centered]);

  // Track route transitions or DOM changes so the spotlight follows its target.
  useEffect(() => {
    if (!open) return;
    // A page may scroll itself after the tour first brought the target into view (e.g. jumping to
    // the next activity), so re-check shortly after and again once that scroll has settled.
    const reveal = () => {
      updatePosition();
      if (!step || centered) return;
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      if (!el || (el.offsetWidth === 0 && el.offsetHeight === 0)) return;
      const rect = el.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        el.scrollIntoView({ block: 'center', behavior: 'auto' });
      }
    };
    const timers = [setTimeout(reveal, 120), setTimeout(reveal, 900)];
    return () => timers.forEach(clearTimeout);
  }, [open, index, currentRoute, updatePosition, step, centered]);

  // Track viewport changes so the spotlight follows its target.
  useEffect(() => {
    if (!open) return;
    const onViewportChange = () => updatePosition();
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [open, updatePosition]);

  // Keyboard navigation: Escape closes, arrows move, Tab stays inside the popover.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish();
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        next();
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        back();
        return;
      }
      if (event.key === 'Tab' && popoverRef.current) {
        const focusable = Array.from(popoverRef.current.querySelectorAll<HTMLButtonElement>('button'));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, next, back, finish]);

  // Always begin at the first step when the tour opens.
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  // Move focus to the primary action for keyboard users on every step.
  useEffect(() => {
    if (open) popoverRef.current?.querySelector<HTMLButtonElement>('[data-tour-primary]')?.focus();
  }, [open, index]);

  if (!open || !step) return null;

  const titleId = 'guide-tour-title';
  const centeredRender = centered || !spotlight || popoverTop === null || popoverLeft === null;

  return (
    <>
      <style>{guideTourCss}</style>
      {/* Interaction shield: keeps the page still while the tour is open. */}
      <div className={`guide-tour-shield${centeredRender ? ' guide-tour-shield--dim' : ''}`} aria-hidden="true" />
      {/* Spotlight: dims everything except the highlighted element. */}
      {spotlight && (
        <div
          aria-hidden="true"
          className="guide-tour-spotlight"
          style={{
            top: spotlight.top - 6,
            left: spotlight.left - 6,
            width: spotlight.width + 12,
            height: spotlight.height + 12,
          }}
        />
      )}
      <div
        key={index}
        ref={popoverRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-label={`Guide tour, step ${index + 1} of ${steps.length}`}
        className={`guide-tour-popover${centeredRender ? ' guide-tour-popover--centered' : ''}`}
        style={centeredRender ? undefined : { top: popoverTop ?? undefined, left: popoverLeft ?? undefined }}
      >
        <div className="guide-tour-top-bar">
          {step.badge ? (
            <span className="guide-tour-badge">{step.badge}</span>
          ) : (
            <span />
          )}
          <p className="guide-tour-step-label">
            Step {index + 1} of {steps.length}
          </p>
        </div>

        <h2 id={titleId} className="guide-tour-title">
          {step.title}
        </h2>
        <p className="guide-tour-body">{step.body}</p>

        {step.steps && step.steps.length > 0 && (
          <ol className="guide-tour-steps-list">
            {step.steps.map((st, i) => (
              <li key={i} className="guide-tour-steps-item">
                <span className="guide-tour-step-num">{i + 1}</span>
                <span>{st}</span>
              </li>
            ))}
          </ol>
        )}

        {step.proTip && (
          <div className="guide-tour-protip">
            <span>{step.proTip}</span>
          </div>
        )}

        <div className="guide-tour-footer">
          <div className="guide-tour-dots" aria-hidden="true">
            {steps.map((_, dot) => (
              <span key={dot} className={dot === index ? 'guide-tour-dot guide-tour-dot--active' : 'guide-tour-dot'} />
            ))}
          </div>
          <div className="guide-tour-actions">
            {!isFirst && (
              <button type="button" onClick={back} className="guide-tour-button guide-tour-button--back">
                Back
              </button>
            )}
            {!isLast && (
              <button type="button" onClick={finish} className="guide-tour-button guide-tour-button--skip">
                Skip
              </button>
            )}
            {isLast ? (
              <button type="button" data-tour-primary onClick={finish} className="guide-tour-button guide-tour-button--primary">
                Get started
              </button>
            ) : (
              <button type="button" data-tour-primary onClick={next} className="guide-tour-button guide-tour-button--primary">
                {isFirst ? 'Show me around' : 'Next'}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
