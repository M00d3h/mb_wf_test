import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";
import { useThemeStore } from "../../store/themeStore";

const inputBaseCore =
  "rounded-lg border border-zinc-700/60 bg-zinc-800/80 px-2.5 py-1.5 text-sm text-zinc-100 transition-colors focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/20";

function useProfileInputBase(): string {
  const { theme } = useThemeStore();
  return cn(
    inputBaseCore,
    theme === "light" ? "shadow-none ring-1 ring-zinc-700/15" : "shadow-sm",
  );
}

/** Looks disabled while idle; input stays focusable (no `disabled` attr). */
export const idleUnsetLook =
  "cursor-pointer border-zinc-800/90 bg-zinc-950/85 text-zinc-500 placeholder:text-zinc-600 " +
  "ring-1 ring-inset ring-black/40 shadow-inner opacity-80";

/** Row: label + control as a centered pair with a fixed gap (no full-width spread). */
export function ProfileRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-center sm:gap-x-6 sm:gap-y-1">
      <div className="min-w-0 sm:w-[min(100%,14rem)] sm:shrink-0 sm:text-right">
        <p className="text-sm text-zinc-200">{label}</p>
        {hint ? (
          <p className="mt-0.5 text-xs leading-snug text-zinc-500 sm:text-right">
            {hint}
          </p>
        ) : null}
      </div>
      <div className="min-w-0 max-w-md shrink-0 sm:pt-0.5">{children}</div>
    </div>
  );
}

function Segmented<T>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { label: string; value: T }[];
  onChange: (v: T) => void;
}): JSX.Element {
  const { theme } = useThemeStore();
  return (
    <div className="inline-flex max-w-full flex-wrap rounded-lg bg-zinc-800/90 p-0.5 ring-1 ring-zinc-700/50">
      {options.map((o) => {
        const active = Object.is(value, o.value);
        return (
          <button
            key={String(o.label)}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "min-w-[2.75rem] rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? cn(
                    "bg-zinc-700 text-zinc-100",
                    theme === "light" ? "shadow-none" : "shadow-sm",
                  )
                : "text-zinc-500 hover:text-zinc-300",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Optional boolean: Default (omit) | On | Off — no checkbox. */
export function ProfileOptionalBool({
  value,
  onChange,
}: {
  value: boolean | undefined;
  onChange: (v: boolean | undefined) => void;
}): JSX.Element {
  return (
    <Segmented<boolean | undefined>
      value={value}
      onChange={onChange}
      options={[
        { label: "Default", value: undefined },
        { label: "On", value: true },
        { label: "Off", value: false },
      ]}
    />
  );
}

function clampNum(n: number, min?: number, max?: number): number {
  let x = n;
  if (min !== undefined) x = Math.max(min, x);
  if (max !== undefined) x = Math.min(max, x);
  return x;
}

/** When value is unset: strong idle look; click or tab to focus and type (no Set value). */
function ProfileOptionalNumberUnset({
  onChange,
  min,
  max,
  step,
  placeholder = "Server default",
  showSlider = true,
}: {
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  showSlider?: boolean;
}): JSX.Element {
  const inputBase = useProfileInputBase();
  const containerRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");

  const showSliderResolved =
    focused &&
    showSlider &&
    min !== undefined &&
    max !== undefined &&
    Number.isFinite(min) &&
    Number.isFinite(max);

  const draftNum = parseFloat(draft.replace(/,/g, ""));
  const sliderValue = !Number.isNaN(draftNum)
    ? clampNum(draftNum, min, max)
    : (min ?? 0);

  const commit = (currentDraft: string): void => {
    const t = currentDraft.trim();
    if (t === "") { onChange(undefined); return; }
    const n = parseFloat(t.replace(/,/g, ""));
    if (!Number.isNaN(n)) onChange(clampNum(n, min, max));
  };

  // Use container-level blur so moving focus to the slider doesn't collapse it.
  // relatedTarget is the element receiving focus; if it's still inside our container,
  // focus stayed within the control and we don't commit/hide yet.
  const handleContainerBlur = (e: React.FocusEvent<HTMLDivElement>): void => {
    if (containerRef.current?.contains(e.relatedTarget as Node)) return;
    commit(draft);
    setFocused(false);
    setDraft("");
  };

  return (
    <div
      ref={containerRef}
      onBlur={handleContainerBlur}
      className="flex w-full max-w-md flex-col items-stretch gap-2 sm:items-end"
    >
      <div className="flex w-full flex-wrap items-center justify-end gap-2">
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          placeholder={placeholder}
          onFocus={() => setFocused(true)}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          className={cn(
            inputBase,
            "w-[10rem] py-1.5 text-right tabular-nums",
            "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
            !focused && idleUnsetLook,
          )}
        />
      </div>
      {showSliderResolved && min !== undefined && max !== undefined && (
        // onMouseUp commits after drag ends without needing focus to leave the container.
        <div onMouseUp={() => commit(draft)}>
          <ProfileNumberSlider
            value={sliderValue}
            onChange={(v) => {
              if (v === undefined) return;
              setDraft(String(v));
            }}
            min={min}
            max={max}
            step={step}
          />
        </div>
      )}
    </div>
  );
}

/** Optional number: grey placeholder when omitted; slider when set (unless `showSlider` is false). */
export function ProfileOptionalNumber({
  value,
  onChange,
  min,
  max,
  step,
  placeholder = "Server default",
  showSlider = true,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  /** When false, no range control (e.g. port — type only). */
  showSlider?: boolean;
}): JSX.Element {
  const showSliderResolved =
    showSlider &&
    min !== undefined &&
    max !== undefined &&
    Number.isFinite(min) &&
    Number.isFinite(max);

  if (value === undefined) {
    return (
      <ProfileOptionalNumberUnset
        onChange={onChange}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        showSlider={showSlider}
      />
    );
  }

  return (
    <div className="flex w-full max-w-md flex-col items-stretch gap-2 sm:items-end">
      <div className="relative self-end">
        <OptionalNumberInput
          value={value}
          onChange={onChange}
          min={min}
          max={max}
          step={step}
        />
        <button
          type="button"
          onClick={() => onChange(undefined)}
          title="Reset to server default"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-500 transition-colors hover:bg-zinc-700/60 hover:text-zinc-300"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      {showSliderResolved && min !== undefined && max !== undefined && (
        <ProfileNumberSlider
          value={value}
          onChange={onChange}
          min={min}
          max={max}
          step={step}
        />
      )}
    </div>
  );
}

function ProfileNumberSlider({
  value,
  onChange,
  min,
  max,
  step,
}: {
  value: number;
  onChange: (v: number | undefined) => void;
  min: number;
  max: number;
  step?: number;
}): JSX.Element {
  const clamp = (n: number): number => clampNum(n, min, max);
  const span = max - min;
  const rangeStep =
    step !== undefined && step > 0
      ? step
      : span <= 0
        ? 1
        : span > 100_000
          ? Math.max(256, Math.floor(span / 1000))
          : span > 500
            ? Math.max(1, Math.floor(span / 500))
            : 1;

  return (
    <input
      type="range"
      min={min}
      max={max}
      step={rangeStep}
      value={clamp(value)}
      onChange={(e) => onChange(clamp(Number(e.target.value)))}
      className="h-2 w-full max-w-md cursor-pointer appearance-none rounded-lg bg-zinc-700/80 accent-cyan-500 sm:max-w-[20rem]"
    />
  );
}

function OptionalNumberInput({
  value,
  onChange,
  min,
  max,
  step: _step,
}: {
  value: number;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
}): JSX.Element {
  const inputBase = useProfileInputBase();
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const committedRef = useRef(value);

  useEffect(() => {
    committedRef.current = value;
    if (!focused) setDraft(String(value));
  }, [value, focused]);

  const clamp = (n: number): number => {
    let x = n;
    if (min !== undefined) x = Math.max(min, x);
    if (max !== undefined) x = Math.min(max, x);
    return x;
  };

  const commitNumber = (n: number): void => {
    const c = clamp(n);
    onChange(c);
    committedRef.current = c;
    setDraft(String(c));
  };

  const handleBlur = (): void => {
    setFocused(false);
    const t = draft.trim();
    if (t === "") {
      setDraft(String(committedRef.current));
      return;
    }
    const n = parseFloat(t.replace(/,/g, ""));
    if (Number.isNaN(n)) {
      setDraft(String(committedRef.current));
      return;
    }
    commitNumber(n);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={focused ? draft : String(value)}
      onFocus={() => {
        setFocused(true);
        setDraft(String(value));
      }}
      onChange={(e) => {
        // Don't clamp on each keystroke — allows clearing and multi-digit entry (e.g. port).
        setDraft(e.target.value);
      }}
      onBlur={handleBlur}
      className={cn(
        inputBase,
        "w-[10rem] shrink-0 py-1.5 pr-7 text-right tabular-nums",
        "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
      )}
    />
  );
}

/** Optional text: grey when omitted; click/type to set (no Set value). */
export function ProfileOptionalText({
  value,
  onChange,
  placeholder,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  placeholder?: string;
}): JSX.Element {
  const inputBase = useProfileInputBase();
  const [focused, setFocused] = useState(false);
  const showIdle = value === undefined && !focused;

  if (value === undefined) {
    return (
      <input
        type="text"
        value=""
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const t = e.target.value;
          onChange(t === "" ? undefined : t);
        }}
        placeholder={
          showIdle ? "Server default" : (placeholder ?? "Server default")
        }
        className={cn(
          inputBase,
          "w-full max-w-sm font-mono text-[13px]",
          showIdle && idleUnsetLook,
        )}
      />
    );
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-1.5 sm:items-end">
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cn(inputBase, "w-full max-w-sm font-mono text-[13px]")}
      />
      <button
        type="button"
        onClick={() => onChange(undefined)}
        className="self-end text-xs font-medium text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
      >
        Use default
      </button>
    </div>
  );
}

/** Optional select: Default + option list. */
export function ProfileOptionalSelect({
  value,
  onChange,
  options,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  options: { label: string; value: string }[];
}): JSX.Element {
  const segOptions: { label: string; value: string | undefined }[] = [
    { label: "Default", value: undefined },
    ...options.map((o) => ({ label: o.label, value: o.value })),
  ];

  return (
    <Segmented<string | undefined>
      value={value}
      onChange={onChange}
      options={segOptions}
    />
  );
}
