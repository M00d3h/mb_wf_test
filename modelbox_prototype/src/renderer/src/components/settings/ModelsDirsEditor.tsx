import { useEffect, useRef, useState } from "react";
import { FolderOpen, Plus, Trash2 } from "lucide-react";
import { cn } from "../../lib/utils";
import { useThemeStore } from "../../store/themeStore";
import { api } from "../../lib/ipc";
import { persistModelsDirs } from "@shared/appDefaults";

const INPUT_BASE =
  "w-full rounded-lg border border-zinc-700/60 bg-zinc-800/80 px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 transition-colors focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/20";

const DEBOUNCE_MS = 400;

type Props = {
  value: string[];
  onCommit: (dirs: string[]) => void;
  className?: string;
};

export function ModelsDirsEditor({
  value,
  onCommit,
  className,
}: Props): JSX.Element {
  const { theme } = useThemeStore();
  const inputClass = cn(
    INPUT_BASE,
    theme === "light" ? "shadow-none ring-1 ring-zinc-700/15" : "shadow-sm",
  );
  const [local, setLocal] = useState<string[]>(() => [...value]);
  const localRef = useRef(local);
  localRef.current = local;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocal((prev) => {
      const persisted = persistModelsDirs(prev);
      if (JSON.stringify(persisted) === JSON.stringify(value)) {
        return prev;
      }
      return [...value];
    });
  }, [value]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const schedulePersist = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      onCommit(persistModelsDirs(localRef.current));
    }, DEBOUNCE_MS);
  };

  const flushPersist = (): void => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    onCommit(persistModelsDirs(localRef.current));
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {local.map((dir, index) => {
        const isLast = index === local.length - 1;
        return (
          <div key={index} className="flex gap-1.5">
            <input
              value={dir}
              onChange={(e) => {
                const v = e.target.value;
                setLocal((prev) => {
                  const next = [...prev];
                  next[index] = v;
                  localRef.current = next;
                  return next;
                });
                schedulePersist();
              }}
              onBlur={flushPersist}
              className={cn(inputClass, "min-w-0 flex-1 font-mono text-[13px]")}
              spellCheck={false}
              placeholder="Path to models folder"
            />
            <button
              type="button"
              onClick={async () => {
                const path = await api.settings.pickDirectory();
                if (!path) return;
                if (timer.current) {
                  clearTimeout(timer.current);
                  timer.current = null;
                }
                setLocal((prev) => {
                  const next = [...prev];
                  next[index] = path;
                  localRef.current = next;
                  onCommit(persistModelsDirs(next));
                  return next;
                });
              }}
              className={cn(
                "shrink-0 rounded-lg border p-1.5 transition-colors",
                theme === "light"
                  ? "border-zinc-600/45 bg-zinc-800/50 text-zinc-500 hover:bg-zinc-800/75 hover:text-zinc-300"
                  : "border-zinc-700/60 bg-zinc-800/80 text-zinc-500 hover:bg-zinc-700/80 hover:text-zinc-300",
              )}
              title="Browse folder"
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </button>
            {isLast ? (
              <button
                type="button"
                onClick={() => {
                  flushPersist();
                  setLocal((prev) => {
                    const next = [...prev, ""];
                    localRef.current = next;
                    return next;
                  });
                }}
                className={cn(
                  "shrink-0 rounded-lg border p-1.5 text-zinc-500 transition-colors hover:border-cyan-500/40 hover:text-cyan-400",
                  theme === "light"
                    ? "border-zinc-600/45 bg-zinc-800/50 hover:bg-zinc-800/80"
                    : "border-zinc-700/60 bg-zinc-800/80 hover:bg-zinc-800",
                )}
                title="Add another directory"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {local.length > 1 ? (
              <button
                type="button"
                onClick={() => {
                  flushPersist();
                  setLocal((prev) => {
                    const next = prev.filter((_, i) => i !== index);
                    localRef.current = next;
                    onCommit(persistModelsDirs(next));
                    return next;
                  });
                }}
                className={cn(
                  "shrink-0 rounded-lg border p-1.5 text-zinc-500 transition-colors hover:border-red-500/40 hover:text-red-400",
                  theme === "light"
                    ? "border-zinc-600/45 bg-zinc-800/50 hover:bg-zinc-800/80"
                    : "border-zinc-700/60 bg-zinc-800/80 hover:bg-zinc-800",
                )}
                title="Remove directory"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
