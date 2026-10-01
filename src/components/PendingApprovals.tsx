import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage, request } from '../lib/api';
import '../styles/admin-approvals.css';

type RequestRow = {
  id: string;
  email: string;
  approval_state: 'pending' | 'approved';
  approval_requested_at: number | null;
  owner_notice_state: string;
  applicant_notice_state: string;
};

type Decision = 'approved' | 'rejected';

function requestedAt(value: number | null) {
  if (!value) return 'Request time unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Request time unavailable' : date.toLocaleString();
}

function noticeFor(item: RequestRow) {
  if (item.approval_state === 'approved') return 'Approval saved · applicant email failed';
  if (item.owner_notice_state === 'failed') return 'Owner email failed · request remains pending';
  if (item.owner_notice_state === 'sent') return 'Owner notified';
  return 'Owner email pending';
}

export default function PendingApprovals({ token }: { token: string }) {
  const [items, setItems] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; decision: Decision } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const loadController = useRef<AbortController | null>(null);
  const actionController = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true);
    setError(null);
    try {
      const data = await request<{ items?: RequestRow[] }>('/api/admin/accounts/pending', {
        headers: { 'x-admin-token': token }, signal: controller.signal,
      });
      if (!Array.isArray(data.items)) throw new Error('The account queue response is incomplete.');
      if (!controller.signal.aborted) setItems(data.items);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setItems([]);
        setError(errorMessage(cause));
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
    return () => {
      loadController.current?.abort();
      actionController.current?.abort();
    };
  }, [load]);

  async function action(item: RequestRow, kind: Decision | 'retry-notice') {
    if (busy) return;
    loadController.current?.abort();
    actionController.current?.abort();
    const controller = new AbortController();
    actionController.current = controller;
    setBusy(item.id);
    setConfirm(null);
    setError(null);
    setNotice(null);
    try {
      const result = await request<{ applicantNotice?: string; notice?: string }>(
        `/api/admin/accounts/${encodeURIComponent(item.id)}/${kind === 'retry-notice' ? 'retry-notice' : 'decision'}`,
        {
          method: 'POST', headers: { 'x-admin-token': token },
          body: JSON.stringify(kind === 'retry-notice' ? {} : { decision: kind }),
          signal: controller.signal,
        },
      );
      if (controller.signal.aborted) return;
      setNotice(kind === 'approved'
        ? result.applicantNotice === 'sent'
          ? 'Account approved. The applicant email was accepted.'
          : 'Account approved. The applicant email failed; the account can still sign in.'
        : kind === 'rejected'
          ? 'Request declined. No email was sent.'
          : result.notice === 'sent'
            ? 'Email accepted.'
            : 'Email failed again. The request remains in this queue.');
      await load();
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause));
    } finally {
      if (!controller.signal.aborted) setBusy(null);
    }
  }

  const pendingCount = items.filter((item) => item.approval_state === 'pending').length;
  const failedCount = items.filter((item) => item.approval_state === 'approved').length;

  return <section className="admin-run approval-queue" aria-labelledby="pending-approvals-title">
    <header className="approval-queue__heading">
      <div>
        <p className="eyebrow">PRIVATE ACCESS</p>
        <h2 id="pending-approvals-title">Account requests</h2>
        <p>Review requests here. A failed email does not change an account’s approval state.</p>
      </div>
      <button className="button button--outline" type="button" disabled={loading || busy !== null}
        onClick={() => void load()}>Refresh requests</button>
    </header>

    {!loading && !error && items.length > 0 && <p className="approval-queue__summary">
      {pendingCount} awaiting decision{failedCount > 0 ? ` · ${failedCount} approved with failed email` : ''}
    </p>}
    {error && <p role="alert" className="approval-queue__error">{error}</p>}
    {notice && <p role="status" className="approval-queue__notice">{notice}</p>}
    {loading && <p role="status" className="approval-queue__empty">Loading account requests…</p>}
    {!loading && !error && items.length === 0 &&
      <p className="approval-queue__empty">You’re caught up. No requests need a decision or email retry.</p>}

    {!loading && items.length > 0 && <ul className="approval-queue__list">
      {items.map((item) => {
        const pending = item.approval_state === 'pending';
        const failed = pending ? item.owner_notice_state === 'failed' : item.applicant_notice_state === 'failed';
        const selected = confirm?.id === item.id ? confirm.decision : null;
        return <li className="approval-queue__item" key={item.id}>
          <div className="approval-queue__identity">
            <strong>{item.email}</strong>
            <span>Requested {requestedAt(item.approval_requested_at)}</span>
          </div>
          <div className="approval-queue__state">
            <span className={`approval-queue__badge${pending ? '' : ' approval-queue__badge--approved'}`}>
              {pending ? 'Awaiting decision' : 'Approved'}
            </span>
            <span className={failed ? 'approval-queue__failure' : undefined}>{noticeFor(item)}</span>
          </div>
          {selected ? <div className="approval-queue__confirm">
            <p><strong>{selected === 'approved' ? 'Approve this account?' : 'Decline this request?'}</strong>{' '}
              {selected === 'approved'
                ? 'This grants app access immediately. The applicant email may fail.'
                : 'This keeps the account from accessing the app. No decline email is sent.'}</p>
            <div className="approval-queue__actions">
              <button className={selected === 'approved' ? 'button button--primary' : 'button button--outline'}
                type="button" disabled={busy !== null} onClick={() => void action(item, selected)}>
                Confirm {selected === 'approved' ? 'approval' : 'decline'}
              </button>
              <button className="button button--outline" type="button" disabled={busy !== null}
                onClick={() => setConfirm(null)}>Cancel</button>
            </div>
          </div> : <div className="approval-queue__actions">
            {pending && <>
              <button className="button button--primary" type="button" disabled={busy !== null}
                onClick={() => setConfirm({ id: item.id, decision: 'approved' })}>Approve</button>
              <button className="button button--outline" type="button" disabled={busy !== null}
                onClick={() => setConfirm({ id: item.id, decision: 'rejected' })}>Decline</button>
            </>}
            {failed && <button className="button button--outline" type="button" disabled={busy !== null}
              onClick={() => void action(item, 'retry-notice')}>
              Retry {pending ? 'owner' : 'applicant'} email
            </button>}
          </div>}
          {busy === item.id && <span className="approval-queue__working" role="status">Saving…</span>}
        </li>;
      })}
    </ul>}
  </section>;
}
