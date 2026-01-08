import { Outlet, Link, useNavigate } from "react-router-dom"
import { useAuth } from "@/hooks/useAuth"
import {
  Dropdown,
  DropdownTrigger,
  DropdownContent,
  DropdownItem,
  DropdownSeparator,
} from "@/components/ui/dropdown"
import { LogOut, Settings } from "lucide-react"

export function Layout() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate("/login")
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <Link to="/" className="text-xl font-bold">
            Aether
          </Link>

          {user && (
            <Dropdown>
              <DropdownTrigger>{user.email}</DropdownTrigger>
              <DropdownContent>
                <DropdownItem onClick={() => navigate("/settings")}>
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </DropdownItem>
                <DropdownSeparator />
                <DropdownItem onClick={handleSignOut} destructive>
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownItem>
              </DropdownContent>
            </Dropdown>
          )}
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
