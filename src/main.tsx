import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

// Safari's "Add to Dock" web app draws the page under a transparent title bar,
// so the header has to leave room for the window controls.
if (
  window.matchMedia?.('(display-mode: standalone)').matches &&
  /Macintosh/.test(navigator.userAgent) &&
  navigator.maxTouchPoints === 0
) {
  document.documentElement.classList.add('macos-web-app');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
