import { Eye, EyeOff } from "lucide-react";
import { cn } from "../../lib/utils";
import { useChatStore } from "../../store/chatStore";
import { useThemeStore } from "../../store/themeStore";

interface TempChatToggleProps {
  conversationId: string | null;
}

const TempChatToggle: React.FC<TempChatToggleProps> = ({
  conversationId: _conversationId,
}) => {
  const {
    isTempChat,
    toggleTempChat,
    saveTempChat,
    streaming,
    draftMessages,
  } = useChatStore();
  const isLight = useThemeStore((s) => s.theme === "light");

  const handleToggle = async () => {
    if (isTempChat) {
      // Empty: turns off temp flags only. With messages: saves to DB as a normal chat.
      await saveTempChat();
    } else {
      toggleTempChat();
    }
  };

  const hasMessages = draftMessages.length > 0;

  return (
    <button
      onClick={handleToggle}
      disabled={streaming}
      className={cn(
        "p-2 rounded transition-colors",
        streaming
          ? "cursor-default opacity-40 text-gray-400"
          : isTempChat
            ? "text-yellow-500"
            : "text-gray-400",
        !streaming &&
          (isTempChat
            ? isLight
              ? "hover:bg-amber-400/15 hover:text-amber-700"
              : "hover:bg-amber-500/15 hover:text-amber-300"
            : isLight
              ? "hover:bg-cyan-500/12 hover:text-cyan-700"
              : "hover:bg-cyan-500/15 hover:text-cyan-300"),
      )}
      title={
        streaming
          ? "Cannot change while streaming"
          : isTempChat
            ? hasMessages
              ? "Temp chat — click to save to sidebar (turn off temp)"
              : "Turn off temp mode (draft stays empty, not saved yet)"
            : "Enable temp chat"
      }
    >
      {isTempChat ? <EyeOff size={18} /> : <Eye size={18} />}
    </button>
  );
};

export default TempChatToggle;
