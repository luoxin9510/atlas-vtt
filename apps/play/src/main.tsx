import './i18nInit.ts';
import './theme.scss';
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
async function start(): Promise<void> {
  const [{ createRoot }, { AppShell }] = await Promise.all([import('react-dom/client'), import('./ui/AppShell.tsx')]);
  const container = document.getElementById('root');
  if (container) createRoot(container).render(<AppShell />);
}

void start();
