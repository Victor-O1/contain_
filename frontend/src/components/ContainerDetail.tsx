import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ContainerApi, SandboxContainer } from '../api';
import TerminalPanel from './Terminal';
import StatsChart from './StatsChart';
import FileManager from './FileManager';

export default function ContainerDetail() {
  const { id } = useParams<{ id: string }>();
  const [container, setContainer] = useState<SandboxContainer | null>(null);
  const [snapshotMsg, setSnapshotMsg] = useState('');
  const [splitTerminal, setSplitTerminal] = useState(false);

  async function refresh() {
    if (!id) return;
    const { data } = await ContainerApi.get(id);
    setContainer(data);
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [id]);

  if (!container) return <p>Loading...</p>;

  async function snapshot() {
    if (!id) return;
    const { data } = await ContainerApi.snapshot(id);
    setSnapshotMsg(`Saved as image: ${data.image}`);
  }

  return (
    <div>
      <Link to="/">&larr; Back to dashboard</Link>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 0' }}>
        <h2>{container.name} <span className={`badge ${container.status}`}>{container.status}</span></h2>
        <div>
          <button className="btn secondary" onClick={snapshot}>Save Snapshot</button>
        </div>
      </div>
      {snapshotMsg && <p style={{ color: 'var(--green)' }}>{snapshotMsg}</p>}

      {container.status === 'running' ? (
        <>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h4 style={{ margin: 0 }}>Terminal</h4>
              <button className="btn secondary" onClick={() => setSplitTerminal((s) => !s)}>
                {splitTerminal ? 'Single pane' : 'Split pane'}
              </button>
            </div>
            {splitTerminal ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <TerminalPanel key="pane-1" containerId={container.id} />
                <TerminalPanel key="pane-2" containerId={container.id} />
              </div>
            ) : (
              <TerminalPanel key="pane-single" containerId={container.id} />
            )}
            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 8, marginBottom: 0 }}>
              Ctrl+C to interrupt · Ctrl+Shift+C/V to copy/paste (browser-dependent) · each pane is its own exec session
            </p>
          </div>
          <StatsChart containerId={container.id} />
          <FileManager containerId={container.id} />
        </>
      ) : (
        <div className="card">
          <p>Container is not running. Start it from the dashboard to open a terminal, browse files, and view live stats.</p>
        </div>
      )}
    </div>
  );
}
