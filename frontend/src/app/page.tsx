import CameraTabs from "@/components/CameraTabs";
import StatusRow from "@/components/StatusRow";

export default function Home() {
  return (
    <main className="flex min-h-0 flex-1 flex-col bg-gray-100 text-gray-900 gap-2">
      <StatusRow />
      <CameraTabs />
    </main>
  );
}
