import { createBrowserRouter, createRoutesFromElements, Navigate, Route } from "react-router-dom";
import ProtectedRoute from "../components/common/ProtectedRoute";
import DashboardPreviewPage from "../pages/DashboardPreviewPage";
import HomePage from "../pages/HomePage";
import LoginPage from "../pages/LoginPage";
import StaffPage from "../pages/StaffPage";
import UserPage from "../pages/UserPage";
import SceneDemoPage from "../pages/SceneDemoPage";

export const router = createBrowserRouter(
  createRoutesFromElements(
    <>
      <Route path="/" element={<HomePage />} />
      <Route path="/demo/ai" element={<SceneDemoPage />} />
      <Route path="/dashboard-preview" element={<DashboardPreviewPage />} />
      <Route path="/dashboard-preview-alert" element={<DashboardPreviewPage danger />} />
      <Route
        path="/staff"
        element={<ProtectedRoute role="staff" fallback={<LoginPage role="staff" />} />}
      >
        <Route index element={<StaffPage />} />
        <Route path="subjects/:subjectId" element={<StaffPage />} />
      </Route>
      <Route
        path="/user"
        element={<ProtectedRoute role="user" fallback={<LoginPage role="user" />} />}
      >
        <Route index element={<UserPage />} />
        <Route path="orange-preview" element={<UserPage comparison />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </>,
  ),
);
