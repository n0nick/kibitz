import { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import { useKbz } from './ui';

const ICON_COPY = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const ICON_CHECK = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

export default function ReportViewer() {
  const { k } = useKbz();
  const [html, setHtml] = useState(null);
  const [markdown, setMarkdown] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const bodyRef = useRef(null);

  useEffect(() => {
    document.title = 'Flag Report · Kibitz';
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (!id) { setError('No report ID provided.'); return; }

    fetch(`/api/report/${encodeURIComponent(id)}`)
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.text(); })
      .then(md => { setMarkdown(md); setHtml(marked.parse(md)); })
      .catch(e => setError(`Failed to load report: ${e.message}`));
  }, []);

  const handleCopyMarkdown = async () => {
    if (!markdown) return;
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

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
    <div style={{
      minHeight: "100vh",
      background: k.bg,
      color: k.text,
      fontFamily: k.font.sans,
      padding: 24,
    }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{ marginBottom: 22, display: "flex", alignItems: "center", gap: 12 }}>
          <a
            href="/"
            style={{
              color: k.textMute, fontSize: 13, textDecoration: "none",
            }}
          >
            ← Kibitz
          </a>
          <span style={{ color: k.textDim }}>|</span>
          <span className="kbz-caps" style={{ fontSize: 11 }}>Bug report</span>
          {html && (
            <>
              <span style={{ color: k.textDim }}>|</span>
              <button
                onClick={handleCopyMarkdown}
                title="Copy markdown"
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  background: "none", border: "none", cursor: "pointer",
                  color: copied ? k.good : k.textMute, fontSize: 12,
                  padding: 0, fontFamily: k.font.sans,
                }}
              >
                <span dangerouslySetInnerHTML={{ __html: copied ? ICON_CHECK : ICON_COPY }} />
                {copied ? 'Copied!' : 'Copy markdown'}
              </button>
            </>
          )}
        </div>

        {error && (
          <div style={{ color: k.bad, fontSize: 13 }}>{error}</div>
        )}

        {!html && !error && (
          <div style={{ color: k.textMute, fontSize: 13, animation: "kbz-pulse 1.4s ease-in-out infinite" }}>
            Loading report…
          </div>
        )}

        {html && (
          <div
            ref={bodyRef}
            className="report-body"
            style={{
              fontSize: 14,
              color: k.text,
              lineHeight: 1.65,
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  );
}
