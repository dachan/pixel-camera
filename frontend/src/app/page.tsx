import CaptureView from "@/components/CaptureView";
import CameraControls from "@/components/CameraControls";
import CameraMeta from "@/components/CameraMeta";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center gap-8 bg-zinc-950 p-6 py-10 text-zinc-100">
      <CaptureView />
      <CameraControls />
      <CameraMeta />
    </main>
  );
}
