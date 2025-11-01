import type { MouseEvent } from 'react';

type WindowCommand = 'minimize' | 'maximize' | 'close';
const noDragStyle = { WebkitAppRegion: 'no-drag' } as const;

function runWindowCommand(command: WindowCommand, event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
  event.stopPropagation();

  const controls = window.electronAPI;
  if (command === 'minimize') void controls?.minimize?.();
  if (command === 'maximize') void controls?.maximize?.();
  if (command === 'close') void controls?.close?.();
}

export default function WindowTitleBar({ title = 'Sales Desktop' }: { title?: string }) {
  return (
    <div className="window-titlebar">
      <span className="window-titlebar__title">{title}</span>
      <div className="window-titlebar__controls" style={noDragStyle}>
        <button
          type="button"
          className="window-titlebar__button"
          style={noDragStyle}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => runWindowCommand('minimize', event)}
          title="最小化"
        >
          &#9472;
        </button>
        <button
          type="button"
          className="window-titlebar__button"
          style={noDragStyle}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => runWindowCommand('maximize', event)}
          title="最大化/还原"
        >
          &#9633;
        </button>
        <button
          type="button"
          className="window-titlebar__button window-titlebar__button--close"
          style={noDragStyle}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => runWindowCommand('close', event)}
          title="关闭"
        >
          &#10005;
        </button>
      </div>
    </div>
  );
}
