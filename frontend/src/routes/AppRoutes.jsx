import { Routes, Route } from "react-router-dom";
import Signup from "../pages/auth/Signup";
import Login from "../pages/auth/Login";
import VerifyEmail from "../pages/auth/VerifyEmail";
import ResendVerification from "../pages/auth/ResendVerification";
import ForgotPassword from "../pages/auth/ForgotPassword";
import VerifyResetCode from "../pages/auth/VerifyResetCode";
import ResetPassword from "../pages/auth/ResetPassword";
import AdminSetup from "../pages/admin/AdminSetup";
import AdminLayout from "../components/admin/AdminLayout";
import NurseLayout from "../components/admin/NurseLayout";
import AdminHome from "../pages/admin/AdminHome";
import Patients from "../pages/admin/Patients";
import Triage from "../pages/admin/Triage";
import PharmacyMonitor from "../pages/admin/PharmacyMonitor";
import Analytics from "../pages/admin/Analytics";
import Reports from "../pages/admin/Reports";
import AuditLog from "../pages/admin/AuditLog";
import Settings from "../pages/admin/Settings";
import Profile from "../pages/admin/Profile";
import DiseaseClasses from "../pages/admin/DiseaseClasses";
import DetectSickness from "../pages/admin/DetectSickness";
import Alerts from "../pages/admin/Alerts";
import MedicinesList from "../pages/admin/MedicinesList";
import DispensingQueue from "../pages/admin/DispensingQueue";
import StaffList from "../pages/admin/StaffList";

const AppRoutes = () => (
  <Routes>
    <Route path="/" element={<Login />} />
    <Route path="/signup" element={<Signup />} />
    <Route path="/verify-email" element={<VerifyEmail />} />
    <Route path="/resend-code" element={<ResendVerification />} />
    <Route path="/login" element={<Login />} />
    <Route path="/admin/setup" element={<AdminSetup />} />

    {/* ── Admin Routes ── */}
    <Route path="/admin" element={<AdminLayout />}>
      <Route index element={<AdminHome />} />
      <Route path="patients" element={<Patients />} />
      <Route path="triage" element={<Triage />} />
      <Route path="detect-sickness" element={<DetectSickness />} />
      <Route path="pharmacy" element={<PharmacyMonitor />} />
      <Route path="dispensing" element={<DispensingQueue />} />
      <Route path="medicines" element={<MedicinesList />} />
      <Route path="disease-classes" element={<DiseaseClasses />} />
      <Route path="analytics" element={<Analytics />} />
      <Route path="reports" element={<Reports />} />
      <Route path="audit-log" element={<AuditLog />} />
      <Route path="settings" element={<Settings />} />
      <Route path="profile" element={<Profile />} />
      <Route path="alerts" element={<Alerts />} />
      <Route path="staff" element={<StaffList />} />
    </Route>

    {/* ── Nurse Routes ── */}
    <Route path="/nurse" element={<NurseLayout />}>
      <Route index element={<AdminHome />} />
      <Route path="patients" element={<Patients />} />
      <Route path="triage" element={<Triage />} />
      <Route path="detect-sickness" element={<DetectSickness />} />
      <Route path="pharmacy" element={<PharmacyMonitor />} />
      <Route path="dispensing" element={<DispensingQueue />} />
      <Route path="medicines" element={<MedicinesList />} />
      <Route path="alerts" element={<Alerts />} />
      <Route path="profile" element={<Profile />} />
    </Route>

    <Route path="/forgot-password" element={<ForgotPassword />} />
    <Route path="/reset-password-code" element={<VerifyResetCode />} />
    <Route path="/reset-password" element={<ResetPassword />} />
  </Routes>
);

export default AppRoutes;

