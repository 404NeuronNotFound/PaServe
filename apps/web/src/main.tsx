import { StrictMode } from "react";
import "./app/stores/appearance";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./theme.css";
import "./components/feedback/feedback.css";
import App from "./App.tsx";
import "./responsive.css";
import "./accessibility.css";
import "./components/ui/ui.css";
import "./components/paserve/paserve.css";
import "./components/forms/forms.css";
import "./components/paserve/management.css";
import "./menu-brand.css";
import "./motion.css";
import "./components/ui/modal-responsive.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
