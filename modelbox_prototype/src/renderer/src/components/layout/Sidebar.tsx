import type { LucideIcon } from "lucide-react";
import { NavLink } from "react-router-dom";
import {
  BookOpen,
  Server,
  MessageSquare,
  Settings,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { useThemeStore } from "../../store/themeStore";
import { HfSidebarDownload } from "./HfSidebarDownload";
import huggingfaceColorIcon from "../../assets/huggingface-color.svg";

type NavItem =
  | { to: string; label: string; kind: "lucide"; icon: LucideIcon }
  | { to: string; label: string; kind: "svg"; src: string };

const navItems: NavItem[] = [
  { to: "/chat", kind: "lucide", icon: MessageSquare, label: "Chat" },
  { to: "/models", kind: "lucide", icon: BookOpen, label: "Models" },
  { to: "/server", kind: "lucide", icon: Server, label: "Server" },
  {
    to: "/huggingface",
    kind: "svg",
    src: huggingfaceColorIcon,
    label: "Hugging Face",
  },
  { to: "/settings", kind: "lucide", icon: Settings, label: "Settings" },
];

function NavButton({ item }: { item: NavItem }): JSX.Element {
  const theme = useThemeStore((s) => s.theme);
  return (
    <NavLink
      to={item.to}
      title={item.label}
      className={({ isActive }) =>
        cn(
          "flex items-center justify-center w-10 h-10 rounded-lg transition-colors",
          isActive
            ? cn(
                "bg-cyan-500/20",
                theme === "light" ? "text-black" : "text-cyan-400",
              )
            : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800",
        )
      }
    >
      {item.kind === "svg" ? (
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded bg-transparent">
          <img
            src={item.src}
            alt=""
            className="h-full w-full object-contain"
            draggable={false}
          />
        </span>
      ) : (
        <item.icon className="w-5 h-5" aria-hidden />
      )}
    </NavLink>
  );
}

export function Sidebar(): JSX.Element {
  const theme = useThemeStore((s) => s.theme);
  return (
    <aside
      className={cn(
        "relative z-20 flex w-14 shrink-0 flex-col items-center overflow-visible py-3 ring-1 ring-inset",
        theme === "light"
          ? "bg-zinc-900 ring-zinc-800/40"
          : "bg-zinc-900/40 ring-white/[0.05]",
      )}
    >
      <div className="flex flex-col items-center gap-1">
        {navItems.map((item) => (
          <NavButton key={item.to} item={item} />
        ))}
        <HfSidebarDownload />
      </div>
    </aside>
  );
}
