import { useState } from "react"
import { useNavigate } from "react-router-dom"
import type { Project } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "./StatusBadge"

interface ProjectCardProps {
  project: Project
  onDelete: (id: string) => Promise<void>
}

export function ProjectCard({ project, onDelete }: ProjectCardProps) {
  const navigate = useNavigate()
  const [deleting, setDeleting] = useState(false)

  const handleOpen = () => {
    navigate(`/projects/${project.id}`)
  }

  const handleDelete = async () => {
    if (
      !confirm(
        `Delete "${project.name}"? This will destroy the VM and cannot be undone.`
      )
    ) {
      return
    }

    setDeleting(true)
    try {
      await onDelete(project.id)
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete project")
    } finally {
      setDeleting(false)
    }
  }

  const formatDate = (date: string | undefined) => {
    if (!date) return "Never"
    const d = new Date(date)
    const now = new Date()
    const diff = now.getTime() - d.getTime()

    if (diff < 60000) return "Just now"
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`
    return `${Math.floor(diff / 86400000)} days ago`
  }

  return (
    <div className="bg-card border border-border rounded-lg p-4 hover:border-muted-foreground/50 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-medium">{project.name}</h3>
          {project.description && (
            <p className="text-sm text-muted-foreground mt-1">
              {project.description}
            </p>
          )}
        </div>
        <StatusBadge status={project.status} />
      </div>

      <p className="text-xs text-muted-foreground mb-4">
        Last accessed: {formatDate(project.last_accessed_at)}
      </p>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleOpen}>
          Open
        </Button>
        <Button size="sm" variant="danger" onClick={handleDelete} loading={deleting}>
          Delete
        </Button>
      </div>
    </div>
  )
}
