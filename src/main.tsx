import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, Toasts, useApp } from './lib/app';
import { currentView } from './lib/platform';
import { Launcher } from './views/Launcher';
import { MainWindow } from './views/MainWindow';
import { QuickAdd } from './views/QuickAdd';
import './styles.css';

const view = currentView();
document.documentElement.dataset.view = view;

/** Theme for the small windows (the main window applies it itself). */
function ThemeSync() {
  const { settings } = useApp();
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);
  return null;
}

// Disable the browser context menu / reload shortcuts in the packaged app so it feels native.
if (!import.meta.env.DEV) {
  window.addEventListener('contextmenu', (e) => {
    const t = e.target as HTMLElement;
    if (!t.closest('input, textarea, pre, code')) e.preventDefault();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F5' || (e.ctrlKey && e.key.toLowerCase() === 'r')) e.preventDefault();
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider primary={view === 'main'}>
      <ThemeSync />
      {view === 'launcher' ? <Launcher /> : view === 'quickadd' ? <QuickAdd /> : <MainWindow />}
      <Toasts />
    </AppProvider>
  </StrictMode>,
);
