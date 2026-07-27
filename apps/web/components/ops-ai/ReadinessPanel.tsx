import { Badge } from '@/components/ui/badge';

export interface ReadinessPanelProps {
  ready: boolean;
  usableSamples: number;
  minSamplesRequired: number;
  blockers: string[];
}

// New in Milestone 5C-B - "is there enough data to start M2C (Baseline ML
// Training)?" minSamplesRequired is a heuristic placeholder, deliberately
// higher than Correlation's floor and unvalidated pending real ML training
// experience.
export function ReadinessPanel({
  ready,
  usableSamples,
  minSamplesRequired,
  blockers,
}: ReadinessPanelProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge
          variant={ready ? 'default' : 'outline'}
          className={ready ? 'bg-success/20 text-success' : ''}
        >
          {ready ? 'Ready' : 'Not Ready'}
        </Badge>
        <span className="font-mono text-xs text-muted-foreground">
          {usableSamples} / {minSamplesRequired} sampel
        </span>
      </div>
      {blockers.length > 0 ? (
        <ul className="space-y-1">
          {blockers.map((blocker) => (
            <li key={blocker} className="font-body text-xs text-muted-foreground">
              &bull; {blocker}
            </li>
          ))}
        </ul>
      ) : (
        <p className="font-body text-xs text-muted-foreground">Tidak ada blocker terdeteksi.</p>
      )}
    </div>
  );
}
