import { useState } from 'react';
export default function RecoveryCard({
  code,
  onDone,
  replacement = false,
}: {
  code: string;
  onDone: () => void;
  replacement?: boolean;
}) {
  const [saved, setSaved] = useState(false),
    [copied, setCopied] = useState(false);
  function download() {
    const blob = new Blob(
      [
        `Solanime recovery code\n\n${code}\n\nKeep this private. It can reset your password and is replaced after use.\n`,
      ],
      { type: 'text/plain' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'solanime-recovery-code.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="recovery-card">
      <h1>{replacement ? 'Save your new recovery code' : 'Keep a way back in'}</h1>
      <p>
        This private code can reset your password. Store it in your password manager or a safe
        place. {replacement ? 'The previous code no longer works.' : 'It is shown here only once.'}
      </p>
      <code className="recovery-value">{code}</code>
      <div className="button-row">
        <button type="button" onClick={download}>
          Save recovery file
        </button>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? 'Copied' : 'Copy code'}
        </button>
      </div>
      <label className="check-label">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />I have
        saved my recovery code
      </label>
      <button className="button button--primary" disabled={!saved} onClick={onDone}>
        Continue
      </button>
    </section>
  );
}
