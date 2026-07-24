import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./index.css";

function applyTheme() {
  const hour = new Date().getHours();
  const isNight = hour >= 19 || hour < 7;
  document.documentElement.setAttribute("data-theme", isNight ? "night" : "day");
}

applyTheme();
setInterval(applyTheme, 60_000);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
