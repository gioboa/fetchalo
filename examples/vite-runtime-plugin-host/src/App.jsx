import React from 'react';
import RemoteApp from 'remote1/App';

const RemoteAssets = React.lazy(() => import('remote1/Assets'));

export default function App() {
  return (
    <>
      <h1>Vite runtime plugin host</h1>
      <RemoteApp />
      <React.Suspense fallback={null}>
        <RemoteAssets />
      </React.Suspense>
    </>
  );
}
