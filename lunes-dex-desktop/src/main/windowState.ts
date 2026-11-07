import fs from 'node:fs';
import path from 'node:path';
import { app, screen, type BrowserWindow, type Rectangle } from 'electron';

type WindowState = {
  bounds: Rectangle;
  maximized: boolean;
};

const DEFAULT_WIDTH = 1440;
const DEFAULT_HEIGHT = 900;

function stateFile(): string {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function isRect(v: unknown): v is Rectangle {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return ['x', 'y', 'width', 'height'].every(
    (k) => typeof r[k] === 'number' && Number.isFinite(r[k]),
  );
}

/** Returns saved bounds only if they are still visible on a connected display. */
export function loadWindowState(): WindowState {
  const fallback: WindowState = {
    bounds: { x: 0, y: 0, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
    maximized: false,
  };
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    const r = raw as Record<string, unknown>;
    if (!isRect(r.bounds)) return { ...fallback, bounds: centered() };
    const b = r.bounds;
    const visible = screen.getAllDisplays().some((d) => {
      const wa = d.workArea;
      return (
        b.x < wa.x + wa.width &&
        b.x + b.width > wa.x &&
        b.y < wa.y + wa.height &&
        b.y + b.height > wa.y
      );
    });
    return {
      bounds: visible ? b : centered(b.width, b.height),
      maximized: r.maximized === true,
    };
  } catch {
    return { ...fallback, bounds: centered() };
  }
}

function centered(width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT): Rectangle {
  const wa = screen.getPrimaryDisplay().workArea;
  const w = Math.min(width, wa.width);
  const h = Math.min(height, wa.height);
  return {
    x: Math.round(wa.x + (wa.width - w) / 2),
    y: Math.round(wa.y + (wa.height - h) / 2),
    width: w,
    height: h,
  };
}

/** Persists bounds (debounced) on move/resize and on close. */
export function trackWindowState(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | undefined;
  const save = (): void => {
    if (win.isDestroyed()) return;
    const state: WindowState = {
      bounds: win.getNormalBounds(),
      maximized: win.isMaximized(),
    };
    try {
      fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
      fs.writeFileSync(stateFile(), JSON.stringify(state));
    } catch {
      // Non-critical: ignore persistence errors.
    }
  };
  const debounced = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 500);
  };
  win.on('resize', debounced);
  win.on('move', debounced);
  win.on('maximize', debounced);
  win.on('unmaximize', debounced);
  win.on('close', () => {
    if (timer) clearTimeout(timer);
    save();
  });
}
