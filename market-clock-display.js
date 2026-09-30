export const displayStyles = ['classic', 'paper', 'lcd', 'flap', 'marble-flap'];

// All faces keep the same hierarchy and positions at the site's 150px clock size.
export function drawClockDisplay(ctx, rows, requestedStyle = 'classic', { overlay = false } = {}) {
  const style = displayStyles.includes(requestedStyle) ? requestedStyle : 'classic';
  const mechanical = style === 'marble-flap';
  const light = style === 'paper' || style === 'lcd' || mechanical;
  const ink = light ? '#101010' : '#ffffff';
  if (overlay) ctx.clearRect(0, 0, 1024, 1024);
  else {
    ctx.fillStyle = mechanical ? '#ededea' : style === 'paper' ? '#f5f4f0' : style === 'lcd' ? '#d3d6d0' : '#080808';
    ctx.fillRect(0, 0, 1024, 1024);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 2; i++) {
    const row = rows?.[i];
    const y = 235 + i * 390;
    const label = row?.countdownLabel || (i ? 'JP' : 'US');
    const countdown = row?.countdown || (row?.phase === 'unknown' ? 'UNKNOWN' : '…');
    ctx.fillStyle = ink;
    ctx.font = '600 92px "DejaVu Sans", Arial, sans-serif';
    ctx.fillText(label, 512, y, 820);
    if (overlay) continue;
    if (style === 'flap' || mechanical) {
      const width = Math.min(126, 760 / countdown.length);
      const left = 512 - width * countdown.length / 2;
      for (let j = 0; j < countdown.length; j++) {
        const x = left + j * width;
        ctx.fillStyle = '#242424';
        ctx.fillRect(x + 3, y + 57, width - 6, 175);
        ctx.fillStyle = '#fff';
        ctx.font = '700 153px "DejaVu Sans Mono", monospace';
        ctx.fillText(countdown[j], x + width / 2, y + 145, width - 10);
        ctx.fillStyle = '#080808';
        ctx.fillRect(x + 3, y + 145, width - 6, 3);
      }
    } else {
      if (style === 'lcd') {
        ctx.fillStyle = '#b7bbb4';
        ctx.fillRect(94, y + 49, 836, 187);
      }
      ctx.fillStyle = ink;
      ctx.font = style === 'paper' ? '700 174px "DejaVu Serif", Georgia, serif'
        : style === 'lcd' ? '700 164px "DejaVu Sans Mono", monospace'
        : '700 164px "DejaVu Sans", Arial, sans-serif';
      ctx.fillText(countdown, 512, y + 142, 760);
    }
  }
  ctx.fillStyle = style === 'paper' ? '#101010' : light ? '#73786f' : '#777777';
  ctx.fillRect(style === 'paper' ? 140 : 180, 512, style === 'paper' ? 744 : 664, style === 'paper' ? 6 : 3);
  if (style === 'paper') ctx.fillRect(140, 527, 744, 2);
}
