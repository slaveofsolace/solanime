/** FormSubmit is a notification transport, never an approval authority. */
export async function sendApprovalNotice(
  kind: 'request' | 'approved', account: { id: string; email: string }, origin: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const endpoint = 'https://formsubmit.co/ajax/slaveofsolace@gmail.com';
  const message = kind === 'request'
    ? `A Solanime account request is waiting for operator review. Account ID: ${account.id}. Applicant: ${account.email}. Approve only through the restricted Solanime admin screen; this email is not an approval link.`
    : `Your Solanime account has been approved. You may now sign in at ${origin}/login. If you did not request this account, ignore this message.`;
  try {
    const response = await fetcher(endpoint, {
      method: 'POST', signal: AbortSignal.timeout(7000),
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Origin': origin, 'Referer': `${origin}/` },
      body: JSON.stringify({
        name: 'Solanime account review',
        email: 'slaveofsolace@gmail.com',
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
