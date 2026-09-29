import { useCallback, useEffect, useState } from 'react';

type RequestRow = {
  id: string;
  email: string;
  approval_state: 'pending' | 'approved';
  approval_requested_at: number | null;
  owner_notice_state: string;
  applicant_notice_state: string;
};

export default function PendingApprovals({ token }: { token: string }) {
  const [items, setItems] = useState<RequestRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch('/api/admin/accounts/pending', {
      headers: { 'x-admin-token': token }, signal,
    });
    if (!response.ok) throw new Error('Could not load account requests. Check your operator token.');
    const data = await response.json() as { items?: RequestRow[] };
    if (!Array.isArray(data.items)) throw new Error('The account queue response is incomplete.');
    setItems(data.items);
  }, [token]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((cause) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load requests.');
    });
    return () => controller.abort();
  }, [load]);
  async function action(item: RequestRow, kind: 'approved' | 'rejected' | 'retry-notice') {
    setBusy(item.id); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/admin/accounts/${encodeURIComponent(item.id)}/${kind === 'retry-notice' ? 'retry-notice' : 'decision'}`, {
        method: 'POST', headers: { 'x-admin-token': token, 'content-type': 'application/json' },
        body: JSON.stringify(kind === 'retry-notice' ? {} : { decision: kind }),
      });
      const data = await response.json() as { error?: { message?: string }; applicantNotice?: string; notice?: string };
      if (!response.ok) throw new Error(data.error?.message ?? 'The account action failed.');
      setNotice(kind === 'approved' && data.applicantNotice !== 'sent'
        ? 'Account approved, but the applicant email was not accepted. Retry its notice below.'
        : kind === 'retry-notice' && data.notice !== 'sent'
          ? 'Email was not accepted. The request remains available for retry.'
          : kind === 'rejected' ? 'Request declined.' : 'Action saved.');
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The action failed.'); }
    finally { setBusy(null); }
  }
  return <section className="admin-run" aria-labelledby="pending-approvals-title">
    <header><div><p className="eyebrow">PRIVATE ACCESS</p><h2 id="pending-approvals-title">Account requests</h2></div>
      <button type="button" onClick={() => void load().catch(() => setError('Could not refresh account requests.'))}>Refresh</button></header>
    <p>Approval is recorded in the private account database. Email is a notification, not proof of approval.</p>
    {error && <p role="alert" className="form-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {items.length === 0 ? <p>No pending requests or failed approval notices.</p> : <div className="admin-table-wrap"><table>
      <thead><tr><th>Applicant</th><th>Requested</th><th>Status</th><th>Notice</th><th>Action</th></tr></thead>
      <tbody>{items.map(item => <tr key={item.id}>
        <td>{item.email}</td><td>{item.approval_requested_at ? new Date(item.approval_requested_at).toLocaleString() : '—'}</td>
        <td>{item.approval_state}</td>
        <td>{item.approval_state === 'pending' ? item.owner_notice_state : item.applicant_notice_state}</td>
        <td><div className="button-row">
          {item.approval_state === 'pending' && <>
            <button type="button" disabled={busy !== null} onClick={() => void action(item, 'approved')}>Approve</button>
            <button type="button" disabled={busy !== null} onClick={() => void action(item, 'rejected')}>Decline</button>
          </>}
          {(item.approval_state === 'approved' || item.owner_notice_state === 'failed') &&
            <button type="button" disabled={busy !== null} onClick={() => void action(item, 'retry-notice')}>Retry email</button>}
        </div></td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}
