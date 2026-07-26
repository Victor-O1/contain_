import React, { useEffect, useState } from 'react';
import { api } from '../api';

export default function Admin() {
  const [audit, setAudit] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [overview, setOverview] = useState<any>(null);
  const [hosts, setHosts] = useState<any[]>([]);
  const [newHost, setNewHost] = useState({ id: '', label: '', connection: '' });

  async function refresh() {
    const [a, al, ov, h] = await Promise.all([
      api.get('/admin/audit'),
      api.get('/admin/alerts'),
      api.get('/admin/stats/overview'),
      api.get('/admin/hosts'),
    ]);
    setAudit(a.data); setAlerts(al.data); setOverview(ov.data); setHosts(h.data);
  }

  useEffect(() => { refresh(); }, []);

  async function addHost(e: React.FormEvent) {
    e.preventDefault();
    if (!newHost.id || !newHost.label || !newHost.connection) return;
    await api.post('/admin/hosts', newHost);
    setNewHost({ id: '', label: '', connection: '' });
    refresh();
  }

  async function toggleHost(id: string, enabled: boolean) {
    await api.patch(`/admin/hosts/${id}`, { enabled: !enabled });
    refresh();
  }

  return (
    <div>
      <h2><span className="prompt">$</span> admin --panel</h2>
      {overview && (
        <div className="grid" style={{ marginBottom: 16 }}>
          <div className="card"><h4>active_containers</h4><p className="stat">{overview.activeContainers}</p></div>
          <div className="card"><h4>total_containers_ever</h4><p className="stat">{overview.totalContainersEver}</p></div>
          <div className="card"><h4>docker_hosts</h4><p className="stat">{hosts.length}</p></div>
        </div>
      )}

      <div className="card">
        <h4>docker_hosts // multi-host scheduling</h4>
        <table style={{ width: '100%', fontSize: 13, marginBottom: 12 }}>
          <thead><tr><th align="left">id</th><th align="left">label</th><th align="left">connection</th><th>active</th><th>enabled</th></tr></thead>
          <tbody>
            {hosts.map((h) => (
              <tr key={h.id}>
                <td>{h.id}</td>
                <td>{h.label}</td>
                <td style={{ color: 'var(--text-dim)' }}>{h.connection}</td>
                <td align="center">{h.activeContainers}</td>
                <td align="center">
                  <button className={`btn ${h.enabled ? '' : 'secondary'}`} style={{ padding: '2px 10px', fontSize: 12 }}
                    onClick={() => toggleHost(h.id, !!h.enabled)}>
                    {h.enabled ? 'enabled' : 'disabled'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form onSubmit={addHost} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12 }}>host_id</label>
            <input value={newHost.id} onChange={(e) => setNewHost({ ...newHost, id: e.target.value })} placeholder="worker-1" />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12 }}>label</label>
            <input value={newHost.label} onChange={(e) => setNewHost({ ...newHost, label: e.target.value })} placeholder="Worker 1" />
          </div>
          <div style={{ flex: 2 }}>
            <label style={{ fontSize: 12 }}>connection</label>
            <input value={newHost.connection} onChange={(e) => setNewHost({ ...newHost, connection: e.target.value })} placeholder="tcp://10.0.0.5:2376" />
          </div>
          <button className="btn" type="submit" style={{ height: 40 }}>+ add_host</button>
        </form>
        <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          New sandboxes are scheduled onto whichever enabled host currently has the fewest running containers.
          For true bin-packing/failover across a large fleet, point this at a Swarm or k3s API instead.
        </p>
      </div>

      <div className="card">
        <h4>recent_alerts</h4>
        {alerts.length === 0 && <p style={{ color: 'var(--text-dim)' }}>-- none --</p>}
        {alerts.map((a) => (
          <div key={a.id} style={{ fontSize: 13, borderBottom: '1px solid var(--border)', padding: '4px 0' }}>
            <span className="badge error">{a.type}</span> {a.message} <span style={{ color: 'var(--text-dim)' }}>({a.created_at})</span>
          </div>
        ))}
      </div>

      <div className="card">
        <h4>audit_log</h4>
        <div style={{ maxHeight: 300, overflowY: 'auto' }}>
          {audit.map((a) => (
            <div key={a.id} style={{ fontSize: 12, borderBottom: '1px solid var(--border)', padding: '4px 0' }}>
              <strong>{a.action}</strong> · target: {a.target || '-'} · {a.created_at}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
