import React from 'react';
import { Link } from 'react-router-dom';
import { SandboxContainer, ContainerApi } from '../api';

export default function ContainerCard({ c, onChange }: { c: SandboxContainer; onChange: () => void }) {
  async function act(fn: () => Promise<any>) {
    await fn();
    onChange();
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>{c.name}</strong>
        <span className={`badge ${c.status}`}>{c.status}</span>
      </div>
      <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>{c.image}</p>
      <p style={{ fontSize: 13 }}>CPU limit: {c.cpuLimit} core(s) · RAM: {c.memoryLimitMb} MB</p>
      {c.url && (
        <p style={{ fontSize: 13 }}>
          Preview: <a href={c.url} target="_blank" rel="noreferrer">{c.url}</a>
        </p>
      )}
      <div style={{ marginTop: 12 }}>
        <Link className="btn" to={`/containers/${c.id}`}>Open</Link>
        {c.status === 'running' ? (
          <button className="btn secondary" onClick={() => act(() => ContainerApi.stop(c.id))}>Stop</button>
        ) : (
          <button className="btn secondary" onClick={() => act(() => ContainerApi.start(c.id))}>Start</button>
        )}
        <button className="btn danger" onClick={() => act(() => ContainerApi.remove(c.id))}>Delete</button>
      </div>
    </div>
  );
}
