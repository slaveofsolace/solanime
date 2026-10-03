// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HumanCheck from '../src/account/HumanCheck';

afterEach(() => { cleanup(); delete window.turnstile; });

describe('Turnstile sign-up check', () => {
  it('renders the widget for the requested action and passes single-use tokens through', async () => {
    let options: Record<string, unknown> = {};
    const turnstile = {
      render: vi.fn((_element: HTMLElement, value: Record<string, unknown>) => { options = value; return 'widget-1'; }),
      reset: vi.fn(), remove: vi.fn(),
    };
    window.turnstile = turnstile;
    const onToken = vi.fn(), onError = vi.fn();
    const view = render(<HumanCheck siteKey="site-key" action="register" resetKey={0} onToken={onToken} onError={onError} />);
    await vi.waitFor(() => expect(turnstile.render).toHaveBeenCalledOnce());
    expect(options).toMatchObject({ sitekey: 'site-key', action: 'register', appearance: 'interaction-only' });

    (options.callback as (token: string) => void)('token-1');
    expect(onToken).toHaveBeenLastCalledWith('token-1');
    (options['expired-callback'] as () => void)();
    expect(onToken).toHaveBeenLastCalledWith(null);

    view.rerender(<HumanCheck siteKey="site-key" action="register" resetKey={1} onToken={onToken} onError={onError} />);
    expect(turnstile.reset).toHaveBeenCalledWith('widget-1');
    expect(onToken).toHaveBeenLastCalledWith(null);

    (options['error-callback'] as () => void)();
    expect(onError).toHaveBeenCalledOnce();
    view.unmount();
    expect(turnstile.remove).toHaveBeenCalledWith('widget-1');
  });
});
