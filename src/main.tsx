import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import AuthGate from "./auth-gate.tsx";
import Homepage from "./homepage.tsx";
import HowItWorks from "./how-it-works.tsx";
import "./style.css";

const App = lazy(() => import("./app.tsx"));
const isApp = /^\/app(?:\/|$)/.test(window.location.pathname);
const isHowItWorks = /^\/how-it-works\/?$/.test(window.location.pathname);
const MarketingPage = isHowItWorks ? HowItWorks : Homepage;
document.title = "AriadneOS — Follow the work in Slack";
if (isHowItWorks) {
  document.title = "How it works — AriadneOS";
} else if (isApp) {
  document.title = "AriadneOS — Process explorer";
}
const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing application root");
}
createRoot(root).render(
  <React.StrictMode>
    {isApp ? (
      <Suspense
        fallback={
          <div className="loading-state" role="status">
            Loading your workspace…
          </div>
        }
      >
        <AuthGate>
          <App />
        </AuthGate>
      </Suspense>
    ) : (
      <MarketingPage />
    )}
  </React.StrictMode>
);
