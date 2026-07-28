import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { LoginPage } from '@/features/auth/LoginPage'
import { SignupPage } from '@/features/auth/SignupPage'
import { Skeleton } from '@/components/ui/page'
import { CommandPalette } from '@/features/command-palette/CommandPalette'

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
const ScaffoldPage = lazy(() =>
  import('@/features/scaffold/ScaffoldPage').then((m) => ({ default: m.ScaffoldPage })),
)

function PageFallback() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <CommandPalette />
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route index element={<HomePage />} />
              <Route path="projects" element={<ProjectsPage />} />
              <Route path="projects/:id" element={<ProjectDetailPage />} />
              <Route path="tasks" element={<TasksPage />} />
              <Route path="tasks/board" element={<KanbanPage />} />
              <Route path="tasks/:id" element={<TaskDetailPage />} />
              <Route path="ai" element={<AiPage />} />
              <Route path="notes" element={<NotesPage />} />
              <Route path="notes/:id" element={<NoteEditorPage />} />
              <Route path="daily-log" element={<DailyLogPage />} />
              <Route path="activity" element={<ActivityPage />} />
              <Route path="search" element={<SearchPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route
                path="ideas"
                element={
                  <ScaffoldPage
                    title="Ideas"
                    description="Idea inbox with impact/effort scoring — coming next."
                  />
                }
              />
              <Route
                path="meetings"
                element={
                  <ScaffoldPage
                    title="Meetings"
                    description="Meeting notes and AI summaries — scaffolded for expansion."
                  />
                }
              />
              <Route
                path="releases"
                element={
                  <ScaffoldPage
                    title="Releases"
                    description="Release notes and ship history — scaffolded for expansion."
                  />
                }
              />
              <Route
                path="documents"
                element={
                  <ScaffoldPage
                    title="Documents"
                    description="Project documentation hub — scaffolded for expansion."
                  />
                }
              />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
