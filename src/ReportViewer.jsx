import { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';

const ICON_COPY = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const ICON_CHECK = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

export default function ReportViewer() {
  const [html, setHtml] = useState(null);
  const [error, setError] = useState(null);
  const bodyRef = useRef(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (!id) { setError('No report ID provided.'); return; }

    fetch(`/api/report/${encodeURIComponent(id)}`)
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.text(); })
      .then(md => setHtml(marked.parse(md)))
      .catch(e => setError(`Failed to load report: ${e.message}`));
  }, []);

  useEffect(() => {
    if (!html || !bodyRef.current) return;
    bodyRef.current.querySelectorAll('pre').forEach(pre => {
      if (pre.parentElement?.classList.contains('code-wrapper')) return;
      const wrapper = document.createElement('div');
      wrapper.className = 'code-wrapper';
      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.appendChild(pre);

      const btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.title = 'Copy to clipboard';
      btn.innerHTML = ICON_COPY;
      btn.addEventListener('click', async () => {
        const text = (pre.querySelector('code') ?? pre).textContent ?? '';
        await navigator.clipboard.writeText(text);
        btn.innerHTML = ICON_CHECK;
        btn.classList.add('copied');
        setTimeout(() => { btn.innerHTML = ICON_COPY; btn.classList.remove('copied'); }, 1500);
      });
      wrapper.appendChild(btn);
    });
  }, [html]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 max-w-3xl mx-auto">
      <div className="mb-6 flex items-center gap-3">
        <a href="/" className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors">← Kibitz</a>
        <span className="text-zinc-700">|</span>
        <span className="text-zinc-400 text-sm">Bug report</span>
      </div>

      {error && (
        <div className="text-red-400 text-sm">{error}</div>
      )}

      {!html && !error && (
        <div className="text-zinc-500 text-sm animate-pulse">Loading report…</div>
      )}

      {html && (
        <div
          ref={bodyRef}
          className="report-body text-sm text-zinc-200 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
