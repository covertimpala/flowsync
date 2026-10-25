import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { NavShell } from './components/NavShell';
import { BudgetPage } from './pages/BudgetPage';
import { CalendarPage } from './pages/CalendarPage';
import { HabitsPage } from './pages/HabitsPage';
import { SettingsPage } from './pages/SettingsPage';
import { TodayPage } from './pages/TodayPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<NavShell />}>
          <Route path="/" element={<TodayPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/habits" element={<HabitsPage />} />
          <Route path="/budget" element={<BudgetPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
