/** DEV ONLY: actual native JSX rendered with RN-web and synthetic device adapters. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../apps/ipad/App';
import { fixtureMode } from './stubs';

const banner = document.createElement('aside');
banner.id = 'fixture-banner';
banner.textContent = `Visual review fixture — browser rendering, not iOS; no real guest URL or SMS · ${fixtureMode}`;
document.body.prepend(banner);
createRoot(document.getElementById('root')!).render(<App />);
