import React from "react";
import ReactDOM from "react-dom/client";
import { lazy, Suspense } from "react";
import Homepage from "./Homepage";

import "./style.css";
const App = lazy(() => import("./App"));
const isApp = /^\/app(?:\/|$)/.test(window.location.pathname);
document.title = isApp
  ? "AriadneOS — Process explorer"
  : "AriadneOS — Follow the work in Slack";

ReactDOM.createRoot(document.getElementById("root")!).render(
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
  </React.StrictMode>,
);
