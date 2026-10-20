import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./theme.css";
import "./components/feedback/feedback.css";
import App from "./App.tsx";
import "./responsive.css";
import "./accessibility.css";
import "./motion.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
