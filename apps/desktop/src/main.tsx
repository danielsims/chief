import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";

import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Chief could not find its root element.");

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
