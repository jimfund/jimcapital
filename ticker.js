(() => {
  const monitor = document.querySelector('.monitor');
  const price = document.querySelector('#spx-price');
  const change = document.querySelector('#spx-change');
  const time = document.querySelector('#spx-time');
  const tape = document.querySelectorAll('[data-ticker]');
  const number = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  let timer;
  let inFlight = false;

  const positiveNumber = (value) => {
    if (typeof value !== 'string' && typeof value !== 'number') return NaN;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : NaN;
  };

  const clearQuote = () => {
    monitor.dataset.state = 'offline';
    price.textContent = '—';
    change.textContent = '—';
    delete change.dataset.direction;
    time.textContent = '—';
    time.removeAttribute('datetime');
    tape.forEach((item) => { item.textContent = 'SPX · — · SPX · — ·'; });
  };

  async function refresh() {
    clearTimeout(timer);
    if (document.hidden || inFlight) return;
    inFlight = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'metaAndAssetCtxs', dex: 'xyz' }),
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(String(response.status));
      const [meta, contexts] = await response.json();
      const index = meta.universe.findIndex((asset) => asset.name === 'xyz:SP500' && !asset.isDelisted);
      const context = index >= 0 ? contexts[index] : undefined;
      const current = positiveNumber(context?.markPx);
      if (!Number.isFinite(current)) throw new Error();
      const previous = positiveNumber(context?.prevDayPx);
      const percent = (current / previous - 1) * 100;
      const formatted = number.format(current);

      price.textContent = formatted;
      change.textContent = Number.isFinite(percent)
        ? `${percent < 0 ? '−' : '+'}${number.format(Math.abs(percent))}% · 24h`
        : '—';
      change.dataset.direction = percent < 0 ? 'down' : 'up';
      tape.forEach((item) => { item.textContent = `SPX · ${formatted} · SPX · ${formatted} ·`; });
      const now = new Date();
      time.dateTime = now.toISOString();
      time.textContent = now.toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false }) + ' UTC';
      monitor.dataset.state = 'live';
    } catch {
      clearQuote();
    } finally {
      clearTimeout(timeout);
      inFlight = false;
      if (!document.hidden) timer = setTimeout(refresh, 15000);
    }
  }

  document.addEventListener('visibilitychange', () => {
    clearTimeout(timer);
    if (!document.hidden) {
      clearQuote();
      refresh();
    }
  });
  window.addEventListener('offline', clearQuote);
  window.addEventListener('online', refresh);
  refresh();
})();
