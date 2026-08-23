import { BrowserRouter, Route, Routes } from "react-router-dom";
import { SHARED_APP_CSS, initStaticCssVersion, useStaticCss } from "./hooks/useStaticCss";
import "./styles/critical.css";
import { AuthProvider } from "./auth/AuthProvider";
import { RequireAuth } from "./auth/RequireAuth";
import { PokerWsProvider } from "./ws/PokerWsProvider";
import { HomePage } from "./pages/HomePage";
import { LobbyPage } from "./pages/LobbyPage";
import { LoginPage } from "./pages/LoginPage";
import { ProfilePage } from "./pages/ProfilePage";
import { TablePage } from "./pages/TablePage";
import { DevTablePage } from "./pages/DevTablePage";
import "./App.css";

function App() {
  void initStaticCssVersion();
  useStaticCss(SHARED_APP_CSS);
  return (
    <BrowserRouter>
      <AuthProvider>
        <PokerWsProvider>
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
        </PokerWsProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
