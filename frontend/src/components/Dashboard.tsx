import React, { useEffect, useState } from 'react';
import { ContainerApi, TemplateApi, SandboxContainer, Template } from '../api';
import ContainerCard from './ContainerCard';

export default function Dashboard() {
  const [containers, setContainers] = useState<SandboxContainer[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  async function refresh() {
    const { data } = await ContainerApi.list();
    setContainers(data);
  }

  useEffect(() => {
    refresh();
    TemplateApi.list().then(({ data }) => {
      setTemplates(data);
      if (data.length) setSelectedTemplate(data[0].key);
    });
    const interval = setInterval(refresh, 5000); // poll list for status changes
    return () => clearInterval(interval);
  }, []);

  async function createContainer(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await ContainerApi.create(selectedTemplate, name || undefined);
      setName('');
      await refresh();
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <h2><span className="prompt">$</span> ./dashboard --list-sandboxes</h2>
      <form className="card" onSubmit={createContainer} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label>Template</label>
          <select value={selectedTemplate} onChange={(e) => setSelectedTemplate(e.target.value)}>
            {templates.map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label>Name (optional)</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-sandbox" />
        </div>
        <button className="btn" type="submit" disabled={creating} style={{ height: 40 }}>
          {creating ? 'Launching…' : '+ Launch Sandbox'}
        </button>
      </form>

      <div className="grid">
        {containers.map((c) => (
          <ContainerCard key={c.id} c={c} onChange={refresh} />
        ))}
      </div>
      {containers.length === 0 && <p style={{ color: 'var(--text-dim)' }}>-- no sandboxes running, launch one above --</p>}
    </div>
  );
}
