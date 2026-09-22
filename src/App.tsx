import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { ThemeProvider } from './lib/theme'
import { ToastProvider } from './lib/toast'
import LoginPage from './pages/LoginPage'
import DashboardLayout from './components/layout/DashboardLayout'
import DashboardPage from './pages/DashboardPage'
import InstitutionsPage from './pages/InstitutionsPage'
import InstitutionDetailsPage from './pages/InstitutionDetailsPage'
import UsersPage from './pages/UsersPage'
import ConnectionsPage from './pages/ConnectionsPage'
import ReportsPage from './pages/ReportsPage'
import NotificationsPage from './pages/NotificationsPage'
import ActivityLogPage from './pages/ActivityLogPage'
import SettingsPage from './pages/SettingsPage'
import SupportPage from './pages/SupportPage'
import AgentRoomPage from './pages/AgentRoomPage'
import ProjectsPage from './pages/ProjectsPage'
import AccessTokensPage from './pages/AccessTokensPage'
import SecurityPage from './pages/SecurityPage'

function FullScreenLoader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--awriq-bg)' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '48px', fontWeight: 800, color: '#8A5A2B', marginBottom: '12px' }}>AWRIQ</div>
        <div style={{ fontSize: '14px', color: '#68727A' }}>جاري التحميل...</div>
      </div>
    </div>
  )
}

function FullScreenError({ message }: { message: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--awriq-bg)' }}>
      <div style={{ textAlign: 'center', maxWidth: '400px', padding: '32px' }}>
        <div style={{ fontSize: '48px', fontWeight: 800, color: '#C94B4B', marginBottom: '12px' }}>AWRIQ</div>
        <div style={{ fontSize: '15px', color: '#68727A', lineHeight: 1.6 }}>{message}</div>
      </div>
    </div>
  )
}

function ProtectedRoutes() {
  const { session, loading, authError } = useAuth()

  if (loading) return <FullScreenLoader />

  if (authError) return <FullScreenError message={authError} />

  if (!session) return <Navigate to="/login" replace />

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/" element={<DashboardLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="institutions" element={<InstitutionsPage />} />
        <Route path="institutions/:id" element={<InstitutionDetailsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="connections" element={<ConnectionsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="activity" element={<ActivityLogPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="support" element={<SupportPage />} />
        <Route path="agent-room" element={<AgentRoomPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="access-tokens" element={<AccessTokensPage />} />
        <Route path="security" element={<SecurityPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/*" element={<ProtectedRoutes />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}
