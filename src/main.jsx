import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "react-data-grid/lib/styles.css";
import "./index.css";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
