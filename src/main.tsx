import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "sonner";
import App from "./App";
import "./index.css";
import { useThemeStore } from "./store/useThemeStore";

// Apply persisted theme before first paint to avoid a flash.
useThemeStore.getState().apply();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
    <Toaster position="bottom-right" theme="system" richColors closeButton />
  </React.StrictMode>
);
