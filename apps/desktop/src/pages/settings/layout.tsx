import { Outlet } from "react-router";

export function SettingsLayout() {
  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8 sm:px-8 sm:py-10">
      <div className="min-w-0 space-y-8 pb-10">
        <Outlet />
      </div>
    </div>
  );
}
