import * as Sentry from "@sentry/react"
import { Routes, Route, Navigate } from "react-router-dom"
import { useAuth } from "@/hooks/useAuth"
import { AuthGuard } from "@/components/AuthGuard"
import { Layout } from "@/components/Layout"
import { Login } from "@/pages/Login"
import { Signup } from "@/pages/Signup"
import { Projects } from "@/pages/Projects"
import { Workspace } from "@/pages/Workspace"
import { Settings } from "@/pages/Settings"
import { Spinner } from "@/components/ui/spinner"
import { Button } from "@/components/ui/button"

function ErrorFallback() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="text-muted-foreground">An unexpected error occurred.</p>
      <Button onClick={() => window.location.reload()}>Reload page</Button>
    </div>
  )
}

function App() {
  const { loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route
          path="/"
          element={
            <AuthGuard>
              <Layout />
            </AuthGuard>
          }
        >
          <Route index element={<Projects />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route
          path="/projects/:id"
          element={
            <AuthGuard>
              <Workspace />
            </AuthGuard>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Sentry.ErrorBoundary>
  )
}

export default App
