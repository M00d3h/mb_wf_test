import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { HfDownloadFloatingPanel } from './HfSidebarDownload'
import { VllmSetupFloatingPanel } from './VllmSetupFloatingPanel'
import { UpdateNotificationPanel } from './UpdateNotificationPanel'

export function Layout(): JSX.Element {
  const { pathname } = useLocation()

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-950 text-zinc-100">
      <Sidebar />
      <main className="relative z-0 flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div
          key={pathname}
          className="main-route-enter flex h-full min-h-0 min-w-0 flex-1 flex-col"
        >
          <Outlet />
        </div>
      </main>
      <HfDownloadFloatingPanel isHfPage={pathname === '/huggingface'} />
      <VllmSetupFloatingPanel />
      <UpdateNotificationPanel />
    </div>
  )
}
