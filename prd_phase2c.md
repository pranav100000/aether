# Phase 2c PRD: Frontend Foundation

**Project:** aether
**Phase:** 2c of 2a-2d
**Depends on:** Phase 2a (Supabase configured)
**Goal:** Set up React frontend with authentication flow

---

## Overview

Phase 2c establishes the frontend application with authentication. By the end of this phase:

1. React + Vite + TypeScript + Tailwind project is set up
2. Supabase client is configured
3. Users can sign up with email/password
4. Users can log in and log out
5. Auth state persists across page refreshes
6. Protected routes redirect unauthenticated users

This phase focuses on auth only. Project features come in Phase 2d.

---

## Success Criteria

| Criteria | Target |
|----------|--------|
| Sign up | New user can create account |
| Log in | Existing user can authenticate |
| Log out | User can sign out |
| Session persistence | Refresh page stays logged in |
| Protected routes | Unauthenticated → redirect to login |
| Auth errors | Clear error messages |

---

## Prerequisites

- Phase 2a complete (Supabase project with auth configured)
- Supabase URL and anon key available
- Node.js 18+ installed

---

## Technical Requirements

### 1. Project Setup

Initialize the frontend project:

```bash
cd /path/to/aether
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
```

**Install dependencies:**

```bash
# Core
npm install react-router-dom @supabase/supabase-js

# Styling
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p

# Terminal (for Phase 2d, install now)
npm install xterm xterm-addon-fit xterm-addon-webgl
```

**Configure Tailwind:**

`frontend/tailwind.config.js`:
```js
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Custom colors if needed
      },
    },
  },
  plugins: [],
}
```

`frontend/src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Custom styles */
body {
  @apply bg-gray-950 text-gray-100;
}
```

**Environment variables:**

`frontend/.env`:
```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_API_URL=http://localhost:8080
```

`frontend/.env.example`:
```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_API_URL=http://localhost:8080
```

---

### 2. File Structure

```
frontend/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── .env
├── .env.example
└── src/
    ├── main.tsx              # Entry point
    ├── App.tsx               # Router setup
    ├── vite-env.d.ts
    │
    ├── lib/
    │   ├── supabase.ts       # Supabase client
    │   └── api.ts            # Backend API client (stub for 2d)
    │
    ├── hooks/
    │   └── useAuth.ts        # Auth state management
    │
    ├── components/
    │   ├── ui/
    │   │   ├── Button.tsx
    │   │   ├── Input.tsx
    │   │   └── Spinner.tsx
    │   ├── auth/
    │   │   ├── AuthForm.tsx      # Login/signup form
    │   │   └── AuthGuard.tsx     # Route protection
    │   └── layout/
    │       └── Layout.tsx        # App shell
    │
    ├── pages/
    │   ├── Login.tsx
    │   ├── Signup.tsx
    │   └── Projects.tsx      # Placeholder for 2d
    │
    └── styles/
        └── globals.css
```

---

### 3. Supabase Client

`frontend/src/lib/supabase.ts`:

```typescript
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
})
```

---

### 4. Auth Hook

`frontend/src/hooks/useAuth.ts`:

```typescript
import { useState, useEffect, useCallback, createContext, useContext, ReactNode } from 'react'
import { User, Session, AuthError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

interface AuthState {
  user: User | null
  session: Session | null
  loading: boolean
}

interface AuthContextType extends AuthState {
  signUp: (email: string, password: string) => Promise<{ error: AuthError | null }>
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: true,
  })

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setState({
        user: session?.user ?? null,
        session,
        loading: false,
      })
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setState({
          user: session?.user ?? null,
          session,
          loading: false,
        })
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
    })
    return { error }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    return { error }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  return (
    <AuthContext.Provider value={{ ...state, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
```

---

### 5. UI Components

`frontend/src/components/ui/Button.tsx`:

```typescript
import { ButtonHTMLAttributes, forwardRef } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'primary', size = 'md', loading, disabled, children, ...props }, ref) => {
    const baseStyles = 'inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-950 disabled:opacity-50 disabled:cursor-not-allowed'

    const variants = {
      primary: 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500',
      secondary: 'bg-gray-700 hover:bg-gray-600 text-gray-100 focus:ring-gray-500',
      danger: 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500',
    }

    const sizes = {
      sm: 'px-3 py-1.5 text-sm',
      md: 'px-4 py-2 text-sm',
      lg: 'px-6 py-3 text-base',
    }

    return (
      <button
        ref={ref}
        className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <svg className="animate-spin -ml-1 mr-2 h-4 w-4\" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        )}
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'
```

`frontend/src/components/ui/Input.tsx`:

```typescript
import { InputHTMLAttributes, forwardRef } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', label, error, id, ...props }, ref) => {
    return (
      <div className="space-y-1">
        {label && (
          <label htmlFor={id} className="block text-sm font-medium text-gray-300">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={id}
          className={`
            block w-full px-3 py-2 bg-gray-800 border rounded-lg
            text-gray-100 placeholder-gray-500
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
            disabled:opacity-50 disabled:cursor-not-allowed
            ${error ? 'border-red-500' : 'border-gray-700'}
            ${className}
          `}
          {...props}
        />
        {error && (
          <p className="text-sm text-red-400">{error}</p>
        )}
      </div>
    )
  }
)

Input.displayName = 'Input'
```

`frontend/src/components/ui/Spinner.tsx`:

```typescript
interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function Spinner({ size = 'md', className = '' }: SpinnerProps) {
  const sizes = {
    sm: 'h-4 w-4',
    md: 'h-8 w-8',
    lg: 'h-12 w-12',
  }

  return (
    <svg
      className={`animate-spin ${sizes[size]} ${className}`}
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}
```

---

### 6. Auth Components

`frontend/src/components/auth/AuthForm.tsx`:

```typescript
import { useState, FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'

interface AuthFormProps {
  mode: 'login' | 'signup'
  onSubmit: (email: string, password: string) => Promise<{ error: Error | null }>
}

export function AuthForm({ mode, onSubmit }: AuthFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error } = await onSubmit(email, password)

    if (error) {
      setError(error.message)
      setLoading(false)
    }
    // If successful, auth state change will trigger redirect
  }

  const isLogin = mode === 'login'

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-white">
          {isLogin ? 'Welcome back' : 'Create your account'}
        </h1>
        <p className="mt-2 text-gray-400">
          {isLogin ? "Sign in to your account" : "Get started with aether"}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">
            {error}
          </div>
        )}

        <Input
          id="email"
          type="email"
          label="Email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />

        <Input
          id="password"
          type="password"
          label="Password"
          placeholder={isLogin ? "Your password" : "Create a password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete={isLogin ? "current-password" : "new-password"}
          minLength={6}
        />

        <Button
          type="submit"
          className="w-full"
          loading={loading}
        >
          {isLogin ? 'Sign in' : 'Create account'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-400">
        {isLogin ? (
          <>
            Don't have an account?{' '}
            <Link to="/signup" className="text-blue-400 hover:text-blue-300">
              Sign up
            </Link>
          </>
        ) : (
          <>
            Already have an account?{' '}
            <Link to="/login" className="text-blue-400 hover:text-blue-300">
              Sign in
            </Link>
          </>
        )}
      </p>
    </div>
  )
}
```

`frontend/src/components/auth/AuthGuard.tsx`:

```typescript
import { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { Spinner } from '../ui/Spinner'

interface AuthGuardProps {
  children: ReactNode
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  if (!user) {
    // Redirect to login, but save the attempted URL
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}
```

---

### 7. Layout Component

`frontend/src/components/layout/Layout.tsx`:

```typescript
import { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Header */}
      <header className="border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link to="/projects" className="flex items-center space-x-2">
              <span className="text-xl font-bold text-white">aether</span>
            </Link>

            {/* User menu */}
            {user && (
              <div className="flex items-center space-x-4">
                <span className="text-sm text-gray-400">{user.email}</span>
                <Button variant="secondary" size="sm" onClick={handleSignOut}>
                  Sign out
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  )
}
```

---

### 8. Pages

`frontend/src/pages/Login.tsx`:

```typescript
import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { AuthForm } from '../components/auth/AuthForm'

export function Login() {
  const { user, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // Redirect if already logged in
  useEffect(() => {
    if (user) {
      const from = (location.state as any)?.from?.pathname || '/projects'
      navigate(from, { replace: true })
    }
  }, [user, navigate, location])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
      <AuthForm mode="login" onSubmit={signIn} />
    </div>
  )
}
```

`frontend/src/pages/Signup.tsx`:

```typescript
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { AuthForm } from '../components/auth/AuthForm'

export function Signup() {
  const { user, signUp } = useAuth()
  const navigate = useNavigate()

  // Redirect if already logged in
  useEffect(() => {
    if (user) {
      navigate('/projects', { replace: true })
    }
  }, [user, navigate])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
      <AuthForm mode="signup" onSubmit={signUp} />
    </div>
  )
}
```

`frontend/src/pages/Projects.tsx` (placeholder for Phase 2d):

```typescript
import { Layout } from '../components/layout/Layout'

export function Projects() {
  return (
    <Layout>
      <div className="text-center py-12">
        <h1 className="text-2xl font-bold text-white mb-4">Your Projects</h1>
        <p className="text-gray-400">Project list will be implemented in Phase 2d.</p>
      </div>
    </Layout>
  )
}
```

---

### 9. App Router

`frontend/src/App.tsx`:

```typescript
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './hooks/useAuth'
import { AuthGuard } from './components/auth/AuthGuard'
import { Login } from './pages/Login'
import { Signup } from './pages/Signup'
import { Projects } from './pages/Projects'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />

          {/* Protected routes */}
          <Route
            path="/projects"
            element={
              <AuthGuard>
                <Projects />
              </AuthGuard>
            }
          />

          {/* Redirect root to projects */}
          <Route path="/" element={<Navigate to="/projects" replace />} />

          {/* 404 */}
          <Route path="*" element={<Navigate to="/projects" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
```

`frontend/src/main.tsx`:

```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

---

### 10. TypeScript Configuration

`frontend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,

    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",

    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,

    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

---

## Testing Plan

### Manual Testing Steps

1. **Start the frontend:**
   ```bash
   cd frontend
   npm run dev
   ```

2. **Test signup:**
   - Navigate to http://localhost:5173/signup
   - Enter email and password
   - Submit form
   - Verify redirect to /projects
   - Check Supabase dashboard for new user

3. **Test logout:**
   - Click "Sign out" in header
   - Verify redirect to /login
   - Verify protected routes redirect to login

4. **Test login:**
   - Navigate to http://localhost:5173/login
   - Enter credentials from signup
   - Verify redirect to /projects

5. **Test session persistence:**
   - While logged in, refresh the page
   - Verify still logged in (not redirected to login)

6. **Test auth guard:**
   - Log out
   - Try to navigate directly to /projects
   - Verify redirect to /login

7. **Test error handling:**
   - Try login with wrong password
   - Verify error message appears
   - Try signup with invalid email
   - Verify error message appears

---

## Definition of Done

Phase 2c is complete when:

1. [ ] Vite + React + TypeScript project builds without errors
2. [ ] Tailwind CSS is configured and working
3. [ ] Supabase client connects successfully
4. [ ] User can sign up with email/password
5. [ ] User can log in with email/password
6. [ ] User can log out
7. [ ] Session persists across page refresh
8. [ ] Protected routes redirect unauthenticated users
9. [ ] Auth errors display clearly
10. [ ] Placeholder projects page exists for Phase 2d

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Supabase env vars wrong | Double-check copy/paste, test connection |
| Session not persisting | Verify Supabase config has persistSession: true |
| CORS issues | Supabase handles auth CORS automatically |
| TypeScript errors | Run tsc before testing |

---

## Notes

- Email confirmation is disabled for development - enable in production
- GitHub OAuth can be added later in Supabase dashboard
- JWT token is automatically included in Supabase client requests
- For backend API calls, we'll need to pass the token manually (Phase 2d)
- The terminal dependencies are installed now but not used until Phase 2d
