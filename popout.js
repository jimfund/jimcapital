const button = document.querySelector('#popout-button');
const status = document.querySelector('#popout-status');
const params = new URLSearchParams(location.search);
const embedded = window.self !== window.top;

if (params.has('popout') || embedded || params.get('edit') === '1') {
  document.querySelector('.popout-tools').hidden = true;
}

let popup;
const supportsPinning = 'documentPictureInPicture' in window;
button.title = supportsPinning
  ? 'Keep jim.capital in an always-on-top window'
  : 'Open jim.capital in a separate window';

button.addEventListener('click', async () => {
  status.textContent = '';
  const existing = window.documentPictureInPicture?.window || popup;
  if (existing && !existing.closed) {
    existing.focus();
    return;
  }

  const url = new URL(location.href);
  url.searchParams.delete('edit');
  url.searchParams.set('popout', '1');

  if (!supportsPinning) {
    popup = window.open(url.href, 'jim-capital-popout', 'popup,width=640,height=480');
    if (!popup) status.textContent = 'Allow popups for this site, then try again.';
    return;
  }

  button.disabled = true;
  try {
    const pip = await window.documentPictureInPicture.requestWindow({ width: 640, height: 480 });
    pip.document.title = 'jim.capital';
    const style = pip.document.createElement('style');
    style.textContent = 'html, body { margin: 0; height: 100%; background: white; } iframe { display: block; width: 100%; height: 100%; border: 0; }';
    pip.document.head.append(style);
    const frame = pip.document.createElement('iframe');
    frame.title = 'jim.capital';
    frame.src = url.href;
    pip.document.body.append(frame);
    button.textContent = '↗ Show popout';
    status.textContent = 'Keep this tab open while using the popout.';
    pip.addEventListener('pagehide', () => {
      button.textContent = '↗ Pop out';
      status.textContent = '';
    }, { once: true });
  } catch {
    status.textContent = 'Could not open the popout. Please try again.';
  } finally {
    button.disabled = false;
  }
});
