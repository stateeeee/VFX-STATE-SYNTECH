import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      /* 127.0.0.1, NOT the default "localhost".
         Vite resolves its client host at startup, and when that host is the
         literal string "localhost" it does a DNS lookup for it
         (getLocalhostAddressIfDiffersFromDNS, there to detect the Node 17+ IPv6
         ordering change). On a machine whose /etc/hosts has lost its
         `127.0.0.1 localhost` line that lookup throws ENOTFOUND and the dev
         server dies before it ever listens — which is what happened on the
         operator's Mac. An IP literal skips the lookup entirely; express still
         binds 0.0.0.0, so http://localhost:3000 keeps working in the browser. */
      host: '127.0.0.1',
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
