import { useParams } from 'react-router-dom';

export function AICockpitPage() {
  const { agentId } = useParams();
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-extrabold tracking-tight">AI Cockpit #{agentId}</h1>
    </div>
  );
}
