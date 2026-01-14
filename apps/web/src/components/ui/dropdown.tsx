import * as React from "react"
import { cn } from "@/lib/utils"

interface DropdownProps {
  children: React.ReactNode
}

interface DropdownContextValue {
  open: boolean
  setOpen: (open: boolean) => void
}

const DropdownContext = React.createContext<DropdownContextValue | null>(null)

function useDropdown() {
  const context = React.useContext(DropdownContext)
  if (!context) {
    throw new Error("Dropdown components must be used within a Dropdown")
  }
  return context
}

export function Dropdown({ children }: DropdownProps) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  return (
    <DropdownContext.Provider value={{ open, setOpen }}>
      <div ref={ref} className="relative inline-block">
        {children}
      </div>
    </DropdownContext.Provider>
  )
}

interface DropdownTriggerProps {
  children: React.ReactNode
  className?: string
}

export function DropdownTrigger({ children, className }: DropdownTriggerProps) {
  const { open, setOpen } = useDropdown()

  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      className={cn(
        "flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors",
        className
      )}
    >
      {children}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn("transition-transform", open && "rotate-180")}
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  )
}

interface DropdownContentProps {
  children: React.ReactNode
  className?: string
  align?: "left" | "right"
}

export function DropdownContent({ children, className, align = "right" }: DropdownContentProps) {
  const { open } = useDropdown()

  if (!open) return null

  return (
    <div
      className={cn(
        "absolute top-full mt-1 z-50 min-w-[160px] rounded-md border bg-popover p-1 shadow-md",
        align === "right" ? "right-0" : "left-0",
        className
      )}
    >
      {children}
    </div>
  )
}

interface DropdownItemProps {
  children: React.ReactNode
  onClick?: () => void
  className?: string
  destructive?: boolean
}

export function DropdownItem({ children, onClick, className, destructive }: DropdownItemProps) {
  const { setOpen } = useDropdown()

  const handleClick = () => {
    onClick?.()
    setOpen(false)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "flex w-full items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors",
        destructive
          ? "text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
          : "hover:bg-accent hover:text-accent-foreground",
        className
      )}
    >
      {children}
    </button>
  )
}

export function DropdownSeparator() {
  return <div className="my-1 h-px bg-border" />
}
