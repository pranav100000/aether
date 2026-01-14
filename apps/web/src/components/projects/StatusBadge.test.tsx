import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { StatusBadge } from "./StatusBadge"

describe("StatusBadge", () => {
  it("renders stopped status correctly", () => {
    render(<StatusBadge status="stopped" />)
    expect(screen.getByText("Stopped")).toBeInTheDocument()
  })

  it("renders running status correctly", () => {
    render(<StatusBadge status="running" />)
    expect(screen.getByText("Running")).toBeInTheDocument()
  })

  it("renders starting status correctly", () => {
    render(<StatusBadge status="starting" />)
    expect(screen.getByText("Starting")).toBeInTheDocument()
  })

  it("renders stopping status correctly", () => {
    render(<StatusBadge status="stopping" />)
    expect(screen.getByText("Stopping")).toBeInTheDocument()
  })

  it("renders error status correctly", () => {
    render(<StatusBadge status="error" />)
    expect(screen.getByText("Error")).toBeInTheDocument()
  })

  it("falls back to stopped for unknown status", () => {
    render(<StatusBadge status="unknown" />)
    expect(screen.getByText("Stopped")).toBeInTheDocument()
  })

  it("renders with correct styling for running status", () => {
    render(<StatusBadge status="running" />)
    const badge = screen.getByText("Running").closest("span")
    expect(badge).toHaveClass("bg-green-900/50", "text-green-300")
  })

  it("renders with correct styling for error status", () => {
    render(<StatusBadge status="error" />)
    const badge = screen.getByText("Error").closest("span")
    expect(badge).toHaveClass("bg-red-900/50", "text-red-300")
  })
})
