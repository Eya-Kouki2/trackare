import api from "../../api/axios";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaShieldAlt } from "react-icons/fa";
import AuthLayout from "../../components/auth/AuthLayout";
import AuthAlert from "../../components/auth/AuthAlert";
import AuthInput from "../../components/auth/AuthInput";

const VerifyEmail = () => {
  const [code, setCode] = useState("");
  const [errorMessage, setErrorMessage] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!code) {
      setErrorMessage("Enter the verification code.");
      return;
    }

    try {
      setIsSubmitting(true);
      await api.post("/api/auth/verify-email", { code });
      setSuccessMessage("Verified! Redirecting...");
      setTimeout(() => navigate("/login"), 2000);
    } catch (error) {
      setErrorMessage(error.response?.data.message || "Verification failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout title="Verify email">
      {errorMessage && <AuthAlert type="error">{errorMessage}</AuthAlert>}
      {successMessage && <AuthAlert type="success">{successMessage}</AuthAlert>}

      <form onSubmit={handleSubmit} className="space-y-3.5">
        <div>
          <label htmlFor="code" className="auth-label">Verification code</label>
          <AuthInput
            id="code"
            icon={FaShieldAlt}
            onChange={(e) => setCode(e.target.value)}
            value={code}
            type="text"
            placeholder="000000"
            className="text-center font-mono tracking-widest"
          />
        </div>

        <button type="submit" disabled={isSubmitting} className="auth-btn-primary">
          {isSubmitting ? "Verifying..." : "Confirm"}
        </button>

        <p className="auth-footer">
          <button type="button" onClick={() => navigate("/resend-code")} className="auth-btn-link">
            Resend code
          </button>
        </p>
      </form>
    </AuthLayout>
  );
};

export default VerifyEmail;
