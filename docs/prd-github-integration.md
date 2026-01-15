# PRD: GitHub Integration for Aether

## Overview

Enable Aether users to seamlessly connect their GitHub accounts and work with repositories directly from the platform. This includes importing repos, pushing/pulling changes, managing branches, creating pull requests, and more.

## Goals

1. **Seamless Git workflow** - Users can perform common Git operations without leaving Aether
2. **Full GitHub integration** - Not just basic sync, but PRs, forks, and repo creation
3. **Security** - Minimal permissions, user controls what repos Aether can access
4. **Great UX** - Visual Git interface that's easier than command line

## Non-Goals

- Git hosting (we use GitHub, not replace it)
- Support for GitLab/Bitbucket (future consideration)
- Code review features within Aether (use GitHub's PR interface)

---

## Architecture Decision: GitHub App

We will use a **GitHub App** (not OAuth App) for repository access because:

| Aspect        | OAuth App                | GitHub App                      |
| ------------- | ------------------------ | ------------------------------- |
| Permissions   | All-or-nothing per scope | Granular per-repo               |
| Installation  | User grants access       | User installs on specific repos |
| Rate limits   | 5,000/hr per user        | 5,000/hr per installation       |
| Token refresh | Manual                   | Automatic                       |
| Org support   | Limited                  | Full support                    |

**Note:** We already have an OAuth App for authentication (sign-in). The GitHub App is separate and specifically for repo operations.

---

## Phases Overview

| Phase                        | Scope                        | Description                     |
| ---------------------------- | ---------------------------- | ------------------------------- |
| **Phase 1: MVP**             | Import + Core Git + Branches | Complete workflow for daily use |
| **Phase 2: Pull Requests**   | Create & view PRs            | GitHub collaboration features   |
| **Phase 3: Repo Management** | Create & fork repos          | Advanced repo operations        |

---

## Phase 1: MVP (Import + Core Git + Branches)

### Goal

Users can connect GitHub, import repositories, and perform a complete git workflow including commits, push/pull, and branch management.

### Features

#### 1.1 GitHub App Installation Flow

**User Flow:**

1. User navigates to Settings → GitHub
2. Clicks "Connect GitHub"
3. Redirected to GitHub App installation page
4. Selects which repos to grant access (all or specific)
5. GitHub redirects back to Aether with installation ID
6. Aether stores installation, shows connected status

**Backend Requirements:**

- GitHub App registered with required permissions
- Callback endpoint to handle installation
- Store installation ID and metadata in database

**UI Components:**

- Settings page GitHub section
- Installation status display
- "Manage on GitHub" link to modify access

#### 1.2 Import Repository

**User Flow:**

1. Create new project → "Import from GitHub" option
2. Or existing project → "Import repo" in Git panel
3. Select installation (if multiple accounts/orgs)
4. Search/filter accessible repos
5. Select repo and branch
6. Click Import → Clone begins
7. Progress indicator → Success → Ready to use

**Backend Requirements:**

- List repos accessible via installation
- Generate installation access token
- Clone repo into project VM filesystem
- Configure git remote with credentials

**UI Components:**

- Import modal with repo picker
- Search/filter functionality
- Branch selector
- Import progress indicator

#### 1.3 Git Status & Diff

**Features:**

- Show current branch name
- List changed files with status icons:
  - M = Modified
  - A = Added (staged new file)
  - D = Deleted
  - ? = Untracked
- View diff for any changed file
- Refresh status on file changes

**UI Components:**

- Git panel in workspace sidebar
- File tree with status icons
- Diff viewer modal/panel

#### 1.4 Stage & Commit

**Features:**

- Stage individual files
- Stage all changes
- Unstage files
- Commit message input (title + optional body)
- Commit button
- View recent commit history

**UI Components:**

- Checkbox or click-to-stage files
- "Stage All" / "Unstage All" buttons
- Commit message textarea
- Commit history list

#### 1.5 Push & Pull

**Features:**

- Push commits to remote
- Pull latest from remote
- Show ahead/behind count
- Handle push rejection (needs pull first)
- Handle merge conflicts (show affected files)

**UI Components:**

- Push button with commit count
- Pull button with incoming count
- Conflict resolution UI (list files, link to editor)

#### 1.6 Branch Management

**Features:**

- View current branch
- List all local and remote branches
- Switch branches (with uncommitted changes warning)
- Create new branch from current HEAD
- Delete local branch
- Delete remote branch (with confirmation)

**UI Components:**

- Branch selector dropdown
- Create branch dialog
- Delete branch confirmation

### Database Schema

```sql
-- GitHub App installations per user
CREATE TABLE github_installations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  installation_id BIGINT NOT NULL UNIQUE,
  account_login TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('User', 'Organization')),
  permissions JSONB,
  repository_selection TEXT CHECK (repository_selection IN ('all', 'selected')),
  suspended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_github_installations_user ON github_installations(user_id);

-- Link between projects and GitHub repos
CREATE TABLE project_github_repos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE UNIQUE,
  installation_id BIGINT NOT NULL REFERENCES github_installations(installation_id),
  repo_full_name TEXT NOT NULL,
  repo_owner TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  default_branch TEXT DEFAULT 'main',
  private BOOLEAN DEFAULT false,
  clone_url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_project_repos_project ON project_github_repos(project_id);
CREATE INDEX idx_project_repos_installation ON project_github_repos(installation_id);
```

### Backend API Endpoints

```
# Installation Management
GET    /api/github/installations              - List user's installations
POST   /api/github/callback                   - Handle GitHub App callback
DELETE /api/github/installations/:id          - Remove installation

# Repository Listing
GET    /api/github/repos                      - List accessible repos
GET    /api/github/repos/:owner/:name         - Get repo details

# Project Git Operations
POST   /api/projects/:id/git/import           - Import/clone repo into project
GET    /api/projects/:id/git/status           - Get working tree status
GET    /api/projects/:id/git/diff             - Get diff (query: file path)
POST   /api/projects/:id/git/stage            - Stage files
POST   /api/projects/:id/git/unstage          - Unstage files
POST   /api/projects/:id/git/commit           - Create commit
POST   /api/projects/:id/git/push             - Push to remote
POST   /api/projects/:id/git/pull             - Pull from remote
GET    /api/projects/:id/git/log              - Get commit history
GET    /api/projects/:id/git/branches         - List branches
POST   /api/projects/:id/git/branches         - Create branch
DELETE /api/projects/:id/git/branches/:name   - Delete branch
POST   /api/projects/:id/git/checkout         - Switch branch
```

### Technical Implementation

#### GitHub App Setup

**Required Permissions:**

- Repository contents: Read & Write
- Metadata: Read

**Callback URL:**

- `https://api.aether.dev/github/callback` (production)
- `http://localhost:8080/github/callback` (development)

**Environment Variables:**

```
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----...
GITHUB_APP_WEBHOOK_SECRET=xxx  # Optional, for webhooks
GITHUB_APP_CLIENT_ID=Iv1.xxx   # For OAuth if needed
GITHUB_APP_CLIENT_SECRET=xxx
```

#### Token Management

```go
type GitHubAppService struct {
    appID      int64
    privateKey *rsa.PrivateKey
}

// GetInstallationToken generates a short-lived token for API calls
func (s *GitHubAppService) GetInstallationToken(ctx context.Context, installationID int64) (string, time.Time, error) {
    // 1. Generate JWT signed with app private key
    jwt := s.generateJWT()

    // 2. Exchange JWT for installation token
    // POST https://api.github.com/app/installations/{id}/access_tokens

    // 3. Return token (valid for 1 hour)
    return token, expiresAt, nil
}
```

#### Git Operations in VM

```go
type GitHandler struct {
    db        *db.Client
    github    *GitHubAppService
    vmClient  *vm.Client
}

func (h *GitHandler) Push(ctx context.Context, projectID, userID string) error {
    // 1. Get project's linked repo
    repo, err := h.db.GetProjectRepo(ctx, projectID)

    // 2. Verify user has access via installation
    installation, err := h.db.GetInstallation(ctx, userID, repo.InstallationID)

    // 3. Get fresh installation token
    token, _, err := h.github.GetInstallationToken(ctx, repo.InstallationID)

    // 4. Execute git push in VM with token as credential
    cmd := fmt.Sprintf("git -c credential.helper='!f() { echo password=%s; }; f' push", token)
    return h.vmClient.Exec(ctx, projectID, cmd)
}
```

### UI Mockups

#### Settings Page - GitHub Section

```
┌─────────────────────────────────────────────────────────────┐
│ GitHub Integration                                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ ✓ Connected                                                 │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 👤 @pranav100000                              [Manage]  │ │
│ │    Personal account · 12 repos accessible               │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 🏢 @acme-corp                                 [Manage]  │ │
│ │    Organization · All repos accessible                  │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ [+ Connect Another Account]                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Workspace - Git Panel

```
┌──────────────────────────────────┐
│ Git                     main ▼   │
├──────────────────────────────────┤
│  ↓ Pull        ↑ Push (2)        │
├──────────────────────────────────┤
│ Changes                          │
│ ┌──────────────────────────────┐ │
│ │ ☑ M src/App.tsx              │ │
│ │ ☑ A src/NewComponent.tsx     │ │
│ │ ☐ ? src/temp.ts              │ │
│ └──────────────────────────────┘ │
│ [Stage All]                      │
├──────────────────────────────────┤
│ ┌──────────────────────────────┐ │
│ │ Commit message...            │ │
│ │                              │ │
│ └──────────────────────────────┘ │
│ [Commit 2 files]                 │
├──────────────────────────────────┤
│ History                          │
│  • a1b2c3d Fix login bug         │
│  • e4f5g6h Add user dashboard    │
│  • i7j8k9l Initial commit        │
└──────────────────────────────────┘
```

#### Import Repository Modal

```
┌─────────────────────────────────────────────────────────────┐
│ Import from GitHub                                     [X]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Account: [@pranav100000 ▼]                                  │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 🔍 Search repositories...                               │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ○ pranav100000/my-app                         ★ 12     │ │
│ │   React application with TypeScript                     │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │ ● pranav100000/aether                         🔒 ★ 5   │ │
│ │   Cloud development environment                         │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │ ○ pranav100000/dotfiles                       ★ 2      │ │
│ │   Personal configuration files                          │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ Branch: [main ▼]                                            │
│                                                             │
│                                    [Cancel]  [Import]       │
└─────────────────────────────────────────────────────────────┘
```

---

## Phase 2: Pull Requests

### Goal

Users can create pull requests and view PR status directly from Aether.

### Features

#### 2.1 Create Pull Request

**User Flow:**

1. User has commits on a feature branch
2. Opens "Create PR" from Git panel
3. Selects base branch (e.g., main)
4. Enters title and description (markdown)
5. Previews files changed and commits
6. Clicks "Create Pull Request"
7. PR created on GitHub, link shown

**UI Components:**

- Create PR dialog
- Branch selector (source → target)
- Title/description inputs
- Files changed preview
- Success state with PR link

#### 2.2 View Pull Requests

**Features:**

- List open PRs for the repo
- Show PR status:
  - Checks (CI passing/failing)
  - Review status (approved, changes requested)
  - Mergeable status
- Click to open PR on GitHub

**UI Components:**

- PR list in Git panel
- Status badges/icons
- Quick actions (view on GitHub)

### API Endpoints

```
GET  /api/projects/:id/github/pulls           - List PRs for repo
POST /api/projects/:id/github/pulls           - Create PR
GET  /api/projects/:id/github/pulls/:number   - Get PR details
```

---

## Phase 3: Repo Management

### Goal

Users can create new repositories and fork existing ones.

### Features

#### 3.1 Create Repository

**User Flow:**

1. Project with no linked repo
2. User clicks "Create GitHub Repo"
3. Enters repo name, description
4. Selects visibility (public/private)
5. Selects account (personal or org)
6. Clicks Create
7. Repo created, project files pushed

**UI Components:**

- Create repo dialog
- Name/description inputs
- Visibility toggle
- Account selector

#### 3.2 Fork Repository

**User Flow:**

1. User wants to contribute to a repo they don't own
2. Clicks "Fork" on import screen
3. Repo forked to their account
4. Fork imported into project
5. Upstream remote configured

**UI Components:**

- Fork option in import flow
- Fork confirmation dialog

#### 3.3 Repository Settings

**Features:**

- View linked repo info (stars, forks, etc.)
- Change default branch
- Unlink repo from project

**UI Components:**

- Repo info card in settings
- Unlink confirmation

### API Endpoints

```
POST   /api/github/repos                      - Create new repo
POST   /api/github/repos/fork                 - Fork a repo
GET    /api/projects/:id/github/repo          - Get linked repo info
DELETE /api/projects/:id/github/repo          - Unlink repo from project
PATCH  /api/projects/:id/github/repo          - Update repo settings
```

---

## Security Considerations

1. **Token Lifecycle**
   - Installation tokens are short-lived (1 hour max)
   - Generated on-demand, not stored persistently
   - Never exposed to frontend

2. **Access Control**
   - Users can only access repos from their installations
   - Installation ownership verified on every operation
   - Project ownership verified before git operations

3. **Credential Handling**
   - Git credentials injected per-operation
   - Never written to disk in VM
   - Cleared after operation completes

4. **Audit Trail**
   - Log all git operations with user ID
   - Track push/pull/commit events

---

## Success Metrics

| Metric                   | Description                             |
| ------------------------ | --------------------------------------- |
| GitHub connection rate   | % of users who connect GitHub           |
| Import success rate      | % of imports that complete successfully |
| Git operations/user/week | Engagement with git features            |
| Time to first push       | How quickly users push after import     |

---

## Open Questions

1. **Conflict Resolution UI**: Start simple (show conflicted files, edit manually) or build visual merge tool?
   - **Recommendation**: Start simple, iterate based on feedback

2. **Multiple Remotes**: Should we support multiple remotes (e.g., origin + upstream for forks)?
   - **Recommendation**: Yes, important for fork workflow in Phase 3

3. **Git LFS**: Support large file storage?
   - **Recommendation**: Defer, add if users request

4. **Webhooks**: Real-time updates when repo changes externally?
   - **Recommendation**: Defer to post-MVP, adds complexity

---

## Appendix: GitHub App Registration

### Step-by-step Setup

1. Go to GitHub Settings → Developer Settings → GitHub Apps
2. Click "New GitHub App"
3. Fill in:
   - **Name**: Aether
   - **Homepage URL**: https://aether.dev
   - **Callback URL**: https://api.aether.dev/github/callback
   - **Setup URL**: https://aether.dev/settings (optional)
   - **Webhook**: Disable for now (or set URL if using)
4. Permissions:
   - Repository permissions:
     - Contents: Read & Write
     - Metadata: Read
     - Pull requests: Read & Write (for Phase 2)
5. Where can this app be installed: "Any account"
6. Create App
7. Generate and download private key
8. Note App ID and Client ID

### Environment Setup

```bash
# .env
GITHUB_APP_ID=123456
GITHUB_APP_CLIENT_ID=Iv1.xxxxxxxxxx
GITHUB_APP_CLIENT_SECRET=xxxxxxxxxxxxxxxx
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
...
-----END RSA PRIVATE KEY-----"
```
