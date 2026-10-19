import { createRoot } from 'react-dom/client';
import App from './App';
import Assets from './Assets';

createRoot(document.getElementById('app')).render(
  <>
    <h1>Remote standalone</h1>
    <App />
    <Assets />
  </>
);
