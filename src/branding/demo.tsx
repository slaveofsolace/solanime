import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrandDemo } from './BrandDemo';
createRoot(document.getElementById('branding-root')!).render(<StrictMode><BrandDemo /></StrictMode>);
