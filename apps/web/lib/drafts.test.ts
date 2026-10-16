import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The guard reads isRedirectingToLogin from the API client: a 401 sets it.
const redirect = vi.hoisted(() => ({ on: false }));
vi.mock('./api', () => ({ isRedirectingToLogin: () => redirect.on }));

const { draftKey, draftStep, isOtherPage, leaveGuardHandlers } = await import('./drafts');

describe('isOtherPage (unsaved-changes guard)', () => {
  const here = 'https://app.example.in/jobs/1?tab=setup#questions';

  it('asks before going to another page of the app', () => {
    expect(isOtherPage('/jobs', here)).toBe(true);
    expect(isOtherPage('/jobs/1?tab=candidates', here)).toBe(true);
    expect(isOtherPage('https://app.example.in/settings', here)).toBe(true);
  });

  it('lets same-page links and #hash jumps through', () => {
    expect(isOtherPage('/jobs/1?tab=setup', here)).toBe(false);
    expect(isOtherPage('#answers', here)).toBe(false);
  });

  it('leaves other sites to the browser prompt', () => {
    expect(isOtherPage('https://example.com/help', here)).toBe(false);
  });
});

describe('useDraft storage', () => {
  it('keys a draft by user and entity, and waits for the user', () => {
    expect(draftKey('u1', 'job:7')).toBe('draft:u1:job:7');
    expect(draftKey(undefined, 'job:7')).toBeNull();
  });

  it('writes only while dirty, and removes once an edited form is clean again', () => {
    expect(draftStep(true, false)).toBe('write');
    expect(draftStep(true, true)).toBe('write');
    expect(draftStep(false, true)).toBe('remove');
    // Clean and never edited: a draft restored from storage stays until the page decides.
    expect(draftStep(false, false)).toBeNull();
  });
});

describe('leave guard', () => {
  const from = { state: { __NA: true, key: 'a' }, url: 'https://app.example.in/jobs/1' };
  let confirm: ReturnType<typeof vi.fn>;
  let pushState: ReturnType<typeof vi.fn>;

  const popstate = () => ({ stopImmediatePropagation: vi.fn() }) as unknown as PopStateEvent;
  const beforeunload = () => ({ preventDefault: vi.fn(), returnValue: undefined }) as unknown as BeforeUnloadEvent;

  beforeEach(() => {
    confirm = vi.fn(() => false);
    pushState = vi.fn();
    redirect.on = false;
    // Back has already moved the browser to /jobs.
    vi.stubGlobal('window', {
      confirm,
      history: { pushState },
      location: { href: 'https://app.example.in/jobs' },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Back cancelled: stops the router and puts the page back', () => {
    const { onPopState } = leaveGuardHandlers('Leave?', () => from);
    const event = popstate();
    onPopState(event);
    expect(confirm).toHaveBeenCalledWith('Leave?');
    expect(event.stopImmediatePropagation).toHaveBeenCalled();
    expect(pushState).toHaveBeenCalledWith(from.state, '', from.url);
  });

  it('Back confirmed: the event goes on to the router untouched', () => {
    confirm.mockReturnValue(true);
    const { onPopState } = leaveGuardHandlers('Leave?', () => from);
    const event = popstate();
    onPopState(event);
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
  });

  it('closing the tab prompts, except after a 401 sent the page to sign in', () => {
    const { onBeforeUnload } = leaveGuardHandlers('Leave?', () => from);
    const asked = beforeunload();
    onBeforeUnload(asked);
    expect(asked.preventDefault).toHaveBeenCalled();

    redirect.on = true;
    const forced = beforeunload();
    onBeforeUnload(forced);
    expect(forced.preventDefault).not.toHaveBeenCalled();
  });

  it('after confirming a leave, the unload that follows does not ask again', () => {
    confirm.mockReturnValue(true);
    const { onPopState, onBeforeUnload } = leaveGuardHandlers('Leave?', () => from);
    onPopState(popstate());
    const unload = beforeunload();
    onBeforeUnload(unload);
    expect(unload.preventDefault).not.toHaveBeenCalled();
  });
});
