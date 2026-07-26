import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { wsUrl } from '../api';

export default function TerminalPanel({ containerId }: { containerId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      theme: {
        background: '#000000',
        foreground: '#39ff14',
        cursor: '#39ff14',
        cursorAccent: '#000000',
        selectionBackground: '#39ff1440',
        black: '#000000',
        green: '#39ff14',
        brightGreen: '#7dff5c',
        cyan: '#2de8ff',
        red: '#ff3b3b',
        yellow: '#ffd23f',
      },
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      fontSize: 14,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    term.writeln('Connecting to sandbox...');

    const ws = new WebSocket(wsUrl('exec', containerId));
    wsRef.current = ws;

    ws.onopen = () => {
      term.clear();
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };
    ws.onmessage = (evt) => {
      const data = typeof evt.data === 'string' ? evt.data : '';
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'error') term.writeln(`\r\n[error] ${parsed.message}`);
        if (parsed.type === 'exit') term.writeln('\r\n[session ended]');
        return;
      } catch {
        term.write(data);
      }
    };
    ws.onerror = () => term.writeln('\r\n[connection error]');
    ws.onclose = () => term.writeln('\r\n[disconnected]');

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    const handleResize = () => {
      fit.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      ws.close();
      term.dispose();
    };
  }, [containerId]);

  return <div className="terminal-container" ref={containerRef} />;
}
