// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { renderFeedback, type FeedbackActions } from '../../../../src/app/online/gm/dock/feedbackForm.ts';
import { setServerOrigin, UPSTREAM_RELAY_ORIGIN } from '../../../../src/app/online/gm/servers.ts';

const actions: FeedbackActions = {
  toggleFeedback: () => undefined,
  feedbackText: () => '',
  setFeedbackText: () => undefined,
  setFeedbackDiagnostics: () => undefined,
  sendFeedback: () => undefined,
  setErrorReports: () => undefined,
};

function note(diagnostics: boolean): string {
  const parent = document.body.createDiv();
  renderFeedback(parent, { open: true, diagnostics, state: 'idle', errorReports: false }, actions);
  return parent.querySelector('.atlas-online-feedback__note')?.textContent ?? '';
}

describe('the feedback form\'s note', () => {
  afterEach(() => setServerOrigin(null));

  it('names the Atlas team on Atlas\'s own server', () => {
    setServerOrigin(UPSTREAM_RELAY_ORIGIN);
    expect(note(false)).toContain('the Atlas team');
    expect(note(true)).toContain('the Atlas team');
  });

  it('names the server\'s operator on a self-hosted server', () => {
    setServerOrigin('https://tables.example.com');
    for (const text of [note(false), note(true)]) {
      expect(text).toContain('the server\'s operator');
      expect(text).not.toContain('Atlas team');
    }
  });
});
