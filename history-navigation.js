export function historyUrl(symbol) {
 return `/graphs?${new URLSearchParams({ symbol, range: '1d' })}`;
}
export function mountHistoryNavigation(doc = document) {
 const editing = () => doc.body.classList.contains('editing') || new URL(doc.location.href).searchParams.get('edit') === '1';
 doc.addEventListener('click', event => {
  const target = event.target.closest('[data-history]');
  if (target && !editing()) doc.defaultView.location.assign(historyUrl(target.dataset.history));
 });
 doc.addEventListener('keydown', event => {
  const target = event.target.closest('[data-history][tabindex]');
  if (target && !editing() && (event.key === 'Enter' || event.key === ' ')) {
   event.preventDefault(); doc.defaultView.location.assign(historyUrl(target.dataset.history));
  }
 });
}
if (typeof document !== 'undefined') mountHistoryNavigation();
