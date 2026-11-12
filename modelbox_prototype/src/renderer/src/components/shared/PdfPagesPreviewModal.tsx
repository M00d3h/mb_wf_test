import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useThemeStore } from '../../store/themeStore';
import { cn } from '../../lib/utils';

interface Props {
  name: string;
  pages: string[];
  onClose: () => void;
}

export function PdfPagesPreviewModal({ name, pages, onClose }: Props): JSX.Element {
  const { theme } = useThemeStore();

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className={cn(
          'flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl border',
          'max-h-[90vh]',
          theme === 'light'
            ? 'border-neutral-200 bg-white shadow-xl shadow-black/10'
            : 'border-zinc-700/60 bg-zinc-900/95 shadow-2xl shadow-black/50 ring-1 ring-inset ring-white/[0.06]',
        )}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={name}
      >
        {/* Header */}
        <div
          className={cn(
            'flex shrink-0 items-center gap-3 px-4 py-3 border-b',
            theme === 'light' ? 'border-neutral-200' : 'border-zinc-700/50',
          )}
        >
          <div className="min-w-0 flex-1">
            <h2
              className={cn(
                'truncate text-sm font-medium',
                theme === 'light' ? 'text-neutral-900' : 'text-zinc-100',
              )}
              title={name}
            >
              {name}
            </h2>
            <p
              className={cn(
                'mt-0.5 text-[11px] font-medium uppercase tracking-wide',
                theme === 'light' ? 'text-neutral-500' : 'text-zinc-500',
              )}
            >
              {pages.length} {pages.length === 1 ? 'page' : 'pages'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              'shrink-0 rounded-lg border p-1.5 transition-colors',
              theme === 'light'
                ? 'border-neutral-300 bg-neutral-100 text-neutral-600 hover:bg-neutral-200 hover:text-neutral-900'
                : 'border-zinc-700/60 bg-zinc-800/80 text-zinc-400 hover:bg-zinc-700/80 hover:text-zinc-100',
            )}
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable pages */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
          {pages.map((dataUrl, i) => (
            <div key={i} className="relative">
              <img
                src={dataUrl}
                alt={`Page ${i + 1}`}
                className="w-full rounded-lg object-contain shadow-md"
              />
              <span
                className={cn(
                  'absolute top-2 left-2 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                  theme === 'light'
                    ? 'bg-white/80 text-neutral-600 shadow-sm'
                    : 'bg-zinc-900/70 text-zinc-400',
                )}
              >
                {i + 1} / {pages.length}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
