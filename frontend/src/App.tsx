import { BrowserRouter, Routes, Route } from 'react-router-dom'
import ChatPage from './pages/ChatPage'
import AdminPage from './pages/AdminPage'
import AdminSessionPage from './pages/AdminSessionPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ChatPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/sessions/:sessionId" element={<AdminSessionPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
