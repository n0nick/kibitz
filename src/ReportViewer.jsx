import { useEffect, useState } from 'react';
import { marked } from 'marked';

export default function ReportViewer() {
  const [html, setHtml] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (!id) { setError('No report ID provided.'); return; }

    fetch(`/api/report/${encodeURIComponent(id)}`)
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.text(); })
      .then(md => setHtml(marked.parse(md)))
      .catch(e => setError(`Failed to load report: ${e.message}`));
  }, []);

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
          className="report-body text-sm text-zinc-200 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
