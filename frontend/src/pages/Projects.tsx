import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { ProjectCard } from "@/components/projects/ProjectCard"
import { CreateProjectModal } from "@/components/projects/CreateProjectModal"
import { useProjects } from "@/hooks/useProjects"
import type { HardwareConfig } from "@/lib/api"

export function Projects() {
  const { projects, loading, error, createProject, deleteProject, refresh } =
    useProjects()
  const [showCreate, setShowCreate] = useState(false)

  const handleCreate = async (name: string, description?: string, hardware?: HardwareConfig) => {
    await createProject({ name, description, hardware })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Your Projects</h1>
          <p className="text-muted-foreground mt-1">
            Create and manage your cloud development environments.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>New Project</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <div className="text-center py-12">
          <p className="text-destructive mb-4">{error}</p>
          <Button variant="secondary" onClick={refresh}>
            Try again
          </Button>
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-12 bg-card border border-border rounded-lg">
          <h3 className="text-lg font-medium mb-2">No projects yet</h3>
          <p className="text-muted-foreground mb-4">
            Create your first project to get started.
          </p>
          <Button onClick={() => setShowCreate(true)}>Create project</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onDelete={deleteProject}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  )
}
