import { Routes, Route, Navigate } from "react-router-dom"
import { useAuth } from "@/hooks/useAuth"
import { AuthGuard } from "@/components/AuthGuard"
import { Layout } from "@/components/Layout"
import { Login } from "@/pages/Login"
import { Signup } from "@/pages/Signup"
import { Projects } from "@/pages/Projects"
import { Workspace } from "@/pages/Workspace"
import { Spinner } from "@/components/ui/spinner"

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
  )
}

export default App
