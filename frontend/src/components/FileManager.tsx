import React, { useEffect, useRef, useState } from 'react';
import { FileApi, FileEntry } from '../api';

export default function FileManager({ containerId }: { containerId: string }) {
  const [path, setPath] = useState('/');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function refresh(p = path) {
    setLoading(true);
    setError('');
    try {
      const { data } = await FileApi.list(containerId, p);
      setEntries(data.entries);
      setPath(data.path || '/');
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Could not load directory');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh('/'); }, [containerId]);

  function openDir(name: string) {
    const next = path === '/' ? `/${name}` : `${path}/${name}`;
    refresh(next);
  }

  function goUp() {
    if (path === '/') return;
    const parts = path.split('/').filter(Boolean);
    parts.pop();
    refresh(parts.length ? `/${parts.join('/')}` : '/');
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await FileApi.upload(containerId, path, file);
      refresh();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Upload failed');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleDelete(name: string) {
    const target = path === '/' ? `/${name}` : `${path}/${name}`;
    if (!confirm(`Delete ${target}? This cannot be undone.`)) return;
    try {
      await FileApi.remove(containerId, target);
      refresh();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Delete failed');
    }
  }

  async function handleNewFolder() {
    const name = prompt('New folder name:');
    if (!name) return;
    try {
      await FileApi.mkdir(containerId, path, name);
      refresh();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Could not create folder');
    }
  }

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h4 style={{ margin: 0 }}>Files — <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>{path}</span></h4>
        <div>
          <button className="btn secondary" onClick={handleNewFolder}>+ Folder</button>
          <button className="btn secondary" onClick={() => fileInputRef.current?.click()}>Upload</button>
          <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleUpload} />
        </div>
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13 }}>{error}</p>}
      {loading && <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>Loading…</p>}

      <table style={{ width: '100%', fontSize: 13 }}>
        <tbody>
          {path !== '/' && (
            <tr>
              <td colSpan={4} style={{ cursor: 'pointer', padding: '4px 0' }} onClick={goUp}>.. (up)</td>
            </tr>
          )}
          {entries.map((e) => (
            <tr key={e.name} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '6px 4px', cursor: e.isDir ? 'pointer' : 'default' }} onClick={() => e.isDir && openDir(e.name)}>
                {e.isDir ? '📁' : '📄'} {e.name}
              </td>
              <td style={{ color: 'var(--text-dim)', width: 90 }}>{e.isDir ? '' : formatSize(e.size)}</td>
              <td style={{ color: 'var(--text-dim)', width: 150 }}>
                {e.modifiedAt ? new Date(e.modifiedAt).toLocaleString() : ''}
              </td>
              <td style={{ width: 140, textAlign: 'right' }}>
                {!e.isDir && (
                  <a
                    className="btn secondary"
                    style={{ padding: '2px 8px', fontSize: 12, textDecoration: 'none', display: 'inline-block' }}
                    href={FileApi.downloadUrl(containerId, path === '/' ? `/${e.name}` : `${path}/${e.name}`)}
                  >
                    Download
                  </a>
                )}
                <button className="btn danger" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => handleDelete(e.name)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {!loading && entries.length === 0 && (
            <tr><td colSpan={4} style={{ color: 'var(--text-dim)', padding: '8px 0' }}>Empty directory.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
