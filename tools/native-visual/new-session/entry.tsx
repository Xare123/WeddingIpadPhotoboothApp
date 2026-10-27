/** DEV-ONLY browser review of actual native Root JSX. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../../apps/ipad/App';

const banner = document.createElement('aside');
banner.id = 'new-session-fixture-banner';
banner.textContent = process.env.FACE_EFFECTS_VISUAL_FIXTURE === '1'
  ? 'UI fixture · Synthetic no-face/error port · Original and colour-only pixels · NOT native/Vision'
  : 'Browser visual fixture · actual native JSX with synthetic device adapters · not iOS · no real guest URL or SMS';
document.body.prepend(banner);
createRoot(document.getElementById('root')!).render(<App />);
