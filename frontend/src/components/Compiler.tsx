import React, { useEffect, useState } from 'react';
import { CompilerApi, CompilerLanguage, CompileResult } from '../api';

export default function Compiler() {
  const [languages, setLanguages] = useState<CompilerLanguage[]>([]);
  const [language, setLanguage] = useState('python');
  const [code, setCode] = useState('');
  const [stdin, setStdin] = useState('');
  const [result, setResult] = useState<CompileResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    CompilerApi.languages().then(({ data }) => {
      setLanguages(data);
      const py = data.find((l) => l.key === 'python');
      if (py) setCode(py.starter);
    });
  }, []);

  function onLanguageChange(key: string) {
    setLanguage(key);
    const lang = languages.find((l) => l.key === key);
    if (lang) setCode(lang.starter);
    setResult(null);
  }

  async function run() {
    setRunning(true);
    setError('');
    setResult(null);
    try {
      const { data } = await CompilerApi.run(language, code, stdin || undefined);
      setResult(data);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Execution failed');
    } finally {
      setRunning(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Ctrl/Cmd+Enter to run, like most online compilers
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      run();
    }
    // Tab inserts spaces instead of moving focus out of the editor
    if (e.key === 'Tab') {
      e.preventDefault();
      const target = e.currentTarget;
      const { selectionStart, selectionEnd } = target;
      const next = code.slice(0, selectionStart) + '    ' + code.slice(selectionEnd);
      setCode(next);
      requestAnimationFrame(() => {
        target.selectionStart = target.selectionEnd = selectionStart + 4;
      });
    }
  }

  return (
    <div>
      <h2><span className="prompt">$</span> ./compile --run</h2>
      <p style={{ color: 'var(--text-dim)', marginTop: -8 }}>
        Runs in a fresh, network-isolated, resource-capped container on the same platform — same
        infrastructure as the sandboxes, just torn down immediately after each run.
      </p>

      <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 220 }}>
          <label>Language</label>
          <select value={language} onChange={(e) => onLanguageChange(e.target.value)}>
            {languages.map((l) => (
              <option key={l.key} value={l.key}>{l.label}</option>
            ))}
          </select>
        </div>
        <button className="btn" onClick={run} disabled={running} style={{ height: 40, marginTop: 20 }}>
          {running ? 'Running…' : '▶ Run (Ctrl+Enter)'}
        </button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '2fr 1fr', alignItems: 'start' }}>
        <div className="card">
          <h4 style={{ marginTop: 0 }}>Code</h4>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            style={{
              width: '100%', height: 420, fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
              fontSize: 13, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)',
              borderRadius: 6, padding: 12, resize: 'vertical', lineHeight: 1.5,
            }}
          />
        </div>

        <div>
          <div className="card">
            <h4 style={{ marginTop: 0 }}>Stdin (optional)</h4>
            <textarea
              value={stdin}
              onChange={(e) => setStdin(e.target.value)}
              placeholder="Input fed to the program, if it reads from stdin"
              style={{
                width: '100%', height: 100, fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
                fontSize: 13, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)',
                borderRadius: 6, padding: 8, resize: 'vertical',
              }}
            />
          </div>

          <div className="card">
            <h4 style={{ marginTop: 0 }}>Output</h4>
            {error && <p style={{ color: 'var(--red)', fontSize: 13 }}>{error}</p>}
            {!error && !result && !running && <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>Run your code to see output here.</p>}
            {running && <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>Compiling & running…</p>}
            {result && (
              <>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
                  Exit code: <strong style={{ color: result.exitCode === 0 ? 'var(--green)' : 'var(--red)' }}>{result.exitCode ?? '—'}</strong>
                  {' · '}{result.durationMs} ms
                  {result.timedOut && <span style={{ color: 'var(--red)' }}> · timed out</span>}
                </div>
                {result.stdout && (
                  <pre style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, fontSize: 12, whiteSpace: 'pre-wrap', maxHeight: 220, overflowY: 'auto' }}>
                    {result.stdout}
                  </pre>
                )}
                {result.stderr && (
                  <pre style={{ background: 'var(--bg)', border: '1px solid var(--red)', borderRadius: 6, padding: 8, fontSize: 12, color: 'var(--red)', whiteSpace: 'pre-wrap', maxHeight: 220, overflowY: 'auto' }}>
                    {result.stderr}
                  </pre>
                )}
                {!result.stdout && !result.stderr && <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>(no output)</p>}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
