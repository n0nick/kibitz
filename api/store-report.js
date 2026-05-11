import { put } from '@vercel/blob';

function fmtEval(v) {
  if (v == null) return '?';
  if (v >= 99) return '+M';
  if (v <= -99) return '-M';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
}

function fmtCp(cp) {
  if (cp == null) return '?';
  return `${cp >= 0 ? '+' : ''}${(cp / 100).toFixed(1)}`;
}

function isLichessId(gameId) {
  return gameId && gameId !== 'opera-1858' && !gameId.startsWith('pgn-');
}

function renderReport(ctx) {
  const lines = [];
  lines.push('## Auto-generated context\n');
  lines.push(`**Model:** ${ctx.model}`);
  lines.push(`**Prompt version:** ${ctx.promptVersion}`);
  lines.push(`**Generated at:** ${ctx.generatedAt}`);

  if (isLichessId(ctx.gameId)) {
    lines.push(`**Lichess game:** https://lichess.org/${ctx.gameId}`);
  }
  if (ctx.move) {
    lines.push(`**Move:** ${ctx.move} (ply ${ctx.ply})`);
    lines.push(`**Classification:** ${ctx.classification}`);
    lines.push(`**Eval:** ${fmtEval(ctx.evalBefore)} → ${fmtEval(ctx.evalAfter)}`);
  }

  lines.push('\n### LLM response that was flagged');
  lines.push((ctx.commentary ?? '').split('\n').map(l => `> ${l}`).join('\n'));

  if (ctx.fenBefore) {
    lines.push('\n### Position before the move (FEN)');
    lines.push(`\`${ctx.fenBefore}\``);
  }
  if (ctx.fenAfter) {
    lines.push('\n### Position after the move (FEN)');
    lines.push(`\`${ctx.fenAfter}\``);
  }

  const eng = ctx.engineData;
  if (eng && (eng.top_alternatives?.length > 0 || eng.refutation_pv?.length > 0)) {
    lines.push('\n### Engine data passed to the LLM');
    if (eng.top_alternatives?.length > 0) {
      lines.push('- Top alternatives (from position BEFORE the move):');
      eng.top_alternatives.forEach(alt => {
        if (!alt.san) return;
        const ev = alt.mate != null ? (alt.mate > 0 ? '+M' : '-M') : fmtCp(alt.eval_cp);
        const pv = alt.pv_san?.slice(1, 4).join(' ');
        lines.push(`  - ${alt.san} (${ev})${pv ? `: pv ${pv}` : ''}`);
      });
    }
    if (eng.refutation_pv?.length > 0) {
      lines.push(`- Refutation line (from position AFTER the move):\n  ${eng.refutation_pv.slice(0, 4).join(' ')}`);
    }
  }

  if (ctx.chatHistory?.length > 0) {
    lines.push('\n### Chat history\n<details>\n<summary>Click to expand</summary>\n');
    ctx.chatHistory.forEach(msg => {
      lines.push(`**${msg.role === 'user' ? 'User' : 'Coach'}:** ${msg.text}\n`);
    });
    lines.push('</details>');
  }

  if (ctx.pgn) {
    lines.push('\n### PGN (full game)\n<details>\n<summary>Click to expand</summary>\n');
    lines.push(`\`\`\`\n${ctx.pgn}\n\`\`\``);
    lines.push('\n</details>');
  }

  if (ctx.promptSentToLlm) {
    lines.push('\n### Full prompt sent to the LLM\n<details>\n<summary>Click to expand</summary>\n');
    lines.push(`\`\`\`\n${ctx.promptSentToLlm}\n\`\`\``);
    lines.push('\n</details>');
  } else {
    lines.push('\n### Full prompt sent to the LLM\n*(Not available — loaded from cache)*');
  }

  return lines.join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { ctx } = body ?? {};
  if (!ctx) return res.status(400).json({ error: 'Missing ctx' });

  const report = renderReport(ctx);
  const slug = ctx.move?.replace(/\s+/g, '-') ?? 'overview';
  const filename = `kibitz-${ctx.promptVersion}-${slug}-${Date.now()}.md`;

  const blob = await put(filename, report, {
    access: 'public',
    addRandomSuffix: true,
    contentType: 'text/markdown; charset=utf-8',
  });

  res.status(200).json({ id: blob.pathname });
}
