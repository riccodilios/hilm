import { SettingsPage } from '@/features/settings/SettingsPage'

/** Account settings hosted inside Workspace OS — does not switch to Personal OS. */
export function WorkspacePersonalSettingsPage() {
  return <SettingsPage exportPath="/personal/export" showPersonalProjects={false} />
}
