import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./collab/styles/base.css";
import "./collab/components/transcript/transcript.css";
import "./styles/app.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
