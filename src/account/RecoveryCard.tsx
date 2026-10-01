import { useState } from 'react';

export default function RecoveryCard({
  code,
  onDone,
  doneLabel = 'Continue',
  replacement = false,
  pendingApproval = false,
}: {
  code: string;
  onDone: () => void;
  doneLabel?: string;
  replacement?: boolean;
  pendingApproval?: boolean;
}) {
  const [saved, setSaved] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  function download() {
    const blob = new Blob(
      [`Solanime recovery code\n\n${code}\n\nKeep this private. It can reset your password and is replaced after use.\n`],
      { type: 'text/plain' },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'solanime-recovery-code.txt';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopyStatus('Code copied.');
    } catch {
      setCopyStatus('Clipboard unavailable. Select and copy the code above.');
    }
  }

  return (
    <section className="recovery-page">
      <div className="recovery-card">
        <h1>Save your recovery code</h1>
        <p className="recovery-intro">
          {pendingApproval
            ? 'Your request is waiting for approval. Save this code somewhere private; you’ll need it to reset your password.'
            : replacement
              ? 'Your previous code no longer works. Save this one somewhere private to reset your password.'
              : 'Keep this code somewhere private. You’ll need it to reset your password, and it won’t be shown again.'}
        </p>
        <div className="recovery-code-panel">
          <div className="recovery-code-heading">
            <span>Recovery code</span>
            <button className="text-button" type="button" onClick={() => void copy()}>
              Copy code
            </button>
          </div>
          <code className="recovery-value">{code}</code>
        </div>
        <div className="recovery-actions">
          <button className="text-button" type="button" onClick={download}>
            Download text file
          </button>
        </div>
        {copyStatus && <p className="recovery-copy-status" role="status">{copyStatus}</p>}
        <div className="recovery-confirmation">
          <label className="check-label">
            <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
            I have saved my recovery code
          </label>
          <button className="button button--primary" type="button" disabled={!saved} onClick={onDone}>
            {doneLabel}
          </button>
        </div>
      </div>
    </section>
  );
}
