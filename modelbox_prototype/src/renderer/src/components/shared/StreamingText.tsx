import { useEffect, useState, useRef, forwardRef } from "react";

interface Props {
  text: string;
  className?: string;
}

export const StreamingText = forwardRef<HTMLSpanElement, Props>(
  function StreamingText({ text, className }, ref) {
    const [display, setDisplay] = useState(text);
    const [phase, setPhase] = useState<"idle" | "clearing" | "streaming">("idle");
    const prevTextRef = useRef(text);

    useEffect(() => {
      if (phase !== "idle") return;
      if (text === prevTextRef.current) return;

      prevTextRef.current = text;
      setPhase("clearing");
      setDisplay("");

      const clearTimer = setTimeout(() => {
        setPhase("streaming");
        let idx = 0;
        const stream = (): void => {
          if (idx < text.length) {
            setDisplay(text.slice(0, idx + 1));
            idx++;
            setTimeout(stream, 30);
          } else {
            setPhase("idle");
          }
        };
        stream();
      }, 150);

      return () => clearTimeout(clearTimer);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [text]);

    return (
      <span ref={ref} className={className}>
        {display}
      </span>
    );
  },
);
