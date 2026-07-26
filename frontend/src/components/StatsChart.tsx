import React, { useEffect, useRef, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { wsUrl, ContainerApi } from '../api';

interface Point { time: string; cpu: number; mem: number; }

export default function StatsChart({ containerId }: { containerId: string }) {
  const [points, setPoints] = useState<Point[]>([]);
  const [latest, setLatest] = useState<{ cpuPercent: number; memUsageMb: number; memLimitMb: number; netRxBytes: number; netTxBytes: number } | null>(null);
  const [view, setView] = useState<'live' | 'history'>('live');
  const [historyPoints, setHistoryPoints] = useState<Point[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(wsUrl('stats', containerId));
    wsRef.current = ws;

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type !== 'stats') return;
        setLatest(msg);
        setPoints((prev) => {
          const next = [...prev, { time: new Date(msg.ts).toLocaleTimeString(), cpu: msg.cpuPercent, mem: msg.memPercent }];
          return next.slice(-30); // keep last 30 samples
        });
      } catch { /* ignore */ }
    };

    return () => ws.close();
  }, [containerId]);

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const { data } = await ContainerApi.metricsHistory(containerId);
      setHistoryPoints(
        data.map((row: any) => ({
          time: new Date(row.recorded_at + 'Z').toLocaleTimeString(),
          cpu: row.cpu_percent,
          mem: row.mem_percent,
        }))
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  function switchView(next: 'live' | 'history') {
    setView(next);
    if (next === 'history') loadHistory();
  }

  const data = view === 'live' ? points : historyPoints;

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ margin: 0 }}>Resource Usage</h4>
        <div>
          <button className={`btn ${view === 'live' ? '' : 'secondary'}`} onClick={() => switchView('live')}>Live</button>
          <button className={`btn ${view === 'history' ? '' : 'secondary'}`} onClick={() => switchView('history')}>History</button>
        </div>
      </div>
      {view === 'live' && latest && (
        <div style={{ display: 'flex', gap: 24, margin: '12px 0', fontSize: 13, color: 'var(--text-dim)' }}>
          <span>CPU: <strong style={{ color: 'var(--text)' }}>{latest.cpuPercent}%</strong></span>
          <span>Mem: <strong style={{ color: 'var(--text)' }}>{latest.memUsageMb} / {latest.memLimitMb} MB</strong></span>
          <span>Net RX: <strong style={{ color: 'var(--text)' }}>{(latest.netRxBytes / 1024).toFixed(1)} KB</strong></span>
          <span>Net TX: <strong style={{ color: 'var(--text)' }}>{(latest.netTxBytes / 1024).toFixed(1)} KB</strong></span>
        </div>
      )}
      {view === 'history' && historyLoading && <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>Loading history…</p>}
      {view === 'history' && !historyLoading && historyPoints.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>No history yet — samples are recorded every ~10s while the sandbox runs.</p>
      )}
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="time" stroke="var(--text-dim)" fontSize={11} />
          <YAxis stroke="var(--text-dim)" fontSize={11} domain={[0, 100]} />
          <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)' }} />
          <Legend />
          <Line type="monotone" dataKey="cpu" stroke="var(--accent)" name="CPU %" dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="mem" stroke="var(--green)" name="Mem %" dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
