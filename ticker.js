import { subscribeQuotes, formatPrice, quoteState } from './market-data.js';

const monitor = document.querySelector('.monitor');
const softbank = document.querySelector('.softbank-tracker');
subscribeQuotes(quotes => {
 const spx = quotes.SP500, bank = quotes.SOFTBANK;
 const value = spx ? formatPrice(spx.price, 'points') : '—';
 document.querySelector('#spx-price').textContent = value;
 document.querySelectorAll('[data-spx-price]').forEach(output => { output.textContent = value; });
 document.querySelector('#softbank-price').textContent = bank ? formatPrice(bank.price, 'points') : '—';
 quoteState(monitor, spx);
 quoteState(softbank, bank);
});
