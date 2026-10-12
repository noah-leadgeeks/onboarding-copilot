import { NextResponse } from 'next/server';
import { db, schema, isDbConfigured } from '@/lib/db';
import { asc, eq } from 'drizzle-orm';
import { FEEDBACK_SESSIONS, type FeedbackEntry, type FeedbackRatings } from '@/lib/feedback';
import { feedbackEntryFromRow } from '@/lib/feedback-db';

export async function GET() {
  if (isDbConfigured()) {
    try {
      const [sessions, entries] = await Promise.all([
        db.select().from(schema.feedbackSessions).orderBy(asc(schema.feedbackSessions.rowNumber)),
        db.select().from(schema.feedbackEntries).orderBy(asc(schema.feedbackEntries.rowNumber)),
      ]);

      const feedbackEntries: FeedbackEntry[] = entries.map(feedbackEntryFromRow);

      return NextResponse.json({
        success: true,
        sessions: sessions.length > 0 ? sessions : FEEDBACK_SESSIONS,
        entries: feedbackEntries,
      });
    } catch (err) {
      console.warn('Database feedback query failed:', err);
    }
  }

  return NextResponse.json({
    success: true,
    sessions: FEEDBACK_SESSIONS,
    entries: [],
  });
}

export async function POST(request: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json({ success: true, message: 'Database not configured' });
  }

  const body = (await request.json().catch(() => null)) as {
    sessionId?: string;
    rowNumber?: number;
    date?: string;
    pic?: string;
    topic?: string;
    ratings?: FeedbackRatings;
    hasQuestions?: boolean;
    questionExplanation?: string;
    questionAddressing?: string;
    suggestions?: string;
  } | null;

  if (!body?.sessionId || typeof body?.rowNumber !== 'number') {
    return NextResponse.json({ error: 'sessionId and rowNumber are required' }, { status: 400 });
  }

  try {
    const updatedAt = new Date().toISOString();
    await db
      .insert(schema.feedbackEntries)
      .values({
        id: `fb-${body.sessionId}`,
        sessionId: body.sessionId,
        rowNumber: body.rowNumber,
        date: body.date || new Date().toISOString().slice(0, 10),
        pic: body.pic || '',
        topic: body.topic || '',
        ratings: body.ratings as any,
        hasQuestions: body.hasQuestions ?? false,
        questionExplanation: body.questionExplanation || '',
        questionAddressing: body.questionAddressing || '',
        suggestions: body.suggestions || '',
        updatedAt,
      })
      .onConflictDoUpdate({
        target: schema.feedbackEntries.sessionId,
        set: {
          date: body.date || undefined,
          pic: body.pic || undefined,
          topic: body.topic || undefined,
          ratings: body.ratings as any,
          hasQuestions: body.hasQuestions ?? false,
          questionExplanation: body.questionExplanation || '',
          questionAddressing: body.questionAddressing || '',
          suggestions: body.suggestions || '',
          updatedAt,
        },
      });

    return NextResponse.json({ success: true, sessionId: body.sessionId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update feedback entry';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
