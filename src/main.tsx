import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import Homepage from "./homepage.tsx";
import "./style.css";

const App = lazy(() => import("./app.tsx"));
const isApp = /^\/app(?:\/|$)/.test(window.location.pathname);
document.title = isApp
  ? "AriadneOS — Process explorer"
  : "AriadneOS — Follow the work in Slack";
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
        <App />
      </Suspense>
    ) : (
      <Homepage />
    )}
  </React.StrictMode>
);
