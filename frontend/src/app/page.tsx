import CameraTabs from "@/components/CameraTabs";
import StatusRow from "@/components/StatusRow";

export default function Home() {
  return (
    <main className="flex min-h-0 flex-1 flex-col gap-2">
      <StatusRow />
      <CameraTabs />
    </main>
  );
}
