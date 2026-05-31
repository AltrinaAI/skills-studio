import SkillApp from "@/components/SkillApp";

// Optional deep-link: ?path=/abs/skill opens that skill on launch.
function initialPath(): string | undefined {
  try {
    return new URLSearchParams(window.location.search).get("path") ?? undefined;
  } catch {
    return undefined;
  }
}

export default function App() {
  return <SkillApp initialPath={initialPath()} />;
}
