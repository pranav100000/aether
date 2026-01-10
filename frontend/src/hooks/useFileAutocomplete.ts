import { useState, useCallback, useRef } from "react"

interface Position {
  top: number
  left: number
}

interface UseFileAutocompleteReturn {
  isOpen: boolean
  query: string
  position: Position | null
  selectedIndex: number
  open: (position: Position, initialQuery?: string) => void
  close: () => void
  setQuery: (query: string) => void
  moveSelection: (direction: "up" | "down", maxItems: number) => void
  resetSelection: () => void
}

export function useFileAutocomplete(): UseFileAutocompleteReturn {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [position, setPosition] = useState<Position | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const triggerPositionRef = useRef<number | null>(null)

  const open = useCallback((pos: Position, initialQuery: string = "") => {
    setPosition(pos)
    setQuery(initialQuery)
    setSelectedIndex(0)
    setIsOpen(true)
  }, [])

  const close = useCallback(() => {
    setIsOpen(false)
    setQuery("")
    setPosition(null)
    setSelectedIndex(0)
    triggerPositionRef.current = null
  }, [])

  const moveSelection = useCallback((direction: "up" | "down", maxItems: number) => {
    setSelectedIndex(prev => {
      if (direction === "up") {
        return prev <= 0 ? maxItems - 1 : prev - 1
      } else {
        return prev >= maxItems - 1 ? 0 : prev + 1
      }
    })
  }, [])

  const resetSelection = useCallback(() => {
    setSelectedIndex(0)
  }, [])

  return {
    isOpen,
    query,
    position,
    selectedIndex,
    open,
    close,
    setQuery,
    moveSelection,
    resetSelection,
  }
}
