import './i18nInit.ts';
import './theme.scss';
import { browserStorage } from './browserStorage.ts';
import { installDomHost } from '../../../src/app/host/dom.ts';

// The browser has ordinary DOM APIs, without plugin augmentation.
installDomHost({
  createCanvas(doc = document, size) {
    const canvas = doc.adoptNode(document.createElement('canvas'));
    if (size) { canvas.width = size.width; canvas.height = size.height; }
    return canvas;
  },
  createDiv(parent, cls) {
    const div = parent.ownerDocument.createElement('div');
    div.className = cls;
    parent.appendChild(div);
    return div;
  },
  ownerWindow(node) {
    const doc = node.ownerDocument ?? (node as Document);
    return doc.defaultView ?? window;
  },
  activeDocument: () => document,
});

// Loaded after the language is set: some shared modules call t() when they load.
/** Calls `wake` when the page turns visible and when the browser comes back online. */
function onPageWake(wake: () => void): () => void {
  const visible = (): void => { if (document.visibilityState === 'visible') wake(); };
  document.addEventListener('visibilitychange', visible);
  window.addEventListener('online', wake);
  return () => {
    document.removeEventListener('visibilitychange', visible);
    window.removeEventListener('online', wake);
  };
}

async function start(): Promise<void> {
  const [{ createRoot }, { t, getLocale }, { PlayApp }, { Session, tableCodeOf }, { loadLowPower, deviceEnv }, { openBrowserSocket }] = await Promise.all([
    import('react-dom/client'),
    import('../../../src/app/i18n/index.ts'),
    import('./app/PlayApp.tsx'),
    import('./app/session.ts'),
    import('./scene/lowPower.ts'),
    import('./net/browserSocket.ts'),
  ]);
  const language = getLocale();
  document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  document.title = t('onlinePlay.app.title');
  const storage = browserStorage();
  const secure = globalThis.crypto?.subtle !== undefined;
  const code = secure ? tableCodeOf(location.hash) : null;
  const session = code === null ? null : new Session({
    origin: location.origin, code, storage,
    open: openBrowserSocket,
    onWake: onPageWake,
    indexedDB: typeof indexedDB === 'undefined' ? null : indexedDB,
  });
  const container = document.getElementById('root');
  if (container) {
    createRoot(container).render(
      <PlayApp session={session} language={language} lowPower={loadLowPower(storage, deviceEnv())} storage={storage} secure={secure} reload={() => location.reload()} />,
    );
  }
}

void start();
