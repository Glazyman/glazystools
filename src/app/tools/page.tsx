import { redirect } from "next/navigation";

// The old "All Tools" page is now merged into the home hub.
export default function ToolsIndex() {
  redirect("/");
}
