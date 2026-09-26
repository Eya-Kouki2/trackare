import api from "../../api/axios";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaUser, FaEnvelope, FaKey } from "react-icons/fa";
import AuthLayout from "../../components/auth/AuthLayout";
import AuthAlert from "../../components/auth/AuthAlert";
import AuthInput from "../../components/auth/AuthInput";
import PasswordInput from "../../components/auth/PasswordInput";

const ROLES = [
  { value: "admin", label: "Admin" },
  { value: "doctor", label: "Doctor" },
  { value: "nurses", label: "Nurse" },
  { value: "triage", label: "Triage" },
  { value: "pharmacy", label: "Pharmacy" },
];

const Signup = () => {
  const [data, setData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    role: "admin",
    areaCode: "",
  });
  const [errorMessage, setErrorMessage] = useState(null);
  const [areaCodeError, setAreaCodeError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showResendButton, setShowResendButton] = useState(false);
  const navigate = useNavigate();

  const handleData = (e) => {
    const { name, value } = e.target;
    setData((prev) => ({ ...prev, [name]: value }));
    if (name === "areaCode") setAreaCodeError(null);
  };

  const validateInput = () => {
    if (!data.name) return "Full name is required.";
    if (!data.email) return "Email is required.";
    if (!/\S+@\S+\.\S+/.test(data.email)) return "Enter a valid email.";
    if (!data.password) return "Password is required.";
    if (data.password.length < 6) return "Password must be at least 6 characters.";
    if (data.password !== data.confirmPassword) return "Passwords do not match.";
    if (data.role !== "admin" && !data.areaCode.trim()) return "Area code is required for staff accounts.";
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage(null);
    setAreaCodeError(null);
    setShowResendButton(false);

    const validationError = validateInput();
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    try {
      setIsSubmitting(true);
      await api.post("/api/auth/signup", {
        name: data.name,
        email: data.email,
        password: data.password,
        role: data.role,
        areaCode: data.role === "admin" ? undefined : data.areaCode.trim().toUpperCase(),
      });
      navigate("/verify-email", { state: { email: data.email } });
    } catch (error) {
      if (error.response) {
        const message = error.response.data.message || "Signup failed.";
        const isAreaCodeError =
          data.role !== "admin" &&
          /area code/i.test(message);

        if (isAreaCodeError) {
          setAreaCodeError(message);
          setErrorMessage(null);
        } else {
          setErrorMessage(message);
        }

        if (message === "User not verified yet") setShowResendButton(true);
      } else if (error.request) {
        setErrorMessage("Unable to connect to the server.");
      } else {
        setErrorMessage("Something went wrong.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      {errorMessage && <AuthAlert type="error">{errorMessage}</AuthAlert>}

      {showResendButton && (
        <p className="text-center text-xs mb-3">
          <button type="button" onClick={() => navigate("/resend-code")} className="auth-btn-link">
            Resend verification code
          </button>
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-3.5">
        <div>
          <label className="auth-label">Role</label>
          <div className="auth-role-group">
            {ROLES.map((role) => (
              <button
                key={role.value}
                type="button"
                onClick={() => {
                  setData((prev) => ({ ...prev, role: role.value, areaCode: "" }));
                  setAreaCodeError(null);
                }}
                className={`auth-role-btn ${
                  data.role === role.value ? "auth-role-btn-active" : "auth-role-btn-inactive"
                }`}
              >
                {role.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="auth-label" htmlFor="name">Full name</label>
          <AuthInput
            id="name"
            name="name"
            icon={FaUser}
            onChange={handleData}
            value={data.name}
            type="text"
            autoComplete="name"
            placeholder="Your full name"
          />
        </div>

        <div>
          <label className="auth-label" htmlFor="email">Email</label>
          <AuthInput
            id="email"
            name="email"
            icon={FaEnvelope}
            onChange={handleData}
            value={data.email}
            type="email"
            autoComplete="email"
            placeholder="you@email.com"
          />
        </div>

        <div>
          <label className="auth-label" htmlFor="password">Password</label>
          <PasswordInput
            id="password"
            name="password"
            onChange={handleData}
            value={data.password}
            placeholder="Min. 6 characters"
          />
        </div>

        <div>
          <label className="auth-label" htmlFor="confirmPassword">Confirm password</label>
          <PasswordInput
            id="confirmPassword"
            name="confirmPassword"
            onChange={handleData}
            value={data.confirmPassword}
            placeholder="Repeat password"
          />
        </div>

        {data.role !== "admin" && (
          <div>
            <label className="auth-label" htmlFor="areaCode">Area code</label>
            <AuthInput
              id="areaCode"
              name="areaCode"
              icon={FaKey}
              onChange={handleData}
              value={data.areaCode}
              type="text"
              placeholder="MSH-XXXXXX"
              className={`uppercase ${areaCodeError ? "auth-input-error" : ""}`}
              aria-invalid={areaCodeError ? "true" : undefined}
              aria-describedby={areaCodeError ? "areaCode-error" : undefined}
            />
            {areaCodeError && (
              <p id="areaCode-error" className="auth-field-error" role="alert">
                {areaCodeError}
              </p>
            )}
          </div>
        )}

        <button type="submit" disabled={isSubmitting} className="auth-btn-primary !mt-4">
          {isSubmitting ? "Creating..." : "Create account"}
        </button>

        <p className="auth-footer">
          Have an account?{" "}
          <button type="button" onClick={() => navigate("/login")} className="auth-btn-link">
            Sign in
          </button>
        </p>
      </form>
    </AuthLayout>
  );
};

export default Signup;
