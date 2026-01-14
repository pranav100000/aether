interface StatusBadgeProps {
  status: string
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const config: Record<string, { color: string; dot: string; label: string }> = {
    stopped: {
      color: "bg-muted text-muted-foreground",
      dot: "bg-muted-foreground",
      label: "Stopped",
    },
    starting: {
      color: "bg-yellow-900/50 text-yellow-300",
      dot: "bg-yellow-500 animate-pulse",
      label: "Starting",
    },
    running: {
      color: "bg-green-900/50 text-green-300",
      dot: "bg-green-500",
      label: "Running",
    },
    stopping: {
      color: "bg-yellow-900/50 text-yellow-300",
      dot: "bg-yellow-500 animate-pulse",
      label: "Stopping",
    },
    error: {
      color: "bg-red-900/50 text-red-300",
      dot: "bg-red-500",
      label: "Error",
    },
  }

  const { color, dot, label } = config[status] || config.stopped

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${color}`}
    >
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      {label}
    </span>
  )
}
