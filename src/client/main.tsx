import "@radix-ui/themes/styles.css";
import { Theme } from "@radix-ui/themes";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <Theme accentColor="orange" grayColor="sand" radius="medium">
    <App />
  </Theme>,
);
