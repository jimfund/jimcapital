import { defineConfig } from 'vite';
import { sites } from '@openai/sites-vite-plugin';
import { cloudflare } from '@cloudflare/vite-plugin';
export default defineConfig({
 publicDir:'.site-public',
 environments:{client:{build:{rollupOptions:{input:{main:'index.html',graphs:'graphs.html'}}}}},
 plugins:[sites(),cloudflare({viteEnvironment:{name:'server'}})],
});
