import { Card } from "@/components/ui/card";

interface StatCardProps {
  label: string;
  value: number | string;
  subtitle?: string;
}

export function StatCard({ label, value, subtitle }: StatCardProps) {
  return (
    <Card>
      <p className="text-sm ad-text-muted">{label}</p>
      <p className="mt-1 text-3xl font-bold font-mono ad-text-gold">{value}</p>
      {subtitle && (
        <p className="mt-1 text-xs ad-text-secondary">{subtitle}</p>
      )}
    </Card>
  );
}
