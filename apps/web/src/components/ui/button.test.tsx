import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, vi } from "vitest"
import { Button } from "./button"

describe("Button", () => {
  it("renders children correctly", () => {
    render(<Button>Click me</Button>)
    expect(screen.getByRole("button")).toHaveTextContent("Click me")
  })

  it("calls onClick when clicked", async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(<Button onClick={onClick}>Click me</Button>)

    await user.click(screen.getByRole("button"))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("is disabled when disabled prop is true", () => {
    render(<Button disabled>Click me</Button>)
    expect(screen.getByRole("button")).toBeDisabled()
  })

  it("is disabled when loading prop is true", () => {
    render(<Button loading>Click me</Button>)
    expect(screen.getByRole("button")).toBeDisabled()
  })

  it("shows spinner when loading", () => {
    render(<Button loading>Click me</Button>)
    // Children should be replaced with spinner when loading
    expect(screen.queryByText("Click me")).not.toBeInTheDocument()
  })

  it("applies variant classes correctly", () => {
    const { rerender } = render(<Button variant="destructive">Delete</Button>)
    expect(screen.getByRole("button")).toHaveClass("bg-destructive")

    rerender(<Button variant="outline">Outline</Button>)
    expect(screen.getByRole("button")).toHaveClass("border")

    rerender(<Button variant="ghost">Ghost</Button>)
    expect(screen.getByRole("button")).toHaveClass("hover:bg-accent")
  })

  it("applies size classes correctly", () => {
    const { rerender } = render(<Button size="sm">Small</Button>)
    expect(screen.getByRole("button")).toHaveClass("h-9")

    rerender(<Button size="lg">Large</Button>)
    expect(screen.getByRole("button")).toHaveClass("h-11")

    rerender(<Button size="icon">Icon</Button>)
    expect(screen.getByRole("button")).toHaveClass("h-10", "w-10")
  })

  it("forwards ref correctly", () => {
    const ref = vi.fn()
    render(<Button ref={ref}>Click me</Button>)
    expect(ref).toHaveBeenCalled()
  })

  it("applies custom className", () => {
    render(<Button className="custom-class">Click me</Button>)
    expect(screen.getByRole("button")).toHaveClass("custom-class")
  })
})
