import { rename } from 'node:fs/promises';

// Sites serves matching static assets before the Worker. Keep the template
// off / and /index.html so those routes can add the current D1 snapshot.
await rename(new URL('../dist/client/index.html', import.meta.url), new URL('../dist/client/site-home.html', import.meta.url));
