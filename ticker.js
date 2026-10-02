import { subscribeQuotes, formatPrice, quoteState } from './market-data.js';

const monitor = document.querySelector('.monitor');
subscribeQuotes(quotes => {
 const spx = quotes.SP500;
 const value = spx ? formatPrice(spx.price, 'points') : '—';
 document.querySelector('#spx-price').textContent = value;
 document.querySelectorAll('[data-spx-price]').forEach(output => { output.textContent = value; });
 quoteState(monitor, spx);
});
