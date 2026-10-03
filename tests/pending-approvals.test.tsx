// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PendingApprovals from '../src/components/PendingApprovals';

const pending = {
  id: 'request-1', email: 'viewer@example.test', approval_state: 'pending', approval_requested_at: 1790700000000,
};
const caughtUp = 'You’re caught up. No requests need a decision.';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('operator account queue', () => {
  it('requires a second deliberate action to approve and sends no email', async () => {
    let approved = false;
    const calls: { path: string; options: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (path: string, options: RequestInit) => {
      calls.push({ path, options });
      if (path === '/api/admin/accounts/pending') return Response.json({ items: approved ? [] : [pending] });
      if (path.endsWith('/decision')) {
        approved = true;
        return Response.json({ id: pending.id, decision: 'approved' });
      }
      throw new Error(`Unexpected request: ${path}`);
    }));

    render(<PendingApprovals token="fixture-operator-token" />);
    expect(screen.getByText('Loading account requests…')).toBeTruthy();
    await screen.findByText('viewer@example.test');
    expect(screen.getByText('1 awaiting decision')).toBeTruthy();
    expect(screen.queryByText(/email/i, { selector: 'p,span,button' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(screen.getByText('This grants app access immediately.')).toBeTruthy();
    expect(calls.filter((call) => call.options.method === 'POST')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm approval' }));
    await screen.findByText(caughtUp);
    expect(screen.getByText('Account approved. They can sign in now.')).toBeTruthy();
    expect(calls.find((call) => call.path.endsWith('/decision'))).toMatchObject({
      options: { method: 'POST', body: '{"decision":"approved"}' },
    });
    for (const call of calls) expect(new Headers(call.options.headers).get('x-admin-token')).toBe('fixture-operator-token');
  });

  it('makes decline cancellable before committing a rejection', async () => {
    let rejected = false;
    const fetcher = vi.fn(async (path: string, options: RequestInit) => {
      if (path === '/api/admin/accounts/pending') return Response.json({ items: rejected ? [] : [pending] });
      if (path.endsWith('/decision')) {
        expect(options.body).toBe('{"decision":"rejected"}');
        rejected = true;
        return Response.json({ id: pending.id, decision: 'rejected' });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const view = render(<PendingApprovals token="fixture-operator-token" />);
    await screen.findByText('viewer@example.test');
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(screen.getByText('This keeps the account from accessing the app.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fetcher.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm decline' }));
    await screen.findByText(caughtUp);
    expect(fetcher.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
    expect(screen.getByText('Request declined.')).toBeTruthy();
    view.unmount();
  });

  it('displays authorization failures instead of an empty queue', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: 'A valid operator token is required.' } }, { status: 401 })));
    render(<PendingApprovals token="wrong-token" />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('A valid operator token is required.'));
    expect(screen.queryByText(caughtUp)).toBeNull();
  });

  it('removes prior applicant rows when a later queue refresh loses authorization', async () => {
    let reads = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      reads += 1;
      return reads === 1
        ? Response.json({ items: [pending] })
        : Response.json({ error: { message: 'A valid operator token is required.' } }, { status: 401 });
    }));
    render(<PendingApprovals token="expired-token" />);
    await screen.findByText('viewer@example.test');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh requests' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('A valid operator token is required.'));
    expect(screen.queryByText('viewer@example.test')).toBeNull();
  });
});
