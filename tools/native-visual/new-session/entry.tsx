/** DEV-ONLY browser review of the actual five-shot native App JSX. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../../apps/ipad/App';

const banner = document.createElement('aside');
banner.id = 'new-session-fixture-banner';
banner.textContent = 'Browser visual fixture · actual native JSX with synthetic device adapters · not iOS · no real guest URL or SMS';
document.body.prepend(banner);
createRoot(document.getElementById('root')!).render(<App />);
