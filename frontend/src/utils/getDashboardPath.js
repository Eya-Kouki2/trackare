export const getDashboardPath = (role) => {
  if (role === "admin") return "/admin";
  if (["nurses", "nurse", "doctor", "doctors", "triage", "pharmacy"].includes(role)) return "/nurse";
  return "/login";
};

export const getPostLoginPath = (user) => {
  if (user.role === "admin") {
    return user.area ? "/admin" : "/admin/setup";
  }
  return getDashboardPath(user.role);
};
