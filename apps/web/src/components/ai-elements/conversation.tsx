"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { useCallback, useEffect, useState } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

export type ConversationProps = ComponentProps<typeof StickToBottom>;

export const Conversation = ({ className, children, ...props }: ConversationProps) => {
  return (
    <StickToBottom
      className={cn("relative flex-1 overflow-y-hidden", className)}
      initial="smooth"
      resize="smooth"
      role="log"
      {...props}
    >
      {(context) => (
        <>
          {typeof children === "function" ? children(context) : children}
          <ConversationScrollShadows />
        </>
      )}
    </StickToBottom>
  );
};

// This component uses the StickToBottom context to determine shadow visibility
const ConversationScrollShadows = () => {
  const { isAtBottom, scrollRef } = useStickToBottomContext();
  const [isAtTop, setIsAtTop] = useState(true);

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const handleScroll = () => {
      setIsAtTop(scrollEl.scrollTop <= 10);
    };

    handleScroll(); // Initial check
    scrollEl.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollEl.removeEventListener("scroll", handleScroll);
  }, [scrollRef]);

  const showTopShadow = !isAtTop;
  const showBottomShadow = !isAtBottom;

  return (
    <>
      {/* Top shadow */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 z-10 h-16 bg-gradient-to-b from-zinc-950 via-zinc-950/50 to-transparent transition-opacity duration-300",
          showTopShadow ? "opacity-100" : "opacity-0"
        )}
        aria-hidden="true"
      />
      {/* Bottom shadow */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-24 bg-gradient-to-t from-zinc-950 via-zinc-950/50 to-transparent transition-opacity duration-300",
          showBottomShadow ? "opacity-100" : "opacity-0"
        )}
        aria-hidden="true"
      />
    </>
  );
};

export type ConversationContentProps = ComponentProps<typeof StickToBottom.Content>;

// Shared spacing constant for prompt input area (used by content padding and shadow positioning)
export const PROMPT_INPUT_HEIGHT = "8rem"; // 128px / pb-32

export const ConversationContent = ({ className, ...props }: ConversationContentProps) => (
  <StickToBottom.Content className={cn("flex flex-col", className)} {...props} />
);

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
      className
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div className="space-y-1">
          <h3 className="font-medium text-sm">{title}</h3>
          {description && <p className="text-muted-foreground text-sm">{description}</p>}
        </div>
      </>
    )}
  </div>
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  return (
    !isAtBottom && (
      <Button
        className={cn(
          "absolute bottom-36 left-[50%] z-[8] translate-x-[-50%] rounded-full",
          "glass text-zinc-400 hover:bg-zinc-800/90 hover:text-zinc-300",
          className
        )}
        onClick={handleScrollToBottom}
        size="icon"
        type="button"
        {...props}
      >
        <ArrowDownIcon className="size-4" />
      </Button>
    )
  );
};
