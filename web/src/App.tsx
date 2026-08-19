import { BrowserRouter, Route, Routes } from "react-router-dom";
import { SHARED_APP_CSS, useStaticCss } from "./hooks/useStaticCss";
import { AuthProvider } from "./auth/AuthProvider";
import { RequireAuth } from "./auth/RequireAuth";
import { HomePage } from "./pages/HomePage";
import { LobbyPage } from "./pages/LobbyPage";
import { LoginPage } from "./pages/LoginPage";
import { ProfilePage } from "./pages/ProfilePage";
import { TablePage } from "./pages/TablePage";
import { DevTablePage } from "./pages/DevTablePage";
import "./App.css";

function App() {
  useStaticCss(SHARED_APP_CSS);
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/profile"
            element={
              <RequireAuth>
                <ProfilePage />
              </RequireAuth>
            }
          />
          <Route
            path="/lobby"
            element={
              <RequireAuth>
                <LobbyPage />
              </RequireAuth>
            }
          />
          <Route
            path="/dev-table"
            element={
              <RequireAuth>
                <DevTablePage />
              </RequireAuth>
            }
          />
          <Route
            path="/table/:tableId"
            element={
              <RequireAuth>
                <TablePage />
              </RequireAuth>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
