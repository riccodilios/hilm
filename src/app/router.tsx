import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AppShell } from '@/components/layout/AppShell'
import { RequireAuth } from '@/features/auth/RequireAuth'
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
const NotificationsPage = lazy(() =>
  import('@/features/notifications/NotificationsPage').then((m) => ({
    default: m.NotificationsPage,
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
        <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/auth/reset-password" element={<ResetPasswordPage />} />

        <Route element={<RequireAuth />}>
          <Route
            path="/app"
            element={
              <Suspense fallback={<AppFallback />}>
                <AppShell />
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
            <Route path="notifications" element={<Suspense fallback={<AppFallback />}><NotificationsPage /></Suspense>} />
            <Route path="settings" element={<Suspense fallback={<AppFallback />}><SettingsPage /></Suspense>} />
            <Route path="profile" element={<Suspense fallback={<AppFallback />}><ProfilePage /></Suspense>} />
            <Route
              path="calendar"
              element={
                <Suspense fallback={<AppFallback />}>
                  <ScaffoldRoute titleKey="scaffold.calendarTitle" descriptionKey="scaffold.calendarDesc" />
                </Suspense>
              }
            />
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
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
