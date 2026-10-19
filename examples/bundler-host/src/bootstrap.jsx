import React from 'react';
import { createRoot } from 'react-dom/client';
import RemoteApp from 'remote1/App';

const RemoteAssets = React.lazy(() => import('remote1/Assets'));

createRoot(document.getElementById('app')).render(
  <>
    <h1>{__HOST_TITLE__}</h1>
    <RemoteApp />
    <React.Suspense fallback={null}>
      <RemoteAssets />
    </React.Suspense>
  </>
);
