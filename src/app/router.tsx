import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PersonalShell } from '@/components/layout/PersonalShell'
import { WorkspaceShell } from '@/components/layout/WorkspaceShell'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { RequireOnboarding } from '@/features/auth/RequireOnboarding'
import { LoginPage } from '@/features/auth/LoginPage'
import { SignupPage } from '@/features/auth/SignupPage'
import { AuthCallbackPage } from '@/features/auth/AuthCallbackPage'
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage'
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage'
import { Skeleton } from '@/components/ui/page'
import { LandingSkeleton } from '@/features/landing/LandingSkeleton'

const LandingPage = lazy(() =>
  import('@/features/landing/LandingPage').then((m) => ({ default: m.LandingPage })),
)
const PrivacyPage = lazy(() =>
  import('@/features/landing/PrivacyPage').then((m) => ({ default: m.PrivacyPage })),
)
const HomePage = lazy(() =>
  import('@/features/home/HomePage').then((m) => ({ default: m.HomePage })),
)
const ProjectsPage = lazy(() =>
  import('@/features/projects/ProjectsPage').then((m) => ({ default: m.ProjectsPage })),
)
const ProjectDetailPage = lazy(() =>
  import('@/features/projects/ProjectDetailPage').then((m) => ({ default: m.ProjectDetailPage })),
)
const TasksPage = lazy(() =>
  import('@/features/tasks/TasksPage').then((m) => ({ default: m.TasksPage })),
)
const TaskDetailPage = lazy(() =>
  import('@/features/tasks/TaskDetailPage').then((m) => ({ default: m.TaskDetailPage })),
)
const KanbanPage = lazy(() =>
  import('@/features/tasks/KanbanPage').then((m) => ({ default: m.KanbanPage })),
)
const AiPage = lazy(() => import('@/features/ai/AiPage').then((m) => ({ default: m.AiPage })))
const NotesPage = lazy(() =>
  import('@/features/notes/NotesPage').then((m) => ({ default: m.NotesPage })),
)
const NoteEditorPage = lazy(() =>
  import('@/features/notes/NoteEditorPage').then((m) => ({ default: m.NoteEditorPage })),
)
const DailyLogPage = lazy(() =>
  import('@/features/daily-log/DailyLogPage').then((m) => ({ default: m.DailyLogPage })),
)
const ActivityPage = lazy(() =>
  import('@/features/activity/ActivityPage').then((m) => ({ default: m.ActivityPage })),
)
const SettingsPage = lazy(() =>
  import('@/features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)
const ProfilePage = lazy(() =>
  import('@/features/profile/ProfilePage').then((m) => ({ default: m.ProfilePage })),
)
const SearchPage = lazy(() =>
  import('@/features/search/SearchPage').then((m) => ({ default: m.SearchPage })),
)
const MissionControlPage = lazy(() =>
  import('@/features/mission-control/MissionControlPage').then((m) => ({
    default: m.MissionControlPage,
  })),
)
const PersonalWorkspacesPage = lazy(() =>
  import('@/features/personal/PersonalWorkspacesPage').then((m) => ({
    default: m.PersonalWorkspacesPage,
  })),
)
const OnboardingPage = lazy(() =>
  import('@/features/onboarding/OnboardingPage').then((m) => ({ default: m.OnboardingPage })),
)
const WorkspaceSelectorPage = lazy(() =>
  import('@/features/workspace-os/pages/WorkspaceSelectorPage').then((m) => ({
    default: m.WorkspaceSelectorPage,
  })),
)
const WorkspaceHomePage = lazy(() =>
  import('@/features/workspace-os/pages/WorkspaceHomePage').then((m) => ({
    default: m.WorkspaceHomePage,
  })),
)
const WorkspaceProjectsPage = lazy(() =>
  import('@/features/workspace-os/pages/WorkspaceProjectsPage').then((m) => ({
    default: m.WorkspaceProjectsPage,
  })),
)
const WorkspaceProjectDetailPage = lazy(() =>
  import('@/features/workspace-os/pages/WorkspaceProjectDetailPage').then((m) => ({
    default: m.WorkspaceProjectDetailPage,
  })),
)
const WorkspaceTasksPage = lazy(() =>
  import('@/features/workspace-os/pages/WorkspaceTasksPage').then((m) => ({
    default: m.WorkspaceTasksPage,
  })),
)
const WorkspaceTaskDetailPage = lazy(() =>
  import('@/features/workspace-os/pages/WorkspaceTaskDetailPage').then((m) => ({
    default: m.WorkspaceTaskDetailPage,
  })),
)
const WorkspaceTeamPage = lazy(() =>
  import('@/features/workspace-os/pages/WorkspaceTeamPage').then((m) => ({
    default: m.WorkspaceTeamPage,
  })),
)
const WorkspaceActivityPage = lazy(() =>
  import('@/features/workspace-os/pages/WorkspaceActivityPage').then((m) => ({
    default: m.WorkspaceActivityPage,
  })),
)
const WorkspaceSprintPage = lazy(() =>
  import('@/features/workspace-os/pages/WorkspaceStubs').then((m) => ({
    default: m.WorkspaceSprintPage,
  })),
)
const WorkspaceRoadmapPage = lazy(() =>
  import('@/features/workspace-os/pages/WorkspaceStubs').then((m) => ({
    default: m.WorkspaceRoadmapPage,
  })),
)
const WorkspaceAiPage = lazy(() =>
  import('@/features/workspace-os/pages/WorkspaceAiPage').then((m) => ({
    default: m.WorkspaceAiPage,
  })),
)
const WorkspaceOrgPage = lazy(() =>
  import('@/features/workspace-os/pages/WorkspaceOrgPage').then((m) => ({
    default: m.WorkspaceOrgPage,
  })),
)
const WorkspaceCrmPage = lazy(() =>
  import('@/features/workspace-os/pages/WorkspaceCrmPage').then((m) => ({
    default: m.WorkspaceCrmPage,
  })),
)
const WorkspaceLoadBalancerPage = lazy(() =>
  import('@/features/workspace-os/pages/WorkspaceLoadBalancerPage').then((m) => ({
    default: m.WorkspaceLoadBalancerPage,
  })),
)
const WorkspaceReportsPage = lazy(() =>
  import('@/features/workspace-os/pages/WorkspaceReportsPage').then((m) => ({
    default: m.WorkspaceReportsPage,
  })),
)
const PersonalReportsPage = lazy(() =>
  import('@/features/reports/PersonalReportsPage').then((m) => ({
    default: m.PersonalReportsPage,
  })),
)
const WorkspaceMissionControlPage = lazy(() =>
  import('@/features/workspace-os/pages/WorkspaceMissionControlPage').then((m) => ({
    default: m.WorkspaceMissionControlPage,
  })),
)
const WorkspaceProfilePage = lazy(() =>
  import('@/features/workspace-os/pages/WorkspaceProfilePage').then((m) => ({
    default: m.WorkspaceProfilePage,
  })),
)
const ScaffoldPage = lazy(() =>
  import('@/features/scaffold/ScaffoldPage').then((m) => ({ default: m.ScaffoldPage })),
)

function AppFallback() {
  return (
    <div className="space-y-4 p-6">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

function ScaffoldRoute({ titleKey, descriptionKey }: { titleKey: string; descriptionKey: string }) {
  const { t } = useTranslation()
  return <ScaffoldPage title={t(titleKey)} description={t(descriptionKey)} />
}

function AppToPersonalRedirect() {
  const params = useParams()
  const rest = params['*']
  return <Navigate to={rest ? `/personal/${rest}` : '/personal'} replace />
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <Suspense fallback={<LandingSkeleton />}>
              <LandingPage />
            </Suspense>
          }
        />
        <Route
          path="/privacy"
          element={
            <Suspense fallback={<LandingSkeleton />}>
              <PrivacyPage />
            </Suspense>
          }
        />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/auth/confirm" element={<AuthCallbackPage />} />
        <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/auth/reset-password" element={<ResetPasswordPage />} />

        <Route element={<RequireAuth />}>
          <Route
            path="/onboarding"
            element={
              <Suspense fallback={<AppFallback />}>
                <OnboardingPage />
              </Suspense>
            }
          />

          <Route element={<RequireOnboarding />}>
            <Route
              path="/personal"
              element={
                <Suspense fallback={<AppFallback />}>
                  <PersonalShell />
                </Suspense>
              }
            >
              <Route
                index
                element={
                  <Suspense fallback={<AppFallback />}>
                    <HomePage />
                  </Suspense>
                }
              />
              <Route path="projects" element={<Suspense fallback={<AppFallback />}><ProjectsPage /></Suspense>} />
              <Route path="projects/:id" element={<Suspense fallback={<AppFallback />}><ProjectDetailPage /></Suspense>} />
              <Route path="tasks" element={<Suspense fallback={<AppFallback />}><TasksPage /></Suspense>} />
              <Route path="tasks/board" element={<Suspense fallback={<AppFallback />}><KanbanPage /></Suspense>} />
              <Route path="tasks/:id" element={<Suspense fallback={<AppFallback />}><TaskDetailPage /></Suspense>} />
              <Route path="ai" element={<Suspense fallback={<AppFallback />}><AiPage /></Suspense>} />
              <Route path="notes" element={<Suspense fallback={<AppFallback />}><NotesPage /></Suspense>} />
              <Route path="notes/:id" element={<Suspense fallback={<AppFallback />}><NoteEditorPage /></Suspense>} />
              <Route path="daily-log" element={<Suspense fallback={<AppFallback />}><DailyLogPage /></Suspense>} />
              <Route path="activity" element={<Suspense fallback={<AppFallback />}><ActivityPage /></Suspense>} />
              <Route path="search" element={<Suspense fallback={<AppFallback />}><SearchPage /></Suspense>} />
              <Route path="notifications" element={<Navigate to="/personal/tasks" replace />} />
              <Route path="settings" element={<Suspense fallback={<AppFallback />}><SettingsPage /></Suspense>} />
              <Route path="profile" element={<Suspense fallback={<AppFallback />}><ProfilePage /></Suspense>} />
              <Route path="reports" element={<Suspense fallback={<AppFallback />}><PersonalReportsPage /></Suspense>} />
              <Route
                path="mission-control"
                element={
                  <Suspense fallback={<AppFallback />}>
                    <MissionControlPage />
                  </Suspense>
                }
              />
              <Route
                path="workspace"
                element={
                  <Suspense fallback={<AppFallback />}>
                    <PersonalWorkspacesPage />
                  </Suspense>
                }
              />
              <Route path="calendar" element={<Navigate to="/personal/mission-control" replace />} />
              <Route
                path="ideas"
                element={
                  <Suspense fallback={<AppFallback />}>
                    <ScaffoldRoute titleKey="scaffold.ideasTitle" descriptionKey="scaffold.ideasDesc" />
                  </Suspense>
                }
              />
              <Route
                path="meetings"
                element={
                  <Suspense fallback={<AppFallback />}>
                    <ScaffoldRoute titleKey="scaffold.meetingsTitle" descriptionKey="scaffold.meetingsDesc" />
                  </Suspense>
                }
              />
              <Route
                path="releases"
                element={
                  <Suspense fallback={<AppFallback />}>
                    <ScaffoldRoute titleKey="scaffold.releasesTitle" descriptionKey="scaffold.releasesDesc" />
                  </Suspense>
                }
              />
              <Route
                path="documents"
                element={
                  <Suspense fallback={<AppFallback />}>
                    <ScaffoldRoute titleKey="scaffold.documentsTitle" descriptionKey="scaffold.documentsDesc" />
                  </Suspense>
                }
              />
              <Route
                path="export"
                element={
                  <Suspense fallback={<AppFallback />}>
                    <ScaffoldRoute titleKey="scaffold.exportTitle" descriptionKey="scaffold.exportDesc" />
                  </Suspense>
                }
              />
            </Route>

            <Route
              path="/workspace"
              element={
                <Suspense fallback={<AppFallback />}>
                  <WorkspaceSelectorPage />
                </Suspense>
              }
            />

            <Route
              path="/workspace/:workspaceId"
              element={
                <Suspense fallback={<AppFallback />}>
                  <WorkspaceShell />
                </Suspense>
              }
            >
              <Route index element={<Suspense fallback={<AppFallback />}><WorkspaceHomePage /></Suspense>} />
              <Route path="projects" element={<Suspense fallback={<AppFallback />}><WorkspaceProjectsPage /></Suspense>} />
              <Route path="projects/:projectId" element={<Suspense fallback={<AppFallback />}><WorkspaceProjectDetailPage /></Suspense>} />
              <Route path="tasks" element={<Suspense fallback={<AppFallback />}><WorkspaceTasksPage /></Suspense>} />
              <Route path="tasks/:taskId" element={<Suspense fallback={<AppFallback />}><WorkspaceTaskDetailPage /></Suspense>} />
              <Route path="team" element={<Suspense fallback={<AppFallback />}><WorkspaceTeamPage /></Suspense>} />
              <Route path="org" element={<Suspense fallback={<AppFallback />}><WorkspaceOrgPage /></Suspense>} />
              <Route path="crm" element={<Suspense fallback={<AppFallback />}><WorkspaceCrmPage /></Suspense>} />
              <Route path="load-balancer" element={<Suspense fallback={<AppFallback />}><WorkspaceLoadBalancerPage /></Suspense>} />
              <Route path="reports" element={<Suspense fallback={<AppFallback />}><WorkspaceReportsPage /></Suspense>} />
              <Route path="settings" element={<Navigate to="profile" replace />} />
              <Route path="profile" element={<Suspense fallback={<AppFallback />}><WorkspaceProfilePage /></Suspense>} />
              <Route path="activity" element={<Suspense fallback={<AppFallback />}><WorkspaceActivityPage /></Suspense>} />
              <Route path="mission-control" element={<Suspense fallback={<AppFallback />}><WorkspaceMissionControlPage /></Suspense>} />
              <Route path="sprint" element={<Suspense fallback={<AppFallback />}><WorkspaceSprintPage /></Suspense>} />
              <Route path="roadmap" element={<Suspense fallback={<AppFallback />}><WorkspaceRoadmapPage /></Suspense>} />
              <Route path="ai" element={<Suspense fallback={<AppFallback />}><WorkspaceAiPage /></Suspense>} />
            </Route>
          </Route>

          {/* Compat: old /app/* bookmarks */}
          <Route path="/app/*" element={<AppToPersonalRedirect />} />
          <Route path="/app" element={<Navigate to="/personal" replace />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
