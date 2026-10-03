/** FormSubmit is a notification transport, never an approval authority.
 * The destination comes from deployment configuration (an operator alias address or the
 * FormSubmit random form ID), never from source, so the public repository names no inbox. */
export async function sendApprovalNotice(
  kind: 'request' | 'approved', account: { id: string; email: string }, origin: string,
  destination: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const target = destination?.trim();
  // An unset destination is a disabled transport: nothing leaves the deployment.
  if (!target || target.length > 254 || /[\s/?#]/.test(target)) return false;
  const endpoint = `https://formsubmit.co/ajax/${encodeURIComponent(target)}`;
  // The owner notice carries no applicant details; the admin screen is the only place they are shown.
  const message = kind === 'request'
    ? 'A Solanime account request is waiting for operator review. Open the restricted Solanime admin screen to review it; this email is not an approval link.'
    : `Your Solanime account has been approved. You may now sign in at ${origin}/login. If you did not request this account, ignore this message.`;
  try {
    const response = await fetcher(endpoint, {
      method: 'POST', signal: AbortSignal.timeout(7000),
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Origin': origin, 'Referer': `${origin}/` },
      body: JSON.stringify({
        name: 'Solanime account review',
        _subject: kind === 'request' ? 'Solanime account approval requested' : 'Solanime account approved',
        _template: 'table',
        ...(kind === 'approved' ? { _cc: account.email } : {}),
        message,
      }),
    });
    if (!response.ok) return false;
    const value = await response.json() as { success?: unknown };
    return value.success === true || value.success === 'true';
  } catch { return false; }
}
