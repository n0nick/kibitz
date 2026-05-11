import { useState } from 'react';
import { Flag, Loader, AlertCircle, CheckCircle } from 'lucide-react';

const GITHUB_ISSUES_URL = 'https://github.com/n0nick/kibitz/issues/new';

function fmtEval(v) {
  if (v == null) return '?';
  if (v >= 99) return '+M';
  if (v <= -99) return '-M';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
}

function isLichessId(gameId) {
  return gameId && gameId !== 'opera-1858' && !gameId.startsWith('pgn-');
}

async function storeReport(ctx) {
  const res = await fetch('/api/store-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ctx }),
  });
  if (!res.ok) throw new Error(`store-report ${res.status}`);
  const data = await res.json();
  return data.id;
}

function buildTitle(ctx) {
  let shortCtx;
  if (ctx.type === 'game-overview') {
    shortCtx = 'game overview';
  } else if (ctx.type === 'chat') {
    shortCtx = `chat move ${ctx.move ?? '?'}`;
  } else {
    shortCtx = `${ctx.classification} move ${ctx.move?.split(' ')[0] ?? '?'}`;
  }
  return `Flag: ${ctx.model} ${ctx.promptVersion} — ${shortCtx}`;
}

function buildFallbackBody(ctx) {
  const lines = ['*Report storage failed — key context below.*\n'];
  lines.push(`**Model:** ${ctx.model} ${ctx.promptVersion}`);
  if (isLichessId(ctx.gameId)) lines.push(`**Lichess:** https://lichess.org/${ctx.gameId}`);
  if (ctx.move) lines.push(`**Move:** ${ctx.move} (${ctx.classification}), eval ${fmtEval(ctx.evalBefore)} → ${fmtEval(ctx.evalAfter)}`);
  lines.push('\n**LLM response:**');
  lines.push((ctx.commentary ?? '').split('\n').map(l => `> ${l}`).join('\n'));
  return lines.join('\n');
}

export function FlagButton({ context }) {
  const [loading, setLoading] = useState(false);
  // 'idle' | 'ok' | 'warn'
  const [status, setStatus] = useState('idle');

  const handleClick = async () => {
    if (loading) return;
    setLoading(true);
    setStatus('idle');

    const ctx = { ...context, generatedAt: new Date().toISOString() };

    // Open the tab immediately (synchronous, in the user gesture) so popup
    // blockers don't fire. We navigate it once the report URL is ready.
    const win = window.open('', '_blank');

    const title = buildTitle(ctx);
    let issueBody;

    try {
      const reportId = await storeReport(ctx);
      const viewerUrl = `${window.location.origin}/report?id=${encodeURIComponent(reportId)}`;
      issueBody = `<!-- Describe what's wrong here -->\n\n[View full bug report](${viewerUrl})`;
      setStatus('ok');
    } catch {
      issueBody = buildFallbackBody(ctx);
      setStatus('warn');
    }

    setLoading(false);

    const url = `${GITHUB_ISSUES_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(issueBody)}&labels=feedback`;
    if (win) {
      win.location.href = url;
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }

    setTimeout(() => setStatus('idle'), 4000);
  };

  const icon = () => {
    if (loading) return <Loader size={12} className="animate-spin" />;
    if (status === 'ok') return <CheckCircle size={12} className="text-green-500" />;
    if (status === 'warn') return <AlertCircle size={12} className="text-yellow-500" />;
    return <Flag size={12} />;
  };

  const title = status === 'warn'
    ? 'Flag sent (report storage failed — partial context only)'
    : status === 'ok'
    ? 'Flag sent'
    : 'Flag this response';

  return (
    <button
      title={title}
      onClick={handleClick}
      disabled={loading}
      className="inline-flex items-center justify-center w-5 h-5 text-zinc-600 hover:text-zinc-400 disabled:opacity-50 transition-colors shrink-0"
    >
      {icon()}
    </button>
  );
}
