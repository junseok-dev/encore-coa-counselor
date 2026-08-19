import { BrowserRouter, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import ChatPage from './pages/ChatPage'
import AdminPage from './pages/AdminPage'
import AdminSessionPage from './pages/AdminSessionPage'

function AdminWorkspace() {
  const location = useLocation()
  const isSessionDetail = /^\/admin\/sessions\/[^/]+$/.test(location.pathname)

  return (
    <>
      <div className={isSessionDetail ? 'hidden' : undefined}>
        <AdminPage />
      </div>
      <Outlet />
    </>
  )
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ChatPage />} />
        <Route path="/admin" element={<AdminWorkspace />}>
          <Route path="sessions/:sessionId" element={<AdminSessionPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
