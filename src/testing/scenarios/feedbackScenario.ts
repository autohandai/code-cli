import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Session } from 'tuistory';

export const SURVEY_QUESTION = 'How is Autohand doing this session?';
export const SURVEY_THANKS = 'Thanks for the feedback!';
export const MOCK_ISSUE_URL = 'https://github.com/autohandai/code-cli/issues/4242';

export interface RecordedApiRequest {
  path: string;
  body: Record<string, unknown>;
}

export interface MockFeedbackApiServer {
  baseUrl: string;
  requests: RecordedApiRequest[];
  close: () => Promise<void>;
}

/** Stands in for api.autohand.ai: accepts feedback and bug reports, records what the CLI sent. */
export async function createMockFeedbackApiServer(): Promise<MockFeedbackApiServer> {
  const requests: RecordedApiRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const path = request.url ?? '';
      const reply = (status: number, body: Record<string, unknown>): void => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(body));
      };
      if (request.method !== 'POST' || (path !== '/v1/feedback' && path !== '/v1/reports')) {
        reply(404, { success: false, error: 'Not found' });
        return;
      }
      requests.push({ path, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> });
      reply(200, path === '/v1/reports'
        ? { success: true, id: 'report-1', issueUrl: MOCK_ISSUE_URL, issueNumber: 4242 }
        : { success: true, id: 'feedback-1' });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); }),
  };
}

export async function waitForApiRequest(
  server: MockFeedbackApiServer,
  path: string,
  count = 1,
  timeout = 10_000,
): Promise<RecordedApiRequest[]> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const matching = server.requests.filter((request) => request.path === path);
    if (matching.length >= count) return matching;
    if (Date.now() > deadline) {
      throw new Error(`Expected ${count} request(s) to ${path}, saw ${matching.length}.`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
}

async function submit(session: Session, text: string): Promise<void> {
  await session.type(text);
  await session.press('enter');
}

/** Opens the survey with a bare /feedback and proves the composer still takes a draft under it. */
export async function openSurveyAndDraftBelowIt(session: Session, draft: string): Promise<string> {
  await submit(session, '/feedback');
  await session.waitForText(SURVEY_QUESTION, { timeout: 10_000 });
  await session.type(draft);
  return await session.text({
    timeout: 5_000,
    waitFor: (text) => text.split('\n').some((line) => line.includes('❯') && line.includes(draft)),
    trimEnd: true,
  });
}

export async function answerSurvey(session: Session, key: string): Promise<string> {
  const acknowledgement = key === '1' ? 'Thanks. Tell us what went wrong' : SURVEY_THANKS;
  await session.type(key);
  await session.waitForText(acknowledgement, { timeout: 5_000 });
  return acknowledgement;
}

export async function runOneTurn(session: Session, prompt: string, finishedMarker: string): Promise<void> {
  await submit(session, prompt);
  await session.waitForText(finishedMarker, { timeout: 20_000 });
}

export async function sendFeedbackMessage(session: Session, message: string): Promise<void> {
  await submit(session, `/feedback ${message}`);
  await session.waitForText('Thank you for your feedback!', { timeout: 10_000 });
}

export async function fileBugReport(session: Session, command: string, expectedConfirmation: string): Promise<string> {
  await submit(session, command);
  return await session.text({
    timeout: 15_000,
    waitFor: (text) => text.includes(expectedConfirmation),
    trimEnd: true,
  });
}
