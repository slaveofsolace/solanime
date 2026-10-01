// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PendingApprovals from '../src/components/PendingApprovals';

const pending = {
  id: 'request-1', email: 'viewer@example.test', approval_state: 'pending',
  approval_requested_at: 1790700000000, owner_notice_state: 'failed', applicant_notice_state: 'not_required',
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('operator account queue', () => {
  it('requires a second deliberate action to approve, then keeps failed email visible for retry', async () => {
    let queueReads = 0;
    const calls: { path: string; options: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (path: string, options: RequestInit) => {
      calls.push({ path, options });
      if (path === '/api/admin/accounts/pending') {
        queueReads += 1;
        return Response.json({ items: queueReads === 1 ? [pending]
          : queueReads === 2 ? [{ ...pending, approval_state: 'approved', applicant_notice_state: 'failed' }]
            : [] });
      }
      if (path.endsWith('/decision')) return Response.json({ decision: 'approved', applicantNotice: 'failed' });
      if (path.endsWith('/retry-notice')) return Response.json({ notice: 'sent' });
      throw new Error(`Unexpected request: ${path}`);
    }));

    render(<PendingApprovals token="fixture-operator-token" />);
    expect(screen.getByText('Loading account requests…')).toBeTruthy();
    await screen.findByText('Owner email failed · request remains pending');
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(screen.getByText('This grants app access immediately. The applicant email may fail.')).toBeTruthy();
    expect(calls.filter((call) => call.options.method === 'POST')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm approval' }));
    await screen.findByText('Approval saved · applicant email failed');
    expect(screen.getByText('Account approved. The applicant email failed; the account can still sign in.')).toBeTruthy();
    expect(calls.find((call) => call.path.endsWith('/decision'))).toMatchObject({
      options: { method: 'POST', body: '{"decision":"approved"}' },
    });
    for (const call of calls) expect(new Headers(call.options.headers).get('x-admin-token')).toBe('fixture-operator-token');

    fireEvent.click(screen.getByRole('button', { name: 'Retry applicant email' }));
    await screen.findByText('You’re caught up. No requests need a decision or email retry.');
    expect(calls.filter((call) => call.path.endsWith('/retry-notice'))).toHaveLength(1);
    expect(screen.getByText('Email accepted.')).toBeTruthy();
  });

  it('makes decline cancellable before committing a rejection', async () => {
    let rejected = false;
    const fetcher = vi.fn(async (path: string, options: RequestInit) => {
      if (path === '/api/admin/accounts/pending') return Response.json({ items: rejected ? [] : [pending] });
      if (path.endsWith('/decision')) {
        expect(options.body).toBe('{"decision":"rejected"}');
        rejected = true;
        return Response.json({ decision: 'rejected', applicantNotice: 'not_required' });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const view = render(<PendingApprovals token="fixture-operator-token" />);
    await screen.findByText('Owner email failed · request remains pending');
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(screen.getByText('No decline email is sent.', { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fetcher.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm decline' }));
    await screen.findByText('You’re caught up. No requests need a decision or email retry.');
    expect(fetcher.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
    expect(screen.getByText('Request declined. No email was sent.')).toBeTruthy();
    view.unmount();
  });

  it('displays authorization failures instead of an empty queue', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: 'A valid operator token is required.' } }, { status: 401 })));
    render(<PendingApprovals token="wrong-token" />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('A valid operator token is required.'));
    expect(screen.queryByText('You’re caught up. No requests need a decision or email retry.')).toBeNull();
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
